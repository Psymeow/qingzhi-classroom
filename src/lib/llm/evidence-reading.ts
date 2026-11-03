import 'server-only';
import { LlmError, chatJson, isLlmEnabled } from '@/lib/llm/deepseek';
import { fallbackStandard, subjectLabel } from '@/lib/evaluation/standard-registry';
import { SOURCE_LABEL } from '@/lib/evaluation/types';
import type {
  AnalysisReport,
  DataSource,
  DimensionResult,
  EvidenceReading,
  RubricStandard,
} from '@/lib/evaluation/types';

// ============================================================
// 逐条证据解读生成（DeepSeek，B2）
// 把孤立引文变成「谁说了什么 → 这说明了什么 → 为什么支撑这个分」，
// 让教师读懂每条证据与分数的关系，而不只看到一句裸引文。
// 按需生成（查看报告时触发），随报告落库；仅做解读，不修改任何评分数据。
// ============================================================

/** 单条解读字数上限：保证证据区可读，也防模型跑飞 */
const MAX_READING = 220;

interface RawReading {
  dimension_code?: unknown;
  quote?: unknown;
  reading?: unknown;
}

function dimTitle(d: DimensionResult, std: RubricStandard): string {
  return std.dimensions.find((x) => x.code === d.dimension_code)?.name ?? d.dimension_code;
}

function str(v: unknown, limit = MAX_READING): string {
  return typeof v === 'string' ? v.trim().slice(0, limit) : '';
}

/** 收集本维度要解读的证据：优先各来源分组，回退到维度级证据，去重保序。 */
function collectQuotes(d: DimensionResult): Array<{ quote: string; source: DataSource }> {
  const out: Array<{ quote: string; source: DataSource }> = [];
  const seen = new Set<string>();
  const push = (quote: string, source: DataSource) => {
    const q = quote.trim();
    if (!q || seen.has(q)) return;
    seen.add(q);
    out.push({ quote: q, source });
  };
  for (const s of d.source_scores) {
    for (const ev of s.evidences.slice(0, 4)) push(ev, s.source);
  }
  if (out.length === 0) {
    for (const ev of (d.evidences ?? []).slice(0, 5)) push(ev, 'av_transcript');
  }
  return out;
}

/** 把五维结果压成模型可读摘要，只保留写解读要用的字段。 */
function buildDigest(report: AnalysisReport, std: RubricStandard): string {
  const lines: string[] = [];
  lines.push('综合得分 ' + report.total_score + ' / 100（' + report.total_level + '）。');
  for (const d of report.dimension_results) {
    const quotes = collectQuotes(d);
    if (quotes.length === 0) continue;
    const scoreText = d.score === null ? '未评' : String(d.score);
    lines.push('', '【' + dimTitle(d, std) + '｜维度码 ' + d.dimension_code + '｜得分 ' + scoreText + '（' + (d.level_label ?? '—') + '）】');
    const scored = d.indicators.filter((i) => i.score !== null);
    if (scored.length > 0) {
      lines.push('二级指标：' + scored.map((i) => (i.name ?? i.indicator_code) + ' ' + i.score).join('、'));
    }
    lines.push('要解读的证据：');
    quotes.forEach((q, i) => lines.push(String(i + 1) + '. [' + SOURCE_LABEL[q.source] + '] ' + q.quote.slice(0, 200)));
  }
  return lines.join('\n');
}

/**
 * 为报告各维度的证据生成逐条解读。
 * 未配置密钥或调用失败时抛 LlmError，由调用方捕获后留空（UI 显示失败与重试）。
 */
export async function generateEvidenceReadings(
  report: AnalysisReport,
  standard: RubricStandard = fallbackStandard(),
): Promise<EvidenceReading[]> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');

  const raw = await chatJson<{ readings?: unknown }>(
    [
      {
        role: 'system',
        content: [
          '你是' + subjectLabel(standard.subject) + '教研专家，熟悉「' + standard.name + '」评价模型。',
          '你会收到课堂量化报告的五维摘要与每条证据，需要为每条证据写一句解读。',
          '要求：结论严格建立在给定数据与证据之上，不编造材料、不夸大；具体、可执行，不使用 Markdown 标记与编号前缀。',
          '评价采用发展性口径：陈述证据反映了教师的什么表现，避免「薄弱」「偏低」「不理想」「较差」等判定性词语。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '【课堂量化报告摘要】',
          buildDigest(report, standard),
          '',
          '【写作要求——为上面每条证据各写一句 reading】',
          '1. 先点明这句话体现了课堂中的什么（教师的什么行为或学生的什么反应），再说明它为什么支撑该维度的分数，让教师看懂这条证据和分数的关系。',
          '2. 40~100 字，一句连贯的话，不分行、不加编号、不重复引文原文。',
          '3. 全部使用中文；dimension_code 与 quote 必须与摘要完全一致，逐条对应，不要遗漏或多写。',
          '',
          '严格按以下 JSON 结构输出，不要输出任何其他内容：',
          '{"readings":[{"dimension_code":"维度码","quote":"证据原文","reading":""}]}',
        ].join('\n'),
      },
    ],
    { temperature: 0.4, maxTokens: 6000, timeoutMs: 50_000 },
  );

  // 摘要里实际要解读的 (维度, 证据) 集合，用于校验与去重
  const valid = new Map<string, Set<string>>();
  for (const d of report.dimension_results) {
    const set = new Set(collectQuotes(d).map((q) => q.quote));
    if (set.size > 0) valid.set(d.dimension_code, set);
  }

  const list = Array.isArray(raw.readings) ? raw.readings : [];
  const out: EvidenceReading[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const r = item as RawReading | null;
    const code = typeof r?.dimension_code === 'string' ? r.dimension_code.trim() : '';
    const quote = typeof r?.quote === 'string' ? r.quote.trim() : '';
    const reading = str(r?.reading);
    if (!code || !quote || !reading) continue;
    const quotes = valid.get(code);
    if (!quotes || !quotes.has(quote)) continue;
    const key = code + ' ' + quote;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dimension_code: code, quote, reading });
  }
  if (out.length === 0) throw new LlmError('DeepSeek 未返回有效的证据解读');

  // 按报告维度顺序返回，保证渲染顺序稳定
  const order = report.dimension_results.map((d) => d.dimension_code);
  return out.sort((a, b) => order.indexOf(a.dimension_code) - order.indexOf(b.dimension_code));
}
