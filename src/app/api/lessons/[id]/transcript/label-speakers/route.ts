import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { chatJson, isLlmEnabled, LlmError } from '@/lib/llm/deepseek';
import { msToClock, stripLeadMeta } from '@/lib/report/timeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 全文说话人标注是多批 LLM 调用（长课例可能 5-8 批），给足时限。
export const maxDuration = 300;

// ============================================================
// AI 标注转写文稿说话人（V1.19）：
// 平台 ASR 只回纯文本，无说话人分离能力；这里用 DeepSeek 按语义
// 为每行标注「教师 / 学生 / 齐声 / 媒体」四类之一，改写文稿为
// `[mm:ss - mm:ss][教师]: 内容` 行格式，并同步更新 ASR segments
// 的 speaker 字段（逐句字幕随之按说话人分色）。
// 仅追加说话人标签，不改动正文内容。
// ============================================================

const SPEAKER_IDS = ['教师', '学生', '齐声', '媒体'] as const;
/** 单次最多标注的行数：超长文稿只标前 N 行，剩余保持原样并如实告知 */
const MAX_LINES = 1200;
/** 每批送模型的行数：控制单次输入输出规模 */
const BATCH = 250;

function msClock(v: number | null): string | null {
  return v == null ? null : msToClock(v);
}

async function labelChunk(lines: string[], offset: number): Promise<number[]> {
  const body = lines.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const raw = await chatJson<{ labels?: unknown }>(
    [
      {
        role: 'system',
        content: [
          '你是课堂话语标注专家。你会收到一段课堂转写文稿，每行一句，行号开头。',
          '请判断每行话语来自谁，只允许四类：教师（含老师讲课、提问、点评、组织指令）、',
          '学生（单个或少数学生发言、回答、讨论汇报）、齐声（全班或多数学生齐答、齐读、齐声问好）、',
          '媒体（录音、视频、课件音频等非现场人声）。',
          '依据措辞与互动模式判断：布置任务/讲解/追问多为教师；个别应答多为学生；',
          '重复性短句集体应答多为齐声。无法判断时默认教师。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '【课堂转写文稿（节选，每行一句）】',
          body,
          '',
          '返回一个与行数等长的整数数组：0=教师 1=学生 2=齐声 3=媒体。',
          `严格按 JSON 输出（恰好 ${lines.length} 个整数，不要输出任何其他内容）：`,
          `{"labels":[0,1,...共 ${lines.length} 个]}`,
        ].join('\n'),
      },
    ],
    { temperature: 0, maxTokens: Math.max(1000, lines.length * 4 + 200), timeoutMs: 60_000 },
  );

  if (!Array.isArray(raw.labels) || raw.labels.length !== lines.length) {
    throw new LlmError(`第 ${offset + 1}-${offset + lines.length} 行标注结果数量不符`);
  }
  return raw.labels.map((v) => {
    const n = typeof v === 'number' ? Math.round(v) : Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 3 ? n : 0;
  });
}

/**
 * POST：对当前转写文稿逐行标注说话人并写回。
 * 返回改写后的文稿（时间码 + 说话人 + 正文）。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    if (!isLlmEnabled()) {
      return NextResponse.json({ error: 'AI 服务未配置，无法标注说话人' }, { status: 503 });
    }

    const { data: row, error: rErr } = await db
      .from('ai_analysis_inputs')
      .select('id,transcript,transcript_source,segments')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });
    const transcript: string = (row as { transcript?: string | null } | null)?.transcript ?? '';
    if (!transcript.trim()) {
      return NextResponse.json({ error: '请先上传或粘贴课堂转写文稿，再标注说话人' }, { status: 422 });
    }

    const source = (row as { transcript_source?: string | null } | null)?.transcript_source ?? 'manual';
    const segments = (row as { segments?: Array<{ s: number; e: number; t: string }> | null } | null)
      ?.segments ?? null;

    // 保留空行结构：仅对非空行标注，行号只在标注批次内连续
    const rawLines = transcript.split('\n');
    const idxOf: number[] = [];
    const texts: string[] = [];
    rawLines.forEach((l, i) => {
      if (l.trim()) {
        idxOf.push(i);
        texts.push(stripLeadMeta(l).text.slice(0, 80));
      }
    });
    if (texts.length === 0) {
      return NextResponse.json({ error: '转写文稿没有可标注的内容' }, { status: 422 });
    }

    const capped = texts.slice(0, MAX_LINES);
    const labels: number[] = [];
    for (let start = 0; start < capped.length; start += BATCH) {
      const chunk = capped.slice(start, start + BATCH);
      const got = await labelChunk(chunk, start);
      labels.push(...got);
    }

    // 改写每行：保留原时间码，插入说话人标签
    const speakerOf = new Map<number, string>();
    idxOf.forEach((lineIdx, j) => {
      if (j >= labels.length) return;
      speakerOf.set(lineIdx, SPEAKER_IDS[labels[j]]);
    });
    const rebuilt = rawLines.map((line, i) => {
      const sp = speakerOf.get(i);
      if (!sp) return line;
      const meta = stripLeadMeta(line);
      const time =
        meta.s != null
          ? `[${msClock(meta.s)}${meta.e != null ? ` - ${msClock(meta.e)}` : ''}]`
          : '';
      return `${time}[${sp}]: ${meta.text}`;
    });
    const newTranscript = rebuilt.join('\n');

    // ASR segments 与文稿行一一对应时，同步写回说话人（逐句字幕分色依赖此字段）
    const patch: Record<string, unknown> = { transcript: newTranscript };
    if (source === 'asr' && Array.isArray(segments) && segments.length === idxOf.length) {
      patch.segments = segments.map((s, j) => ({
        ...s,
        speaker: SPEAKER_IDS[labels[j]] ?? '教师',
      }));
    }
    const { error: upErr } = await db
      .from('ai_analysis_inputs')
      .update(patch)
      .eq('id', row!.id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({
      transcript: newTranscript,
      labeled_lines: labels.length,
      capped: texts.length > capped.length,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof LlmError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error('[transcript] 说话人标注失败', e);
    return NextResponse.json({ error: '说话人标注失败' }, { status: 500 });
  }
}
