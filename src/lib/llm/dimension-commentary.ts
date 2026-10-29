import 'server-only';
import { LlmError, chatJson, isLlmEnabled } from '@/lib/llm/deepseek';
import { fallbackStandard, subjectLabel } from '@/lib/evaluation/standard-registry';
import { SOURCE_LABEL } from '@/lib/evaluation/types';
import type {
  AnalysisReport,
  DimensionInterpretation,
  DimensionResult,
  RubricStandard,
} from '@/lib/evaluation/types';

// ============================================================
// 维度级 AI 解读生成（DeepSeek）
// 为报告里的每个维度回答四问：评分依据/素材、为什么是这个分、
// 如何解读、如何提升（补材料 + 改教学）。
// 按需生成（查看报告时触发），不占用分析阶段的 AI 总时限；
// 生成结果随报告落库，失败抛 LlmError 由调用方降级。
// 仅做解读与建议，不修改任何评分数据。
// ============================================================

/** 单字段字数上限：防模型跑飞，也保证折叠区可读 */
const MAX_FIELD = 1400;

interface RawInterp {
  dimension_code?: unknown;
  basis?: unknown;
  why?: unknown;
  how_to_read?: unknown;
  how_to_improve?: unknown;
}

function dimTitle(d: DimensionResult, std: RubricStandard): string {
  return std.dimensions.find((x) => x.code === d.dimension_code)?.name ?? d.dimension_code;
}

function str(v: unknown, limit = MAX_FIELD): string {
  return typeof v === 'string' ? v.trim().slice(0, limit) : '';
}

/**
 * 把五维结果压缩成模型可读摘要：四问只能从这里推理，
 * 不把整份报告 JSON 塞进 prompt。
 */
function buildDigest(report: AnalysisReport, std: RubricStandard): string {
  const lines: string[] = [];
  const avail = (Object.keys(report.source_availability) as Array<
    keyof typeof report.source_availability
  >)
    .filter((k) => report.source_availability[k])
    .map((k) => SOURCE_LABEL[k]);
  lines.push(
    `综合得分 ${report.total_score} / 100（${report.total_level}）；本次可用材料：${avail.join('、') || '无'}。`,
  );

  for (const d of report.dimension_results) {
    lines.push('', `【${dimTitle(d, std)}｜维度码 ${d.dimension_code}】`);
    lines.push(`得分 ${d.score === null ? '未评' : d.score}（等级 ${d.level_label ?? '—'}）`);
    if (d.need_review) lines.push('状态：多源分歧/对账缺口，待人工复核。');
    const cal = report.calibrations?.find((c) => c.dimension_code === d.dimension_code);
    if (cal && cal.final_score !== null) {
      lines.push(
        `已人工终裁为 ${cal.final_score} 分${cal.review_note ? `（终裁理由：${cal.review_note}）` : ''}。`,
      );
    }
    const scored = d.indicators.filter((i) => i.score !== null);
    if (scored.length > 0) {
      lines.push(
        `二级指标（${scored.length}/${d.indicators.length} 项有分）：${scored
          .map((i) => `${i.name ?? i.indicator_code} ${i.score}`)
          .join('、')}`,
      );
    }
    const srcs = d.source_scores.filter((s) => s.score !== null);
    if (srcs.length > 0) {
      lines.push(`各材料评分：${srcs.map((s) => `${SOURCE_LABEL[s.source]} ${s.score}`).join('、')}`);
    }
    const evs = (d.evidences ?? []).slice(0, 4);
    if (evs.length > 0) {
      lines.push('代表性证据：');
      evs.forEach((e) => lines.push(`· ${e.slice(0, 160)}`));
    }
  }

  return lines.join('\n');
}

/**
 * 依据量化报告生成各维度的 AI 解读。
 * 未配置密钥或调用失败时抛 LlmError，由调用方捕获后留空（UI 显示失败与重试）。
 */
export async function generateDimensionInterpretations(
  report: AnalysisReport,
  standard: RubricStandard = fallbackStandard(),
): Promise<DimensionInterpretation[]> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');

  const raw = await chatJson<{ interpretations?: unknown }>(
    [
      {
        role: 'system',
        content: [
          `你是${subjectLabel(standard.subject)}教研专家，熟悉「${standard.name}」评价模型。`,
          '你会收到一份课堂量化报告的五维摘要，需要为每个维度写四段面向授课教师的解读。',
          '要求：结论必须严格建立在给定数据之上，不编造材料、不夸大；具体、可执行，不使用 Markdown 标记与编号前缀。',
          '评价采用发展性口径：先陈述已经达成的表现，再说明下一步可以拓展的方向；避免使用「薄弱」「偏低」「不理想」「较差」「不足」等判定性词语。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '【课堂量化报告五维摘要】',
          buildDigest(report, standard),
          '',
          '【写作要求——每个维度写以下四段】',
          '1. basis（评分依据与素材）：这个分数用了哪些材料（课堂转写、学生任务单、观察员记录、教学设计、人工标注等）和哪些二级指标/证据支撑；材料缺失导致依据不足时如实点明缺了什么。80~160 字。',
          '2. why（为什么这节课这个维度评这个分）：把证据和分数串起来讲清推理——这节课在这个维度上做对了什么、哪些课堂行为把分拉低了，让教师看懂分数是怎么算出来的。80~160 字。',
          '3. how_to_read（如何解读这个分）：说明这个等级意味着什么、在五个维度中处于什么位置、阅读时要注意什么边界（如仅依据单一材料、该维度待复核）。60~140 字。',
          '4. how_to_improve（如何提升这个维度的评分）：分两层写——先写还可以补充哪些类型的材料（例如学生任务单、观察员记录表、课堂录像片段、教案与任务设计说明）来补上判分依据；再写教学环节的设计与实施怎么优化，落到具体环节、教学行为、对象或时长，不写「加强…」「注重…」这类空话。100~200 字。',
          '5. 全部使用中文；摘要里出现的每个维度都要输出一条，dimension_code 必须与摘要一致；材料确实缺失的维度，提升建议要优先指向补充材料。',
          '',
          '严格按以下 JSON 结构输出，不要输出任何其他内容：',
          '{"interpretations":[{"dimension_code":"维度码","basis":"","why":"","how_to_read":"","how_to_improve":""}]}',
        ].join('\n'),
      },
    ],
    { temperature: 0.4, maxTokens: 6000, timeoutMs: 50_000 },
  );

  const codes = report.dimension_results.map((d) => d.dimension_code);
  const codeSet = new Set(codes);
  const list = Array.isArray(raw.interpretations) ? raw.interpretations : [];
  const byCode = new Map<string, DimensionInterpretation>();
  for (const item of list) {
    const r = item as RawInterp | null;
    const code = typeof r?.dimension_code === 'string' ? r.dimension_code.trim() : '';
    if (!code || !codeSet.has(code) || byCode.has(code)) continue;
    const basis = str(r?.basis);
    const why = str(r?.why);
    const howToRead = str(r?.how_to_read);
    const howToImprove = str(r?.how_to_improve);
    if (!basis || !why || !howToRead || !howToImprove) continue;
    byCode.set(code, { dimension_code: code, basis, why, how_to_read: howToRead, how_to_improve: howToImprove });
  }
  if (byCode.size === 0) throw new LlmError('DeepSeek 未返回有效的维度解读');

  // 按报告维度顺序返回，缺的维度 UI 自动不渲染
  return codes.filter((c) => byCode.has(c)).map((c) => byCode.get(c)!);
}
