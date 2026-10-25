import { NextRequest, NextResponse } from 'next/server';
import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { uploadObjectStream, signObjectUrl } from '@/lib/storage/s3';
import { isAssetKind, ASSET_MAX_BYTES, resolveAssetMime } from '@/lib/lesson/assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGING_ROOT = path.join(tmpdir(), 'qz-uploads');
const UPLOAD_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_CHUNKS = 100;
const ASSET_COLS = 'id,kind,file_name,mime_type,size_bytes,note,parse_status,created_at';

const bodySchema = z.object({
  uploadId: z.string().regex(UPLOAD_ID_RE),
  kind: z.string(),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().max(128).optional(),
  note: z.string().max(1000).nullable().optional(),
  totalSize: z.number().int().positive(),
  totalChunks: z.number().int().min(1).max(MAX_CHUNKS),
});

// 按分片序号顺序把落盘分片拼成一条流，逐块产出，避免整文件读进内存。
async function* concatParts(paths: string[]) {
  for (const p of paths) {
    const s = createReadStream(p);
    for await (const chunk of s) yield chunk as Buffer;
  }
}

// 收齐分片后：校验齐备与总大小 -> 流式拼装入 S3 -> 建素材行 -> 清理临时分片。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let sessionDir: string | null = null;
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '非法的合成请求参数' }, { status: 400 });
    const { uploadId, kind, fileName, mimeType, note, totalSize, totalChunks } = parsed.data;
    if (!isAssetKind(kind)) return NextResponse.json({ error: '不支持的素材类型' }, { status: 400 });
    if (totalSize > ASSET_MAX_BYTES[kind]) {
      const capMb = Math.round(ASSET_MAX_BYTES[kind] / (1024 * 1024));
      return NextResponse.json({ error: `文件总大小超过 ${capMb}MB 上限` }, { status: 413 });
    }
    const mime = resolveAssetMime(kind, mimeType, fileName);
    if (!mime) return NextResponse.json({ error: '文件类型不被该素材分类接受' }, { status: 415 });

    sessionDir = path.join(STAGING_ROOT, uploadId);
    const parts: string[] = [];
    let assembled = 0;
    for (let i = 0; i < totalChunks; i += 1) {
      const p = path.join(sessionDir, `${i}.part`);
      try {
        const st = await stat(p);
        assembled += st.size;
      } catch {
        return NextResponse.json({ error: `分片 ${i} 缺失，请重新上传` }, { status: 400 });
      }
      parts.push(p);
    }
    if (assembled !== totalSize) {
      return NextResponse.json({ error: '分片总大小与声明不符，请重新上传' }, { status: 400 });
    }

    // 流式拼装入 S3（内存只保留少量分块，几百 MB~GB 录像也不会 OOM）
    const scope = `u_${user.id}/l_${id}/${kind}`;
    const objectKey = await uploadObjectStream(Readable.from(concatParts(parts)), scope, fileName, mime);

    const { data: row, error } = await db
      .from('lesson_assets')
      .insert({
        lesson_id: id,
        user_id: user.id,
        kind,
        file_name: fileName.slice(0, 512),
        file_url: objectKey, // 持久化对象 key，而非签名 URL
        mime_type: mime.slice(0, 128),
        size_bytes: totalSize,
        note: note ?? null,
        parse_status: 'pending',
      })
      .select(ASSET_COLS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    let url: string | null = null;
    try {
      url = await signObjectUrl(objectKey);
    } catch {
      url = null;
    }
    return NextResponse.json({ asset: { ...row, url } }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '分片合成失败' }, { status: 500 });
  } finally {
    // 成功或失败都清掉临时分片，避免残留占盘
    if (sessionDir) await rm(sessionDir, { recursive: true, force: true }).catch(() => {});
  }
}
