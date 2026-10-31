import 'server-only';
import { LlmError, chatJson, isLlmEnabled, llmModel } from '@/lib/llm/deepseek';
import { fallbackStandard, subjectLabel } from '@/lib/evaluation/standard-registry';
import { behaviorHintText } from '@/lib/evaluation/behavior-library';
import type {
  AiCommentary,
  AnalysisReport,
  DimensionResult,
  RubricStandard,
} from '@/lib/evaluation/types';

// ============================================================
// AI 报告评语生成（DeepSeek）
// 输入已生成的量化分析报告，输出面向教师的教学结论、课堂亮点与改进建议。
// 仅做解读与建议，不修改任何评分数据。
// ============================================================

const MAX_HIGHLIGHTS = 4;
const MAX_SUGGESTIONS = 4;
const MAX_ACTIONS = 3;

interface RawCommentary {
  summary?: unknown;
  highlights?: unknown;
  suggestions?: unknown;
  essence_coupling?: unknown;
  action_items?: unknown;
}

function dimTitle(d: DimensionResult, std: RubricStandard): string {
  return std.dimensions.find((x) => x.code === d.dimension_code)?.name ?? d.dimension_code;
}

/** 把量化报告压缩成模型可读的摘要，避免把整份 JSON 塞进 prompt */
function buildDigest(report: AnalysisReport, std: RubricStandard): string {
  const lines: string[] = [];
  lines.push(`综合得分：${report.total_score} / 100，等级「${report.total_level}」`);

  const reviewDims = report.dimension_results.filter((d) => d.need_review);
  if (reviewDims.length > 0) {
    lines.push(`存在 ${reviewDims.length} 个维度多源分歧待人工复核。`);
  }

  lines.push('', '【五维得分】');
  for (const d of report.dimension_results) {
    lines.push(`- ${d.dimension_code} ${dimTitle(d, std)}：${d.score} 分（${d.level_label}）`);
    const scored = d.indicators.filter((i) => i.score !== null);
    if (scored.length) {
      const sorted = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const top = sorted.slice(0, 2).map((i) => `${i.indicator_code}(${i.score})`);
      const low = sorted.slice(-2).reverse().map((i) => `${i.indicator_code}(${i.score})`);
      lines.push(`  表现较好指标：${top.join('、') || '—'}；相对薄弱指标：${low.join('、') || '—'}`);
    }
    const evidence = d.evidences?.[0];
    if (evidence) lines.push(`  代表性证据：${evidence.slice(0, 120)}`);
  }

  // 情智双侧：分别呈现两个向度的水平，不提供高低比较信息。
  // 早期版本直接喂给模型「情智落差：X 分（认知高于情感）」，评语自然会带出
  // 「智强情弱」这类跨向度比较结论——而认知与情感本就不是同一把尺子上的两点。
  const dimOf = (code: string) =>
    report.dimension_results.find((d) => d.dimension_code === code) ?? null;
  const d2 = dimOf('D2');
  const d3 = dimOf('D3');
  if (d2 || d3) {
    lines.push('', '【情智双侧】');
    if (d2?.score != null) {
      lines.push(`- 认知侧（数学高阶思维）：${(d2.score * 10).toFixed(1)} / 100`);
    }
    if (d3?.score != null) {
      lines.push(`- 情感侧（数学情感素养）：${(d3.score * 10).toFixed(1)} / 100`);
    }
  }
  const ess = report.essence_eval;
  if (ess?.llm_used) {
    const weakPoints = [...ess.cognitive.indicators, ...ess.affective.indicators]
      .filter((i) => i.score !== null && (i.score ?? 0) < 6)
      .slice(0, 4)
      .map((i) => `${i.name}(${i.score})`);
    if (weakPoints.length) lines.push(`- 偏弱观察指标：${weakPoints.join('、')}`);
  }

  // —— 全局弱项/强项清单：让建议严格按分数从低到高取材，避开最强项 ——
  // 五维二级指标与情智观察点指标两套 score 均为 0-10 同制式，可统一排序、按 code 去重。
  // 弱项：五维升序前 6 + 情智升序前 6，合并统一升序、去重后最多 10 条；
  // 强项：全量（两套并集）降序、去重后取最高 3 条。
  type ScoredItem = { code: string; label: string; score: number };
  const byScoreAsc = (a: ScoredItem, b: ScoredItem) =>
    a.score - b.score || a.code.localeCompare(b.code);

  const primaryItems: ScoredItem[] = [];
  const essenceItems: ScoredItem[] = [];
  for (const d of report.dimension_results) {
    for (const i of d.indicators) {
      if (i.score !== null && i.score !== undefined) {
        primaryItems.push({
          code: i.indicator_code,
          label: i.name ?? i.indicator_code,
          score: i.score,
        });
      }
    }
  }
  if (ess?.llm_used) {
    for (const i of [...ess.cognitive.indicators, ...ess.affective.indicators]) {
      if (i.score !== null && i.score !== undefined) {
        essenceItems.push({ code: i.code, label: i.name, score: i.score });
      }
    }
  }

  const weakCandidates = [
    ...[...primaryItems].sort(byScoreAsc).slice(0, 6),
    ...[...essenceItems].sort(byScoreAsc).slice(0, 6),
  ].sort(byScoreAsc);

  const weakList: ScoredItem[] = [];
  const seenWeak = new Set<string>();
  for (const it of weakCandidates) {
    if (seenWeak.has(it.code)) continue;
    seenWeak.add(it.code);
    weakList.push(it);
    if (weakList.length >= 10) break;
  }

  if (weakList.length) {
    lines.push('', '【全局最弱指标】');
    for (const it of weakList) lines.push(`- ${it.label}(${it.score})`);
  }

  const strongList = [...primaryItems, ...essenceItems]
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .filter((it, idx, arr) => arr.findIndex((x) => x.code === it.code) === idx)
    .slice(0, 3);

  if (strongList.length) {
    lines.push('', '【本课最强指标】');
    for (const it of strongList) lines.push(`- ${it.label}(${it.score})`);
  }

  return lines.join('\n');
}

