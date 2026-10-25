import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ASRClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { signObjectUrl, uploadObject } from '@/lib/storage/s3';
import { buildTimedTranscript, probeAudioTimeline } from '@/lib/asr/timeline';
import { alignmentAcceptable, buildWindowSegments, downloadToFile } from '@/lib/asr/windows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 逐窗识别：45 分钟课 = 45 个 60 秒窗，并发 8 路约 15~25 秒；加上抽音轨留出余量。
export const maxDuration = 300;

const INPUT_COLS =
  'id,lesson_id,transcript,transcript_source,observer_text,task_sheet_text,updated_at';

// 平台 ASR 上限：音频 ≤100MB、≤2 小时，格式 WAV / MP3 / OGG OPUS / M4A。
const ASR_MAX_BYTES = 100 * 1024 * 1024;
// ai_analysis_inputs.transcript 列上限与既有保存接口一致。
const TRANSCRIPT_MAX_CHARS = 200_000;

/**
 * 用 ffmpeg 把媒体流的音轨抽成 16k 单声道 mp3。
 * 直接以 URL 作为输入，避免把几百 MB 的课堂录像整体落到沙箱磁盘。
 */
function extractAudioTrack(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-y',
      '-i', input,
      '-vn',              // 丢弃视频流
      '-ac', '1', '-ar', '16000', '-b:a', '64k', // 语音识别用窄带即可，显著缩短上传体积
      '-f', 'mp3', output,
    ]);
    let tail = '';
    p.stderr.on('data', (d: Buffer) => { tail = (tail + d.toString()).slice(-2000); });
    p.on('error', (e) => reject(new Error(`ffmpeg 无法启动：${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`音轨提取失败（ffmpeg 退出码 ${code}）：${tail.slice(-300).trim()}`));
    });
  });
}

/**
 * 音视频素材 -> 课堂转写文稿（transcript_source = 'asr'）。
 * 音频直接识别；视频先用 ffmpeg 抽音轨再识别（平台 ASR 只接受音频格式）。
 * 写入 ai_analysis_inputs.transcript，随后「运行分析」即可把课堂实录纳入自动评分。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  let workdir: string | null = null;
  try {
    const { user, db } = await authenticate(req);
    const { id, assetId } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const { data: asset, error: assetErr } = await db
      .from('lesson_assets')
      .select('id,kind,file_name,size_bytes,file_url')
      .eq('id', assetId)
      .eq('lesson_id', id)
      .maybeSingle();
    if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });
    if (!asset) return NextResponse.json({ error: '素材不存在' }, { status: 404 });
    if (asset.kind !== 'av_audio' && asset.kind !== 'av_video') {
      return NextResponse.json({ error: '仅课堂音频、视频可识别为文稿' }, { status: 400 });
    }
    if (!asset.file_url) return NextResponse.json({ error: '素材文件缺失，请重新上传' }, { status: 400 });
    // 音频：ASR 直接吃原始文件，按原始大小判 ≤100MB。
    // 视频：原始文件多大都行，下面会先抽成小音轨、再按音轨大小判；这里绝不能拿视频原始大小卡，
    // 否则几百 MB 的课堂录像会在抽音轨前就被误拒（64kbps 抽轨下 2 小时音轨才 ~58MB，远够识别）。
    if (asset.kind === 'av_audio' && asset.size_bytes && asset.size_bytes > ASR_MAX_BYTES) {
      return NextResponse.json(
        { error: '音频超过平台识别上限 100MB，请先压缩码率或按课时分段后再识别' },
        { status: 400 },
      );
    }

    const headers = HeaderUtils.extractForwardHeaders(req.headers);
    // 逐窗识别要在本地切音频，音频素材也走这里；视频分支复用同一个目录放抽出的音轨。
    workdir = await mkdtemp(path.join(tmpdir(), 'qz-asr-'));
    let asrUrl = await signObjectUrl(asset.file_url);

    // 视频：抽音轨 -> 上传音轨对象 -> 用音轨的签名 URL 识别
    if (asset.kind === 'av_video') {
      const trackPath = path.join(workdir, 'track.mp3');
      await extractAudioTrack(asrUrl, trackPath);
      const trackBuf = await readFile(trackPath);
      if (trackBuf.byteLength > ASR_MAX_BYTES) {
        return NextResponse.json({ error: '提取出的音轨仍超过 100MB，请压缩码率后重试' }, { status: 400 });
      }
      const trackKey = await uploadObject(
        trackBuf,
        `u_${user.id}/l_${id}/av_derived`,
        'audio_track.mp3',
        'audio/mpeg',
      );
      asrUrl = await signObjectUrl(trackKey);
    }

    const asr = new ASRClient(new Config(), headers);
    const result = await asr.recognize({ uid: user.id, url: asrUrl });

    // 平台 ASR 只回纯文本（不含分段），时间轴靠下面的音轨探测 + 文本映射自建。
    const raw = result as unknown as {
      text?: string;
      rawData?: { result?: { text?: string } };
    };
    const asrText = (raw.text ?? raw.rawData?.result?.text ?? '').trim();

    // 探测用同一份音轨：视频用抽出的 16k 音轨，音频直接用原文件 URL。
    // 探测失败不阻断识别：退化为无时间轴（转写照常写入，切片页会提示重新识别）。
    const probe = await probeAudioTimeline(asrUrl).catch(() => ({
      durationMs: 0,
      silences: [] as Array<{ s: number; e: number }>,
    }));
    const built = buildTimedTranscript(
      asrText,
      probe.durationMs,
      probe.silences,
      TRANSCRIPT_MAX_CHARS,
    );

    // 逐窗识别：把音轨切成 60 秒窗口分别识别，用窗口边界给文本定位。
    // 拿到的段比整段映射准得多（误差关在窗内、不随课堂时长累积），但代价是多轮 ASR 调用，
    // 所以做成「能拿到就用、拿不到就退回整段映射」，绝不让它挡住转写本身。
    let segments = built.segments;
    let windowCount = 0;
    let alignedWindows = 0;
    if (probe.durationMs > 0 && workdir && built.text) {
      try {
        const sourcePath =
          asset.kind === 'av_video'
            ? path.join(workdir, 'track.mp3')
            : path.join(workdir, 'source.mp3');
        if (asset.kind !== 'av_video') await downloadToFile(asrUrl, sourcePath);
        const win = await buildWindowSegments({
          asr,
          uid: user.id,
          sourcePath,
          probe,
          workdir,
          maxChars: TRANSCRIPT_MAX_CHARS,
        });
        windowCount = win.windowCount;
        alignedWindows = win.okCount;
        if (alignmentAcceptable(win)) segments = win.segments;
      } catch {
        // 逐窗对齐失败不阻断：保留整段映射的近似时间轴
      }
    }

    const clipped = built.text;
    const truncated = built.truncated;
    if (!clipped) {
      return NextResponse.json(
        { error: '未识别到语音内容，请确认录音中有清晰的师生对话，或改用转写文稿直接上传' },
        { status: 422 },
      );
    }
    const now = new Date().toISOString();

    const { data: existing, error: exErr } = await db
      .from('ai_analysis_inputs')
      .select('id')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

    const row = existing
      ? await db
          .from('ai_analysis_inputs')
          .update({
            transcript: clipped,
            transcript_source: 'asr',
            segments,
            updated_at: now,
          })
          .eq('id', existing.id)
          .select(INPUT_COLS)
          .single()
      : await db
          .from('ai_analysis_inputs')
          .insert({
            lesson_id: id,
            user_id: user.id,
            transcript: clipped,
            observer_text: null,
            task_sheet_text: null,
            transcript_source: 'asr',
            segments,
            updated_at: now,
          })
          .select(INPUT_COLS)
          .single();
    if (row.error) return NextResponse.json({ error: row.error.message }, { status: 400 });

    return NextResponse.json({
      input: row.data,
      transcript: clipped,
      truncated,
      char_count: clipped.length,
      duration_ms: built.durationMs > 0 ? built.durationMs : null,
      segment_count: segments.length,
      window_count: windowCount,
      aligned_windows: alignedWindows,
      source_kind: asset.kind,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `语音识别失败：${msg}。可改用「课堂转写文稿」直接上传文字稿` },
      { status: 500 },
    );
  } finally {
    if (workdir) await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
