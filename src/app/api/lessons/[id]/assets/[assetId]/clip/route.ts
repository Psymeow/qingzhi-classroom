import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { signObjectUrl } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 单次截取上限（秒）：防止误传把整节课导出来。 */
const CLIP_MAX_SEC = 300;

/**
 * 关键事件「下载本段」：按起止秒截取音视频片段。
 * 视频走流复制（-c copy）快速切出；音频重编码为 mp3 统一格式、控制体积。
 */
function cutClip(
  input: string,
  startSec: number,
  durSec: number,
  out: string,
  isVideo: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      startSec.toFixed(2),
      '-t',
      durSec.toFixed(2),
      '-i',
      input,
      ...(isVideo ? ['-c', 'copy'] : ['-vn', '-c:a', 'libmp3lame', '-b:a', '128k']),
      out,
    ];
    const p = spawn('ffmpeg', args);
    let tail = '';
    p.stderr.on('data', (d: Buffer) => {
      tail = (tail + d.toString()).slice(-2000);
    });
    p.on('error', (e) => reject(new Error(`ffmpeg 无法启动：${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`片段截取失败（ffmpeg 退出码 ${code}）：${tail.slice(-240).trim()}`));
    });
  });
}

const mmss = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  let workdir: string | null = null;
  try {
    const { user, db } = await authenticate(req);
    const { id, assetId } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const { data: asset, error: assetErr } = await db
      .from('lesson_assets')
      .select('id,kind,file_name,file_url')
      .eq('id', assetId)
      .eq('lesson_id', id)
      .maybeSingle();
    if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });
    if (!asset) return NextResponse.json({ error: '素材不存在' }, { status: 404 });
    if (asset.kind !== 'av_audio' && asset.kind !== 'av_video') {
      return NextResponse.json({ error: '仅音视频素材支持截取片段' }, { status: 400 });
    }
    if (!asset.file_url) return NextResponse.json({ error: '素材文件缺失，请重新上传' }, { status: 400 });

    const url = new URL(req.url);
    const start = Math.max(0, Number.parseFloat(url.searchParams.get('start') ?? '') || 0);
    const end = Number.parseFloat(url.searchParams.get('end') ?? '') || 0;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return NextResponse.json({ error: '请提供有效的起止时间（start < end，单位秒）' }, { status: 400 });
    }
    if (end - start > CLIP_MAX_SEC) {
      return NextResponse.json({ error: `单次截取最长 ${CLIP_MAX_SEC} 秒` }, { status: 400 });
    }

    const signed = await signObjectUrl(asset.file_url);
    workdir = await mkdtemp(path.join(tmpdir(), 'qz-clip-'));
    const isVideo = asset.kind === 'av_video';
    const ext = isVideo ? 'mp4' : 'mp3';
    const outPath = path.join(workdir, `clip.${ext}`);
    await cutClip(signed, start, end - start, outPath, isVideo);
    const buf = await readFile(outPath);
    if (!buf.byteLength) return NextResponse.json({ error: '截取结果为空' }, { status: 500 });

    const base = (asset.file_name || 'clip').replace(/\.[^.]+$/, '');
    const filename = `${base}_${mmss(start)}-${mmss(end)}.${ext}`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': isVideo ? 'video/mp4' : 'audio/mpeg',
        'Content-Length': String(buf.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `片段截取失败：${msg}` }, { status: 500 });
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