function toStringArray(v: unknown, limit: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 300))
    .slice(0, limit);
}

/**
 * 依据量化报告生成 AI 评语。
 * 未配置密钥或调用失败时抛 LlmError，由调用方捕获后留空评语。
 */
export async function generateCommentary(
  report: AnalysisReport,
  standard: RubricStandard = fallbackStandard(),
): Promise<AiCommentary> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');

  // 薄弱维度：分数非空、升序取 2 个；若其中存在 score < 7 的维度则最多取 3 个。
  // 只取真正需要改进的方向，不罗列所有低分项（避免建议变成低分清单）。
  const ranked = report.dimension_results
    .filter((d) => d.score !== null && d.score !== undefined)
    .sort((a, b) => (a.score as number) - (b.score as number));
  const weakDims = ranked.slice(0, ranked.some((d) => (d.score as number) < 7) ? 3 : 2).map((d) => d.dimension_code);

  const raw = await chatJson<RawCommentary>(
    [
      {
        role: 'system',
        content: [
          `你是${subjectLabel(standard.subject)}教研专家，熟悉「${standard.name}」评价模型。`,
          '你会收到一份课堂量化分析报告摘要，需要为授课教师写一段专业、具体、可操作的教学反馈。',
          '要求：结论必须建立在给定数据之上，不夸大、不空泛；建议要指向具体教学行为，避免套话。',
          '评价采用发展性口径：先陈述已经达成的表现，再说明下一步可以拓展的方向；避免使用「薄弱」「偏低」「不理想」「较差」「不足」等判定性词语。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '【课堂量化分析报告摘要】',
          buildDigest(report, standard),
          '',
          // behaviorHintText 无匹配时返回空串，整段省略（不留空标题）
          ...(behaviorHintText(weakDims)
            ? [
                '【可选教学行为库】（已按本课薄弱维度筛选；建议与动作优先从中取材，可结合学情改编，但不要凭空编造行为名称）',
                behaviorHintText(weakDims),
                '',
              ]
            : []),
          '【写作要求】',
          '1. summary：总体结论，2-4 句，先说整体水平与最突出的特征，再点出最值得继续投入的一两个方向。若综合得分低于 60 / 100，须直接说明「本课整体得分偏低」，不使用「中等水平」这类模糊表述。',
          '2. highlights：课堂亮点，2-4 条，每条一句话，须与高分维度/指标对应。',
          '3. suggestions：教学改进建议，2-4 条，必须按分数从低到高取材，第一条针对【全局最弱指标】里分数最低的那一项；不对【本课最强指标】中的任何一项提改进建议。',
          '4. essence_coupling：情智关系解读，1-2 句。必须点明「情感体验」与「认知发展」在本节课是怎样互相支撑的（如好奇/安全感支撑了试错与推理），或在哪一环还可以互相助推得更紧（如热闹的参与尚未转化为深度思考）。不要复述分数。',
          '5. action_items：可执行动作，恰好 3 条，每条一句话，写成下一个课时就能改的具体教学行为（含动作、对象、时长或位置），不要写「加强…」「注重…」这类方向性表述，优先从【可选教学行为库】中选取适配做法。三条动作应分别对应【全局最弱指标】中三个不同指标，不要集中在同一维度。',
          '6. 全部使用中文，不使用 Markdown 标记，不使用编号前缀。',
          '7. 任何字段都不要出现行为编号或指标代码（如 A1、B5、C3、D2、E1、D2-3 等）。提到教学行为时只写行为名称，例如写「分层任务」而不是「分层任务（B5）」；提到指标时只写指标名称。',
          '',
          '严格按以下 JSON 结构输出，不要输出任何其他内容：',
          '{"summary":"总体结论","highlights":["亮点1","亮点2"],"suggestions":["建议1","建议2"],"essence_coupling":"情智关系解读","action_items":["动作1","动作2","动作3"]}',
        ].join('\n'),
      },
    ],
    { temperature: 0.4, maxTokens: 2048 },
  );

  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 1200) : '';
  if (!summary) throw new LlmError('DeepSeek 未返回有效评语');

  const essenceCoupling =
    typeof raw.essence_coupling === 'string' ? raw.essence_coupling.trim().slice(0, 600) : '';

  return {
    summary,
    highlights: toStringArray(raw.highlights, MAX_HIGHLIGHTS),
    suggestions: toStringArray(raw.suggestions, MAX_SUGGESTIONS),
    ...(essenceCoupling ? { essence_coupling: essenceCoupling } : {}),
    action_items: toStringArray(raw.action_items, MAX_ACTIONS),
    model: llmModel(),
    generated_at: new Date().toISOString(),
  };
}
