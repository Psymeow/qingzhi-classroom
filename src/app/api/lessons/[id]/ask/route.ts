import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { chatText, LlmError, type ChatMessage } from '@/lib/llm/deepseek';
import {
  formatScholarForPrompt,
  looksLikeResearchQuestion,
  scholarSearch,
  type ScholarResult,
} from '@/lib/search/scholar';
import { msToClock, normalizeSegments, segmentsFromTranscript } from '@/lib/report/timeline';
import type { AnalysisReport } from '@/lib/evaluation/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ============================================================
// 「情智相长」问答助手
// 知识库 = 课堂实录（带时间码）+ 教学设计 + 观察记录 + 任务单 + 平台分析结论；
// 需要外部依据时追加免费学术检索（OpenAlex/Crossref/arXiv，失败静默降级）。
// ============================================================

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface AskBody {
  question?: string;
  history?: ChatTurn[];
  /** 是否允许联网检索，默认 true；是否真的触发由问题是否需要外部依据决定 */
  use_web?: boolean;
}

const SYSTEM_PROMPT = `你是「情智相长课堂分析工作台」里的教研问答助手，服务数学教研员和听课教师。

回答要求：
1. 先直接回答，再给依据。不要复述问题，不要客套开场。
2. 引用材料时在句中标注来源，格式固定：
   - 课堂实录：【实录 mm:ss】（用该段真实时间码，例如【实录 08:12】）
   - 教学设计：【教学设计】
   - 观察记录：【观察记录】
   - 学生任务单：【任务单】
   - 平台分析结论：【分析结论】
   - 外部检索到的文献：【文献 N】（N 为文献列表序号）
3. 材料里没有的信息，直接说"课例材料里没有提到"，不要编造课堂细节、分数或对话。
4. 问到"有没有研究依据/理论支撑"且给了文献列表时，结合文献回答，并说明这是外部检索到的研究，不是这节课本身的证据。
5. 中文回答，面向教师，专业但不堆术语。默认 400 字以内，问题确实复杂时可以更长，但要有小标题或分点。
6. 平台分析结论与你的判断冲突时，以课例材料原文为准，并把冲突点说清楚。
7. 不要输出与问题无关的寒暄、免责声明或"作为AI助手"之类的话。`;

