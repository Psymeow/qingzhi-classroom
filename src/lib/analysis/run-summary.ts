import type { AnalysisReport } from '@/lib/evaluation/types';

// ============================================================
// 运行历史 · 压缩快照（V1.22）
// 一次运行只留「能不能对比」所需的最小数据：分数 + 覆盖 + 来源。
// 不包含证据引文、AI 解读长文——那些体积大且无法跨运行比较。
// 该文件为纯函数/纯类型，前后端都可引用（前端只读展示）。
// ============================================================

export interface RunSummary {
  total_score: number;
  total_level: string;
  /** 五维得分（0-10） */
  dims: { code: string; score: number | null }[];
  /** 表一内涵（百分制） */
  cognitive: number | null;
  affective: number | null;
  /** 观察点覆盖 */
  scored_points: number;
  total_points: number;
  /** 指标编码 → 分数（只收有分的） */
  indicator_scores: Record<string, number>;
  /** 三路材料的齐备情况 */
  sources: { av: boolean; observer: boolean; task_sheet: boolean };
}

/** 运行历史列表项（接口返回、界面渲染） */
export interface RunRecordItem {
  id: string;
  run_no: number;
  total_score: number;
  total_level: string | null;
  model: string | null;
  prompt_version: string | null;
  use_llm: boolean;
  ai_used: boolean;
  ai_error: string | null;
  duration_ms: number | null;
  trigger: string;
  created_at: string;
  summary: RunSummary;
}

export function buildRunSummary(report: AnalysisReport): RunSummary {
  const dims = (report.dimension_results ?? []).map((d) => ({
    code: d.dimension_code,
    score: d.score ?? null,
  }));

  const indicatorScores: Record<string, number> = {};
  for (const d of report.dimension_results ?? []) {
    for (const ind of d.indicators ?? []) {
      if (ind.score != null) indicatorScores[ind.indicator_code] = ind.score;
    }
  }

  const essence = report.essence_eval;

  return {
    total_score: Number(report.total_score ?? 0),
    total_level: report.total_level ?? '',
    dims,
    cognitive: essence?.cognitive?.score_100 ?? null,
    affective: essence?.affective?.score_100 ?? null,
    scored_points: essence?.scored_points ?? 0,
    total_points: essence?.total_points ?? 0,
    indicator_scores: indicatorScores,
    sources: {
      av: report.source_availability?.av_transcript === true,
      observer: report.source_availability?.observer_note === true,
      task_sheet: report.source_availability?.task_sheet === true,
    },
  };
}

/** 两次运行之间的差异（以较早一次为基准） */
export interface RunDelta {
  total: number;
  dims: { code: string; delta: number | null }[];
  cognitive: number | null;
  affective: number | null;
  /** 变化最大的指标（按绝对值排序，最多 8 条） */
  indicators: { code: string; from: number; to: number; delta: number }[];
}

export function diffRuns(prev: RunSummary, next: RunSummary): RunDelta {
  const prevDims = new Map(prev.dims.map((d) => [d.code, d.score]));
  const dims = next.dims.map((d) => {
    const before = prevDims.get(d.code) ?? null;
    return { code: d.code, delta: before != null && d.score != null ? round1(d.score - before) : null };
  });

  const codes = new Set([
    ...Object.keys(prev.indicator_scores),
    ...Object.keys(next.indicator_scores),
  ]);
  const indicators: RunDelta['indicators'] = [];
  for (const code of codes) {
    const from = prev.indicator_scores[code];
    const to = next.indicator_scores[code];
    if (from == null || to == null) continue;
    const delta = round1(to - from);
    if (delta === 0) continue;
    indicators.push({ code, from, to, delta });
  }
  indicators.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    total: round1((next.total_score ?? 0) - (prev.total_score ?? 0)),
    dims,
    cognitive:
      prev.cognitive != null && next.cognitive != null ? round1(next.cognitive - prev.cognitive) : null,
    affective:
      prev.affective != null && next.affective != null ? round1(next.affective - prev.affective) : null,
    indicators: indicators.slice(0, 8),
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
