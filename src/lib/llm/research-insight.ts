import 'server-only';
import { LlmError, chatJson, isLlmEnabled, llmModel } from '@/lib/llm/deepseek';
import type { CompareResult, LessonDigest, ResearchInsight } from '@/lib/research/compare';

// ============================================================
// 教研中心 · 跨课例 AI 教研洞察（V1.21）
// 输入：2–6 节已分析课例的压缩摘要 + 已算好的对比结果；
// 输出：结构化教研洞察（总述 / 共同亮点 / 关键差异 / 可迁移做法 / 下一步教研建议）。
// 原则：只做「读数据 + 提炼规律」，不修改任何评分；模型不可用时由规则引擎降级，
// 保证这个模块永远能出结果。
// ============================================================

export type { ResearchInsight };

const MAX_ITEM = 160;
const MAX_LIST = 6;

function str(v: unknown, limit = MAX_ITEM): string {
  return typeof v === 'string' ? v.trim().slice(0, limit) : '';
}

function strList(v: unknown, max = MAX_LIST): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x))
    .filter((x) => x.length > 0)
    .slice(0, max);
}

/** 把一节课压成模型可读的一段文本 */
function digestLine(d: LessonDigest, index: number): string {
  const dims = d.dimensions
    .filter((x) => x.score != null)
    .map((x) => `${x.name} ${x.score}`)
    .join('、');
  const topInd = d.indicators
    .filter((i) => i.score != null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 3)
    .map((i) => `${i.name}${i.score}`)
    .join('、');
  const lowInd = d.indicators
    .filter((i) => i.score != null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 3)
    .map((i) => `${i.name}${i.score}`)
    .join('、');
  return [
    `【课例 ${index + 1}】${d.title}`,
    `教师：${d.teacher_name ?? '—'}｜班级：${d.grade_class ?? '—'}｜课型：${d.lesson_type ?? '—'}｜日期：${d.lesson_date ?? '—'}`,
    `综合 ${d.total_score} 分（${d.total_level}）｜内涵：认知 ${d.cognitive ?? '—'}／情感 ${d.affective ?? '—'}（百分制）`,
    `五维：${dims || '—'}`,
    `较强指标：${topInd || '—'}；较弱指标：${lowInd || '—'}`,
    `材料：课堂实录${d.sources.av ? '有' : '无'}／观察记录${d.sources.observer ? '有' : '无'}／任务单${d.sources.task_sheet ? '有' : '无'}；观察点 ${d.scored_points}/${d.total_points}`,
  ].join('\n');
}

/** 对比结果压成「差异清单」文本，让模型只盯着有差的地方 */
function diffLines(cmp: CompareResult, digests: LessonDigest[]): string {
  const lines: string[] = [];
  const nameOf = (i: number | null) =>
    i == null ? '—' : `${digests[i]?.title ?? '?'}（${digests[i]?.teacher_name ?? '—'}）`;

  for (const row of cmp.dims) {
    if (row.spread == null || row.spread < 0.5) continue;
    lines.push(
      `维度「${row.name}」极差 ${row.spread.toFixed(1)}：最高 ${nameOf(row.best)} ${row.values[row.best as number]}｜最低 ${nameOf(row.worst)} ${row.values[row.worst as number]}`,
    );
  }
  for (const row of cmp.essence) {
    if (row.spread == null || row.spread < 3) continue;
    lines.push(
      `内涵「${row.name}」极差 ${row.spread.toFixed(1)}：最高 ${nameOf(row.best)} ${row.values[row.best as number]}｜最低 ${nameOf(row.worst)} ${row.values[row.worst as number]}`,
    );
  }
  for (const row of cmp.indicators.slice(0, 10)) {
    if (row.spread == null || row.spread < 1) continue;
    lines.push(
      `指标「${row.name}」极差 ${row.spread.toFixed(1)}：最高 ${nameOf(row.best)} ${row.values[row.best as number]}｜最低 ${nameOf(row.worst)} ${row.values[row.worst as number]}`,
    );
  }
  return lines.join('\n');
}

