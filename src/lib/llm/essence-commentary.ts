import 'server-only';
import { LlmError, chatJson, isLlmEnabled } from '@/lib/llm/deepseek';
import { fallbackStandard, subjectLabel } from '@/lib/evaluation/standard-registry';
import { POINT_SOURCE_LABEL } from '@/lib/evaluation/essence-points';
import type {
  AnalysisReport,
  DimensionInterpretation,
  EssenceDomainResult,
  EssenceEvaluation,
  EssenceIndicatorResult,
  RubricStandard,
} from '@/lib/evaluation/types';

// ============================================================
// 内涵观察点 AI 解读生成（V1.19）
// 为「表一 · 认知与情感内涵观察点分析」的认知、情感两个一级内涵
// 各生成一段四段式解读（依据/为什么/怎么读/怎么提升——补材料+改教学），
// 与五维维度解读同款交互，复用 DimensionInterpretation 结构
// （dimension_code = 'cognitive' / 'affective'）。
// 按需生成（查看报告时触发），生成后随 reports.result 落库；
// 仅做解读与建议，不修改任何评分数据。
// ============================================================

/** 单字段字数上限：与五维解读一致，防模型跑飞 */
const MAX_FIELD = 1400;

/** 解读目标域：认知（高阶思维）/ 情感（学习情感素养） */
const DOMAIN_META: Record<'cognitive' | 'affective', { title: string; marker: string }> = {
  cognitive: { title: '认知 · 高阶思维', marker: '【认知】' },
  affective: { title: '情感 · 学习情感素养', marker: '【情感】' },
};

function str(v: unknown, limit = MAX_FIELD): string {
  return typeof v === 'string' ? v.trim().slice(0, limit) : '';
}

function indLine(ind: EssenceIndicatorResult): string {
  const parts: string[] = [];
  for (const p of ind.points) {
    if (p.score != null) {
      parts.push(`${p.name} ${p.score} 分`);
    } else if (p.missing_material) {
      parts.push(`${p.name} 待补材料（${p.sources.map((s) => POINT_SOURCE_LABEL[s] ?? s).join('、')}）`);
    } else {
      parts.push(`${p.name} 未找到表现证据`);
    }
  }
  return `${ind.name}（${ind.category}）${ind.score == null ? '未评' : `均分 ${ind.score}`}：${parts.join('；')}`;
}

/**
 * 把表一内涵结果压缩成模型可读摘要：覆盖两个域的指标分数、
 * 代表证据与缺料点；四问只能从这里推理。
 */
