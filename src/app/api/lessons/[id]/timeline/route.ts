import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { signObjectUrl } from '@/lib/storage/s3';
import { normalizeSegments, segmentsFromTranscript, type TimelineSegment } from '@/lib/report/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 课堂切片数据源：主视频（签名 URL）+ 课堂实录时间轴 */
interface TimelineSource {
  segment_source: 'asr' | 'transcript' | 'none';
  segments: TimelineSegment[];
  duration_ms: number | null;
  transcript_chars: number;
  videos: Array<{ id: string; file_name: string | null; size_bytes: number | null; created_at: string | null; url: string | null }>;
  audios: Array<{ id: string; file_name: string | null; size_bytes: number | null; created_at: string | null; url: string | null }>;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    // 1. 音视频素材：课堂切片优先挂视频，没有视频时退化为音频（仍可按时间轴听）
    const { data: assetRows, error: assetErr } = await db
      .from('lesson_assets')
      .select('id,kind,file_name,size_bytes,file_url,created_at')
      .eq('lesson_id', id)
      .in('kind', ['av_video', 'av_audio'])
      .order('created_at', { ascending: false });
    if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });

    const sign = async (key: string | null): Promise<string | null> => {
      if (!key) return null;
      try {
        return await signObjectUrl(key);
      } catch {
        return null;
      }
    };
    const rows = assetRows ?? [];
    const videos = await Promise.all(
      rows
        .filter((a) => a.kind === 'av_video')
        .map(async (a) => ({
          id: a.id as string,
          file_name: (a.file_name as string | null) ?? null,
          size_bytes: (a.size_bytes as number | null) ?? null,
          created_at: (a.created_at as string | null) ?? null,
          url: await sign(a.file_url as string | null),
        })),
    );
    const audios = await Promise.all(
      rows
        .filter((a) => a.kind === 'av_audio')
        .map(async (a) => ({
          id: a.id as string,
          file_name: (a.file_name as string | null) ?? null,
          size_bytes: (a.size_bytes as number | null) ?? null,
          created_at: (a.created_at as string | null) ?? null,
          url: await sign(a.file_url as string | null),
        })),
    );

    // 2. 时间轴：结构化 segments 优先（ASR 识别时写入，毫秒精度），
    //    缺失则按「[mm:ss] 逐行转写」解析兜底（手动上传/粘贴的文稿，秒级）。
    const { data: inputRow, error: inputErr } = await db
      .from('ai_analysis_inputs')
      .select('transcript,segments,transcript_source')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (inputErr) return NextResponse.json({ error: inputErr.message }, { status: 500 });

    const transcript = (inputRow?.transcript as string | null) ?? '';
    const transcriptSource = (inputRow?.transcript_source as string | null) ?? '';
    let source: TimelineSource['segment_source'] = 'none';
    // segments 只在来源为 asr 时可信：手动保存文稿会替换 transcript 却残留旧 ASR 段，
    // 字幕会和当前实录两张皮；manual 来源退回文稿时间码解析。
    let segments = transcriptSource === 'asr' ? normalizeSegments(inputRow?.segments) : [];
    if (segments.length) {
      source = 'asr';
    } else if (transcript) {
      segments = segmentsFromTranscript(transcript);
      if (segments.length) source = 'transcript';
    }

    const durationMs = segments.length ? segments[segments.length - 1].e : null;

    const payload: TimelineSource = {
      segment_source: source,
      segments,
      duration_ms: durationMs,
      transcript_chars: transcript.length,
      videos,
      audios,
    };
    return NextResponse.json(payload);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取课堂时间轴失败' }, { status: 500 });
  }
}