/** 规则引擎降级：不依赖模型，直接按极差给出可读洞察 */
export function fallbackInsight(cmp: CompareResult, digests: LessonDigest[]): ResearchInsight {
  const top = digests[cmp.topIndex];
  const bottom = digests[cmp.bottomIndex];
  const biggestDim = [...cmp.dims].sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0))[0];
  const biggestInd = cmp.indicators[0];

  const common: string[] = [];
  for (const row of cmp.dims) {
    const scored = row.values.filter((v) => v != null) as number[];
    if (scored.length === digests.length && row.spread != null && row.spread <= 0.5) {
      common.push(
        `${row.name}：几节课都在 ${scored[0]}–${Math.max(...scored)} 分区间，属于稳定表现，可作为本校经验固化。`,
      );
    }
    if (common.length >= 3) break;
  }

  const differences: { title: string; detail: string }[] = [];
  if (biggestDim && biggestDim.spread != null && biggestDim.spread > 0) {
    differences.push({
      title: `${biggestDim.name} 差异最大（极差 ${biggestDim.spread.toFixed(1)} 分）`,
      detail: `最高来自「${digests[biggestDim.best ?? 0]?.title ?? '—'}」，最低来自「${digests[biggestDim.worst ?? 0]?.title ?? '—'}」。这是两节课最值得对照的环节，建议直接调出这两节课在该维度的证据片段逐条比对。`,
    });
  }
  if (biggestInd && biggestInd.spread != null && biggestInd.spread > 0) {
    differences.push({
      title: `指标「${biggestInd.name}」差距最明显（极差 ${biggestInd.spread.toFixed(1)}）`,
      detail: `最高 ${digests[biggestInd.best ?? 0]?.teacher_name ?? '—'} 老师 ${biggestInd.values[biggestInd.best as number]} 分，最低 ${digests[biggestInd.worst ?? 0]?.teacher_name ?? '—'} 老师 ${biggestInd.values[biggestInd.worst as number]} 分。两者在任务设计或追问方式上的差别，通常就是分数差的主要来源。`,
    });
  }

  const transferables: string[] = [];
  if (top) {
    const strong = top.dimensions
      .filter((d) => d.score != null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 2);
    for (const s of strong) {
      transferables.push(
        `「${top.title}」在「${s.name}」拿到 ${s.score} 分，可作为该维度的做法样例，先拆出它的环节设计再迁移到其他班。`,
      );
    }
  }

  const next: string[] = [];
  if (bottom) {
    const weak = bottom.dimensions
      .filter((d) => d.score != null)
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
      .slice(0, 2);
    for (const w of weak) {
      next.push(
        `下一次集体备课优先攻「${w.name}」（「${bottom.title}」仅 ${w.score} 分），可对照高分课例的同类环节改写。`,
      );
    }
  }
  if (cmp.totalSpread >= 5) {
    next.push(
      `几节课综合分极差 ${cmp.totalSpread.toFixed(1)} 分，差异已超出误差范围，建议以高分课为样板做一次同课再上，观察差距是否能收敛。`,
    );
  }

  return {
    overview: top
      ? `本次对比 ${digests.length} 节课，综合分从 ${digests[cmp.bottomIndex]?.total_score ?? '—'} 到 ${digests[cmp.topIndex]?.total_score ?? '—'}，极差 ${cmp.totalSpread.toFixed(1)} 分。${top.title} 综合最高，${bottom?.title ?? ''} 相对偏低；差异集中在「${biggestDim?.name ?? '—'}」这一维度，适合作为本次教研的主攻方向。`
      : '参与的课例过少，暂无法给出对比洞察。',
    commonalities:
      common.length > 0 ? common : ['各节课在五维上的分布较为接近，暂无跨课例的稳定共同点。'],
    differences,
    transferables:
      transferables.length > 0
        ? transferables
        : ['暂未识别出明显可迁移的高分做法，建议先补齐材料后再对比。'],
    next_steps:
      next.length > 0 ? next : ['建议同一课题再做一轮，用同一份材料口径复核分数是否稳定。'],
    degraded: true,
  };
}

const SYSTEM_PROMPT = [
  '你是中学数学教研员，熟悉「情智相长」课堂评价体系（五维：情智融合教学设计、数学高阶思维发展、数学情感素养培育、情智共生课堂实施、反思反馈与素养生成；另有认知/情感内涵观察点）。',
  '现在给你若干节已评分课例的摘要与跨课例差异清单，请输出一份教研洞察，用于教师集体备课与观课改进。',
  '硬性要求：',
  '1) 只依据给定数据推理，引用具体分数与指标名；不得编造未给出的课堂细节（如具体话术、学生姓名）。',
  '2) 分数差在 0.5 分（10 分制）以内的不要当作差异；差异必须落到具体维度/指标。',
  '3) 语言面向一线数学教师，具体、可执行，不用空话套话。',
  '4) 严格输出 JSON，字段：overview（2-3 句总述）、commonalities（共同亮点，2-4 条）、differences（关键差异数组，每项 {title, detail}，2-4 项）、transferables（可迁移做法，2-4 条）、next_steps（下一步教研建议，2-4 条）。',
  '5) 每条不超过 80 字。',
].join('\n');

/**
 * 生成跨课例教研洞察。未配置密钥或调用失败时抛 LlmError，
 * 由调用方捕获后降级到 fallbackInsight（页面仍能出结果）。
 */
export async function generateResearchInsight(
  digests: LessonDigest[],
  cmp: CompareResult,
): Promise<ResearchInsight> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');
  if (digests.length < 2) throw new LlmError('至少需要两节课才能生成对比洞察');

  const userPrompt = [
    `参与对比的课例（共 ${digests.length} 节）：`,
    ...digests.map((d, i) => digestLine(d, i)),
    '',
    '跨课例差异清单（已按极差排序）：',
    diffLines(cmp, digests) || '（各维度差异都很小）',
  ].join('\n');

  const raw = await chatJson<Record<string, unknown>>(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.3, maxTokens: 2200, timeoutMs: 50_000 },
  );

  const differences = Array.isArray(raw.differences)
    ? (raw.differences as unknown[])
        .map((x) => {
          const o = (x ?? {}) as { title?: unknown; detail?: unknown };
          return { title: str(o.title, 80), detail: str(o.detail, 240) };
        })
        .filter((x) => x.title.length > 0 && x.detail.length > 0)
        .slice(0, MAX_LIST)
    : [];

  const overview = str(raw.overview, 400);
  if (!overview) throw new LlmError('AI 未返回有效洞察');

  return {
    overview,
    commonalities: strList(raw.commonalities),
    differences,
    transferables: strList(raw.transferables),
    next_steps: strList(raw.next_steps),
    model: llmModel(),
  };
}
