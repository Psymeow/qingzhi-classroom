// ============================================================
// 分析稳定性自检（V1.3）
// 对同一份材料重复调用 LLM 语义评分，比较各指标的分数波动，
// 用于判断 AI 评分的可复现性，给试用期的可信度提供依据。
// ============================================================
import 'server-only';

import { LlmError } from '@/lib/llm/deepseek';
import { scoreLessonTypeWithLlm, scoreMaterialWithLlm } from '@/lib/evaluation/llm-scorer';
import { normalizeLessonType, type GradeBand } from '@/lib/evaluation/lesson-type-models';
import { fallbackStandard, lessonTypeModelOf } from '@/lib/evaluation/standard-registry';
import type { LlmScoreMap, RubricStandard } from '@/lib/evaluation/types';

export type ConsistencyKind = 'transcript' | 'observer';

export interface ConsistencyItem {
  code: string;
  label: string;
  /** 各轮得分，null 表示该轮模型判定无相关表现 */
  scores: (number | null)[];
  mean: number | null;
  min: number | null;
  max: number | null;
  /** 极差 = max - min，越小越稳定 */
  gap: number | null;
  /** 总体标准差 */
  std: number | null;
  /** 极差 ≤ 1.0 视为稳定 */
  stable: boolean;
}

export interface ConsistencyReport {
  lesson_id: string;
  lesson_type: string | null;
  lesson_type_name: string | null;
  kind: ConsistencyKind;
  runs: number;
  model: string;
  indicators: ConsistencyItem[];
  lesson_type_points: ConsistencyItem[];
  summary: {
    compared: number;
    stable: number;
    unstable: number;
    avg_gap: number | null;
    max_gap: number | null;
    /** 稳定 / 基本稳定 / 波动较大 */
    level: string;
  };
  errors: string[];
  generated_at: string;
}

export interface ConsistencyInput {
  lesson_id: string;
  text: string;
  kind?: ConsistencyKind;
  lesson_type?: string | null;
  /** 学段，小学/初中/高中差异化课型评分；默认小学 */
  grade_band?: GradeBand;
  /** 重复次数，1-5，默认 3 */
  runs?: number;
  /** V1.4：本课例使用的评价标准（缺省回落内置种子） */
  standard?: RubricStandard;
}

const STABLE_GAP = 1;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function statItem(code: string, label: string, scores: (number | null)[]): ConsistencyItem {
  const vals = scores.filter((v): v is number => v !== null);
  if (!vals.length) {
    return { code, label, scores, mean: null, min: null, max: null, gap: null, std: null, stable: true };
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const gap = round1(max - min);
  return {
    code,
    label,
    scores,
    mean: round1(mean),
    min: round1(min),
    max: round1(max),
    gap,
    std: round1(Math.sqrt(variance)),
    stable: gap <= STABLE_GAP,
  };
}

function mergeMaps(maps: LlmScoreMap[], code: string): (number | null)[] {
  return maps.map((m) => {
    const hit = m[code];
    if (!hit || hit.score === null || !Number.isFinite(hit.score)) return null;
    return round1(Math.min(10, Math.max(0, hit.score)));
  });
}

function summarize(items: ConsistencyItem[]): ConsistencyReport['summary'] {
  const scored = items.filter((i) => i.gap !== null);
  const gaps = scored.map((i) => i.gap as number);
  const stable = scored.filter((i) => i.stable).length;
  const avgGap = gaps.length ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null;
  const maxGap = gaps.length ? Math.max(...gaps) : null;
  let level = '数据不足';
  if (avgGap !== null) {
    if (avgGap <= 0.5) level = '稳定';
    else if (avgGap <= 1) level = '基本稳定';
    else level = '波动较大';
  }
  return {
    compared: scored.length,
    stable,
    unstable: scored.length - stable,
    avg_gap: avgGap,
    max_gap: maxGap,
    level,
  };
}

/**
 * 稳定性自检：并行重复 N 轮 LLM 评分，输出每个指标的波动统计。
 * 未配密钥或材料为空时抛 LlmError。
 */
export async function runConsistency(input: ConsistencyInput): Promise<ConsistencyReport> {
  const text = input.text.trim();
  if (!text) throw new LlmError('暂无可供自检的文本材料');

  const runs = Math.min(5, Math.max(1, Math.floor(input.runs ?? 3)));
  const kind: ConsistencyKind = input.kind ?? 'transcript';
  const lessonType = normalizeLessonType(input.lesson_type);
  const band: GradeBand = input.grade_band ?? 'primary';
  const std = input.standard ?? fallbackStandard();
  const model = lessonTypeModelOf(std, lessonType);

  const errors: string[] = [];
  let modelName = '';

  const genericJobs = Array.from({ length: runs }, (_, i) =>
    scoreMaterialWithLlm(text, kind, std)
      .then((r) => ({ ok: true as const, i, scores: r.scores, model: r.model }))
      .catch((e) => ({ ok: false as const, i, error: e })),
  );

  const typeJobs = lessonType
    ? Array.from({ length: runs }, (_, i) =>
        scoreLessonTypeWithLlm(text, kind, lessonType, band, std)
          .then((r) => ({ ok: true as const, i, scores: r.scores, model: r.model }))
          .catch((e) => ({ ok: false as const, i, error: e })),
      )
    : [];

  const [genericRes, typeRes] = await Promise.all([
    Promise.all(genericJobs),
    Promise.all(typeJobs),
  ]);

  const genericMaps: LlmScoreMap[] = [];
  for (const r of genericRes) {
    if (r.ok) {
      genericMaps.push(r.scores);
      modelName = r.model;
    } else {
      errors.push(`第 ${r.i + 1} 轮通用指标评分失败：${errMsg(r.error)}`);
    }
  }

  const typeMaps: LlmScoreMap[] = [];
  for (const r of typeRes) {
    if (r.ok) {
      typeMaps.push(r.scores);
      modelName = r.model;
    } else {
      errors.push(`第 ${r.i + 1} 轮课型要点评分失败：${errMsg(r.error)}`);
    }
  }

  if (!genericMaps.length && !typeMaps.length) {
    throw new LlmError(errors[0] ?? 'AI 评分未能产出结果');
  }

  const indicators = std.indicators.map((ind) =>
    statItem(ind.code, ind.name, mergeMaps(genericMaps, ind.code)),
  ).filter((i) => i.scores.some((s) => s !== null));

  const points = model ? model.viewpoints.flatMap((v) => v.points) : [];
  const lessonTypePoints = points
    .map((p) => statItem(p.code, `${p.code} ${p.name}`, mergeMaps(typeMaps, p.code)))
    .filter((i) => i.scores.some((s) => s !== null));

  return {
    lesson_id: input.lesson_id,
    lesson_type: model?.code ?? null,
    lesson_type_name: model?.name ?? null,
    kind,
    runs,
    model: modelName,
    indicators,
    lesson_type_points: lessonTypePoints,
    summary: summarize([...indicators, ...lessonTypePoints]),
    errors,
    generated_at: new Date().toISOString(),
  };
}
