import { NextRequest, NextResponse } from 'next/server';
import { mkdir, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { isAssetKind, ASSET_MAX_BYTES } from '@/lib/lesson/assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 分片暂存根目录（沙箱临时盘）。以 uploadId 命名子目录，complete 时拼装入 S3 后删除。
// 平台网关对单个请求体硬限 128MB，故大文件必须切片逐片上传、服务端落盘拼装。
const STAGING_ROOT = path.join(tmpdir(), 'qz-uploads');
const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const CHUNK_MAX_BYTES = 120 * 1024 * 1024; // 单片上限，须 < 128MB 网关限制
const MAX_CHUNKS = 100;
const STALE_MS = 2 * 3600 * 1000; // 2 小时

// 清理超时未完成的残留分片目录（客户端中途放弃时的兜底，避免临时盘无限增长）
async function sweepStale() {
  try {
    const entries = await readdir(STAGING_ROOT, { withFileTypes: true });
    const now = Date.now();
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(STAGING_ROOT, e.name);
      try {
        const st = await stat(p);
        if (now - st.mtimeMs > STALE_MS) await rm(p, { recursive: true, force: true });
      } catch {
        /* 忽略单个目录清理失败 */
      }
    }
  } catch {
    /* 目录不存在等情况忽略 */
  }
}

// 接收一个分片并落盘暂存；不在此处合成，合成由 /assets/complete 触发。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const form = await req.formData();
    const kind = String(form.get('kind') ?? '');
    const uploadId = String(form.get('uploadId') ?? '');
    const chunkIndex = Number(form.get('chunkIndex'));
    const totalChunks = Number(form.get('totalChunks'));
    const totalSize = Number(form.get('totalSize'));
    const chunk = form.get('chunk');

    if (!isAssetKind(kind)) return NextResponse.json({ error: '不支持的素材类型' }, { status: 400 });
    if (!UPLOAD_ID_RE.test(uploadId)) return NextResponse.json({ error: '非法上传会话 ID' }, { status: 400 });
    if (
      !Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) ||
      chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks || totalChunks > MAX_CHUNKS
    ) {
      return NextResponse.json({ error: '非法分片序号' }, { status: 400 });
    }
    if (!Number.isFinite(totalSize) || totalSize <= 0 || totalSize > ASSET_MAX_BYTES[kind]) {
      const capMb = Math.round(ASSET_MAX_BYTES[kind] / (1024 * 1024));
      return NextResponse.json({ error: `文件总大小超过 ${capMb}MB 上限` }, { status: 413 });
    }
    if (!(chunk instanceof File)) return NextResponse.json({ error: '缺少分片数据' }, { status: 400 });
    if (chunk.size > CHUNK_MAX_BYTES) return NextResponse.json({ error: '单个分片过大' }, { status: 413 });

    await sweepStale();
    const dir = path.join(STAGING_ROOT, uploadId);
    await mkdir(dir, { recursive: true });
    // 单片 < 120MB，落盘即可，不会造成服务端内存压力
    await writeFile(path.join(dir, `${chunkIndex}.part`), Buffer.from(await chunk.arrayBuffer()));

    return NextResponse.json({ ok: true, chunkIndex });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '分片上传失败' }, { status: 500 });
  }
}