/** 把分析结论压成一段给模型看的摘要（模型不需要看完整 json） */
function summarizeReport(report: AnalysisReport | null): string {
  if (!report) return '';
  const lines: string[] = [];
  const total = [report.total_score, report.total_level].filter(Boolean).join(' / ');
  if (total) lines.push(`综合评价：${total}`);

  const e = report.essence_eval;
  if (e) {
    const fmt = (
      d:
        | {
            name: string;
            score: number | null;
            indicators?: Array<{ name: string; score: number | null }>;
          }
        | undefined,
    ): string => {
      if (!d) return '';
      const scored = (d.indicators ?? []).filter((i) => i.score !== null) as Array<{ name: string; score: number }>;
      const byScore = [...scored].sort((a, b) => b.score - a.score);
      const top = byScore
        .slice(0, 3)
        .map((i) => `${i.name} ${i.score}`)
        .join('、');
      const low = byScore
        .slice(-3)
        .reverse()
        .map((i) => `${i.name} ${i.score}`)
        .join('、');
      return [
        `${d.name}：${d.score ?? '未评'}`,
        top ? `靠前 ${top}` : '',
        low ? `靠后 ${low}` : '',
      ]
        .filter(Boolean)
        .join('；');
    };
    const cLine = fmt(e.cognitive);
    const aLine = fmt(e.affective);
    if (cLine) lines.push(cLine);
    if (aLine) lines.push(aLine);
  }

  // DimensionResult 只有 dimension_code（D1..D5），中文名在标准定义里；
  // 问答场景 code + 分档标签够模型定位，不为此再查一次标准表
  const dims = (report.dimension_results ?? [])
    .slice(0, 8)
    .map((d) => `${d.dimension_code} ${d.score ?? '未评'}${d.level_label ? `（${d.level_label}）` : ''}`);
  if (dims.length) lines.push(`五维得分：${dims.join('、')}`);

  const c = report.ai_commentary;
  if (c) {
    const hi = (c.highlights ?? []).slice(0, 3);
    const act = (c.action_items ?? []).slice(0, 3);
    if (hi.length) lines.push(`亮点：${hi.join('；')}`);
    if (act.length) lines.push(`改进建议：${act.join('；')}`);
    if (c.summary) lines.push(`整体评语：${c.summary.slice(0, 400)}`);
  }
  return lines.filter(Boolean).join('\n');
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}\n……（已截断，全文 ${t.length} 字）` : t;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as AskBody;
    const question = (body.question ?? '').trim();
    if (!question) return NextResponse.json({ error: '问题不能为空' }, { status: 400 });
    if (question.length > 2000) return NextResponse.json({ error: '问题太长了，请控制在 2000 字以内' }, { status: 400 });

    // ---- 知识库：课例四路材料 + 最新分析结论 ----
    const [inputRes, repRes, lessonRes] = await Promise.all([
      db
        .from('ai_analysis_inputs')
        .select('transcript,observer_text,task_sheet_text,lesson_plan_text,segments')
        .eq('lesson_id', id)
        .eq('user_id', user.id)
        .maybeSingle(),
      db
        .from('reports')
        .select('result,total_score,total_level')
        .eq('lesson_id', id)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db
        .from('lessons')
        .select('title,teacher_name,school,grade_class,lesson_type,lesson_date')
        .eq('id', id)
        .maybeSingle(),
    ]);
    if (inputRes.error) return NextResponse.json({ error: inputRes.error.message }, { status: 500 });

    const input = inputRes.data;
    const rawTranscript = (input?.transcript ?? '').trim();
    const planText = (input?.lesson_plan_text ?? '').trim();
    const observerText = (input?.observer_text ?? '').trim();
    const sheetText = (input?.task_sheet_text ?? '').trim();
    const report = (repRes.data?.result ?? null) as AnalysisReport | null;
    const meta = lessonRes.data;

    // 时间轴来源要分清：ASR 给的是毫秒级结构化 segments；手动上传的文稿是 [mm:ss] 行首时间码。
    // 回答里的【实录 mm:ss】要能一键跳回视频，所以优先用结构化数据，其次按时间码解析，都没有才用纯文本。
    const structured = normalizeSegments(input?.segments as Array<{ s: number; e: number; t: string }> | null);
    const segments = structured.length
      ? structured
      : rawTranscript
        ? segmentsFromTranscript(rawTranscript)
        : [];
    const timelineSource: 'asr' | 'transcript' | 'none' = structured.length
      ? 'asr'
      : segments.length
        ? 'transcript'
        : 'none';
    const transcriptForPrompt = segments.length
      ? segments.map((s) => `[${msToClock(s.s)}] ${s.t}`).join('\n')
      : rawTranscript;

    // ---- 联网检索：只在明显要外部依据时触发，失败静默降级 ----
    const wantWeb = body.use_web !== false && looksLikeResearchQuestion(question);
    let webResults: ScholarResult[] = [];
    if (wantWeb) {
      try {
        webResults = await scholarSearch(question, { perSource: 4 });
      } catch (e) {
        console.warn('[ask] 学术检索失败，降级为纯课例知识库：', e instanceof Error ? e.message : String(e));
        webResults = [];
      }
    }

    // ---- 组装知识库 ----
    const kbParts: string[] = [];
    if (transcriptForPrompt) kbParts.push(`【课堂实录（行首为时间码）】\n${clip(transcriptForPrompt, 14000)}`);
    if (planText) kbParts.push(`【教学设计 / 教案】\n${clip(planText, 4000)}`);
    if (observerText) kbParts.push(`【课堂观察记录】\n${clip(observerText, 4000)}`);
    if (sheetText) kbParts.push(`【学生任务单】\n${clip(sheetText, 3000)}`);
    const reportSummary = summarizeReport(report);
    if (reportSummary) kbParts.push(`【平台分析结论】\n${reportSummary}`);

    if (!kbParts.length) {
      return NextResponse.json(
        { error: '这节课还没有可问的材料：先到「数据接入」上传实录、教案或观察记录。' },
        { status: 400 },
      );
    }

    const metaLine = [
      meta?.title,
      meta?.teacher_name ? `${meta.teacher_name} 老师` : '',
      meta?.grade_class,
      meta?.lesson_date ? String(meta.lesson_date).slice(0, 10) : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const userText = [
      metaLine ? `【课例】${metaLine}` : '',
      kbParts.join('\n\n'),
      webResults.length
        ? `【外部检索文献】以下是联网检索到的研究，仅供回答"有没有依据/理论支撑"这类问题时参考：\n\n${formatScholarForPrompt(webResults)}`
        : '',
      `【本次问题】${question}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    // ---- 多轮：只保留最近几轮，避免上下文爆掉 ----
    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    for (const t of (body.history ?? []).slice(-6)) {
      if (!t?.content || (t.role !== 'user' && t.role !== 'assistant')) continue;
      messages.push({ role: t.role, content: clip(t.content, 800) });
    }
    messages.push({ role: 'user', content: userText });

    const answer = await chatText(messages, { maxTokens: 1800, timeoutMs: 60_000 });

    return NextResponse.json({
      answer,
      web_used: webResults.length > 0,
      web_results: webResults.map((r) => ({
        title: r.title,
        authors: r.authors,
        year: r.year,
        venue: r.venue,
        url: r.url,
        source: r.source,
      })),
      transcript_source: timelineSource,
      has_material: true,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof LlmError) return NextResponse.json({ error: e.message }, { status: 503 });
    console.error('[ask] 问答失败：', e);
    return NextResponse.json({ error: '问答服务暂时不可用' }, { status: 500 });
  }
}