function buildDigest(ev: EssenceEvaluation): string {
  const domains: EssenceDomainResult[] = [ev.cognitive, ev.affective];
  const lines: string[] = [];
  for (const d of domains) {
    lines.push(
      `【${DOMAIN_META[d.domain].title}】有分指标 ${d.scored_indicators}/${d.total_indicators}，` +
        `已评观察点 ${d.scored_points}/${d.total_points}，均分 ${d.score == null ? '—' : d.score.toFixed(1)}` +
        `（百分制 ${d.score_100 == null ? '—' : d.score_100}）。`,
    );
    const scored = d.indicators.filter((i) => i.score != null);
    const unscored = d.indicators.filter((i) => i.score == null);
    const shown = [...scored.sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 4), ...scored.slice(0, 2)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 5);
    shown.forEach((ind) => lines.push(`· ${indLine(ind)}`));
    if (unscored.length > 0) {
      lines.push(
        `未出分的二级指标：${unscored.map((i) => `${i.name}（待补材料或无证据）`).join('、')}。`,
      );
    }
    // 代表证据：高低两端观察点各取一些
    const pts = d.indicators
      .flatMap((i) => i.points)
      .filter((p) => p.score != null && (p.reason || (p.evidences && p.evidences.length > 0)));
    const top = pts.filter((p) => (p.score ?? 0) >= 8).slice(0, 2);
    const low = pts.filter((p) => (p.score ?? 0) < 6).slice(0, 3);
    const reps = [...top, ...low];
    if (reps.length > 0) {
      lines.push('代表观察点：');
      reps.forEach((p) => {
        lines.push(`· ${p.name} ${p.score} 分${p.reason ? `：${p.reason}` : ''}`);
        (p.evidences ?? []).slice(0, 1).forEach((e) => lines.push(`  证据：${e.slice(0, 140)}`));
      });
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * 依据表一内涵评价结果生成认知/情感两段四段式解读。
 * 未配置密钥或调用失败时抛 LlmError，由调用方捕获后降级（UI 显示失败与重试）。
 */
export async function generateEssenceInterpretations(
  report: AnalysisReport,
  standard: RubricStandard = fallbackStandard(),
): Promise<DimensionInterpretation[]> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');
  const ev = report.essence_eval;
  if (!ev?.llm_used) throw new LlmError('本课例未产出内涵观察点评分，无法生成解读');

  const raw = await chatJson<{ interpretations?: unknown }>(
    [
      {
        role: 'system',
        content: [
          `你是${subjectLabel(standard.subject)}教研专家，熟悉课堂「认知与情感内涵」观察点评价（认知高阶思维 + 情感学习情感素养）。`,
          '你会收到一份表一内涵观察点的量化摘要，需要为「认知」和「情感」两个一级内涵各写一段面向授课教师的四段式解读。',
          '要求：结论必须严格建立在给定数据之上，不编造材料、不夸大；具体、可执行，不使用 Markdown 标记与编号前缀。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          '【表一内涵观察点量化摘要】',
          buildDigest(ev),
          '',
          '【写作要求——认知与情感各写以下四段】',
          '1. basis（评分依据与素材）：这个均分由哪些二级指标与观察点支撑、用了哪些材料（课堂转写、学生任务单、人工观察记录等）；缺材料导致未出分的点如实点明缺了什么。80~160 字。',
          '2. why（为什么这节课这个内涵评这个分）：把代表观察点的证据和分数串起来讲清推理——这节课认知/情感表现做对了什么、哪些课堂行为把分拉低了。80~160 字。',
          '3. how_to_read（如何解读这个分）：说明这个均分意味着什么、认知与情感之间是什么关系、阅读时的边界（如覆盖率低、待补材料点）。60~140 字。',
          '4. how_to_improve（如何提升这个内涵的评分）：分两层——先写可以补充哪些类型的材料来补上判分依据；再写教学环节的设计与实施怎么优化，落到具体环节、教学行为、对象或时长，不写「加强…」「注重…」这类空话。100~200 字。',
          '5. 全部使用中文；输出两条，dimension_code 必须分别是 cognitive 和 affective；观察点名称与摘要保持一致。',
          '',
          '严格按以下 JSON 结构输出，不要输出任何其他内容：',
          '{"interpretations":[{"dimension_code":"cognitive","basis":"","why":"","how_to_read":"","how_to_improve":""},{"dimension_code":"affective","basis":"","why":"","how_to_read":"","how_to_improve":""}]}',
        ].join('\n'),
      },
    ],
    { temperature: 0.4, maxTokens: 4000, timeoutMs: 50_000 },
  );

  const codes: Array<'cognitive' | 'affective'> = ['cognitive', 'affective'];
  const list = Array.isArray(raw.interpretations) ? raw.interpretations : [];
  const byCode = new Map<string, DimensionInterpretation>();
  for (const item of list) {
    const r = (item ?? {}) as Record<string, unknown>;
    const code = typeof r.dimension_code === 'string' ? r.dimension_code.trim() : '';
    if (!code || !codes.includes(code as 'cognitive' | 'affective') || byCode.has(code)) continue;
    const basis = str(r.basis);
    const why = str(r.why);
    const howToRead = str(r.how_to_read);
    const howToImprove = str(r.how_to_improve);
    if (!basis || !why || !howToRead || !howToImprove) continue;
    byCode.set(code, {
      dimension_code: code,
      basis,
      why,
      how_to_read: howToRead,
      how_to_improve: howToImprove,
    });
  }
  if (byCode.size === 0) throw new LlmError('DeepSeek 未返回有效的内涵解读');

  return codes.filter((c) => byCode.has(c)).map((c) => byCode.get(c)!);
}
