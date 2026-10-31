import { essenceIndicatorsOf, fallbackStandard, indicatorsOf, lessonTypeModelOf } from "./standard-registry";
import {
  matchSignals,
  parseTranscript,
  scoreFromHits,
  type MatchHit,
} from "./signal-rules";
import type {
  AnalysisReport,
  DataSource,
  DimensionResult,
  EssenceDomainResult,
  EssenceEvaluation,
  EssenceIndicatorResult,
  EssencePointResult,
  Indicator,
  IndicatorResult,
  LessonTypeEvaluation,
  LessonTypePointResult,
  LessonTypeViewpointResult,
  LlmScoreMap,
  ManualCalibration,
  RubricStandard,
  SourceScore,
} from "./types";
import { DEFAULT_SOURCE_WEIGHTS } from "./types";
import type {
  InteractionEdge,
  LessonAnnotation,
  TimelineEvent,
} from "./annotation-types";

// ============================================================
// 多源融合分析引擎（纯函数）
// 输入：转写文稿、人工标注、（V1.2）任务单/观察记录结构化结果
// 输出：AnalysisReport。AI 与人工分开计算、再按权重融合，冲突标记待复核，人工可校准。
// ============================================================

export interface EngineInput {
  lesson_id: string;
  /**
   * V1.4：本课例使用的评价标准（调用方按 lesson.standard_set_id 解析后注入）。
   * 缺省时回落内置种子，保证向后兼容。
   */
  standard?: RubricStandard;
  /** 导入的音视频转写文稿原文 */
  transcript?: string;
  /** 人工标注聚合 */
  annotation?: Partial<LessonAnnotation> | null;
  /** 学生任务单（V1.4 接入）：LLM 对任务单材料的指标级语义评分（带原文证据） */
  taskSheetScores?: LlmScoreMap;
  /** 学生任务单解析出的原文（可选，供复核与规则兜底） */
  taskSheetText?: string;
  /** 教学设计/教案（V1.9 接入）：LLM 对教案材料的指标级语义评分（带原文证据） */
  lessonPlanScores?: LlmScoreMap;
  /** 教案解析出的原文（可选，供复核） */
  lessonPlanText?: string;
  observerScores?: Record<string, number | null>;
  observerText?: string;
  /**
   * V1.2：LLM（DeepSeek）对文本材料的指标级语义评分。
   * av 对应转写文稿，observer 对应观察员记录；模型分为主、规则分兜底。
   */
  llmScores?: { av?: LlmScoreMap; observer?: LlmScoreMap };
  /** 可覆盖的来源权重（权重调节） */
  source_weights?: Partial<Record<DataSource, number>>;
  /**
   * V1.3：课型（评价模型的路由键）。
   * 取值 new/review/comment/practice/topic，也兼容旧枚举（exercise/inquiry 等）。
   */
  lesson_type?: string | null;
  /** V1.3：LLM 对「本课型分析要点」的要点级语义评分（point_code -> 评分） */
  lesson_type_scores?: LlmScoreMap;
  /** 是否请求了课型要点 AI 评分 */
  lesson_type_llm_enabled?: boolean;
  /** 课型要点评分实际使用的模型 */
  lesson_type_model?: string;
  /** 课型来源：模型自动识别 / 人工指定 */
  lesson_type_source?: "auto" | "manual";
  /** 自动识别置信度 */
  lesson_type_confidence?: number | null;
  /** 自动识别依据摘要 */
  lesson_type_basis?: string | null;
  /** 表一内涵框架：LLM 对 57 个细化观察点的评分（point_code -> 评分，av/observer 已合并） */
  essence_scores?: LlmScoreMap;
  /**
   * V1.9d：本次实际提交的观察点证据来源（av/observer/task_sheet 子集）。
   * 未传时按三源齐备处理（兼容旧调用）；缺失来源专属的观察点留空不评分。
   */
  essence_available_sources?: string[];
  /** 是否请求了内涵观察点 AI 评分 */
  essence_llm_enabled?: boolean;
  /** 内涵观察点评分实际使用的模型 */
  essence_model?: string;
}

const clamp10 = (n: number) => Math.max(0, Math.min(10, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 冲突阈值：两有效来源分差超过该值 → 待人工复核 */
const CONFLICT_GAP = 2.5;

/**
 * 对账阈值（V1.8）：维度分（= 其下二级指标聚合）与多来源融合参考值差异超过该值 → 待人工复核。
 * 与 CONFLICT_GAP 的分工：那个判「来源之间互相打架」，这个判「维度分和它的来源参考值对不上」。
 * 取 1.5 是为了在"人机本就有常态差异"与"真该复核"之间留出余量，避免整份报告都在报警。
 */
const RECONCILE_GAP = 1.5;

// ---------- 人工标注 → 维度/指标分 ----------
// 注：打点 / 角色标注 / 互动箭头只产出证据（manualEvidenceHints），不再推导维度分。

/** 由人工标注推导各维度 0-10 分与证据（无标注返回 null） */
function manualDimensionScores(ann: Partial<LessonAnnotation> | null | undefined):
  | Record<string, { score: number; evidences: string[] }> {
  const out: Record<string, { score: number; evidences: string[] }> = {};
  if (!ann) return out;

  // V1.8：只有观察员**直接录入**的五维人工分才作为人工维度分来源。
  // 此前打点次数 / 角色占比 / 互动条数会各自推导出一个维度分
  // （如 D2 = 5 + min(4, 思维高光数 × 1.2)，打 2 次即得 7.4 分）并以高置信参与融合，
  // 于是出现「二级指标普遍低于 6 分、维度分却显示 7 分」的不可验算矛盾。
  // 这些结构化标注现降级为证据，由下方 manualEvidenceHints() 收集，只作追溯依据、不参与算分。
  for (const d of ann.dimension_scores ?? []) {
    if (typeof d.score === "number") {
      out[d.dimension_code] = {
        score: d.score,
        evidences: d.comment ? [`人工评分评语：${d.comment}`] : ["观察员分项评分"],
      };
    }
  }
  return out;
}

/**
 * 人工打点 / 角色标注 / 互动箭头类证据（V1.8 起仅作可追溯依据，不参与维度算分）。
 * 保留它们是为了让老师在报告里看到「这些标注与哪些维度相关」，
 * 而不是让标注条数直接换算成分数。
 */
function manualEvidenceHints(
  ann: Partial<LessonAnnotation> | null | undefined,
  dimCode: string,
): string[] {
  if (!ann) return [];
  const events = (ann.events ?? []).filter((e) => (e.dimension_codes?.[0] ?? "") === dimCode);
  const hints: string[] = [];
  const hl = events.filter((e) => e.category === "thinking_highlight").length;
  const integ = events.filter((e) => e.category === "qz_integration").length;
  if (dimCode === "D2" && hl > 0) hints.push(`人工打点：思维高光 ${hl} 次`);
  if (dimCode === "D1" && integ > 0) hints.push(`人工打点：情智融合节点 ${integ} 次`);
  for (const e of events.slice(0, 2)) {
    if (e.note) hints.push(`人工打点：${e.note}`);
  }
  if (dimCode === "D3" && (ann.seating?.students ?? []).some((s) => s.role)) {
    hints.push("已标注学生角色（▲■●）");
  }
  if (dimCode === "D4" && (ann.interactions?.length ?? 0) > 0) {
    hints.push(`互动箭头 ${ann.interactions?.length} 条`);
  }
  return hints.slice(0, 4);
}

/**
 * 指标分取值：LLM 语义分优先，规则命中分兜底。
 * - 模型给出有效分 -> 采用模型分（置信度 0.75，证据用模型引用原文）
 * - 模型明确判定无表现（score=null）-> 保持 null
 * - 模型未覆盖该指标 -> 回退关键词规则匹配（保留召回，规则作为兜底与冷启动）
 */
function indicatorScore(
  code: string,
  hits: MatchHit[],
  llm?: LlmScoreMap,
): { score: number | null; evidences: string[]; confidence: number; no_evidence?: boolean } {
  const ai = llm?.[code];
  if (ai) {
    if (ai.score === null || !Number.isFinite(ai.score)) {
      return { score: null, evidences: [], confidence: 0, no_evidence: false };
    }
    const evidences = ai.evidences.length ? ai.evidences : ai.reason ? [ai.reason] : [];
    // 0 分必须有证据支撑才算数：模型常把「无证据」误写成 score: 0（prompt 已禁止但不保证），
    // 若照单全收会把本该留空的项算成 0 进入均分，把维度分与综合分一起拉低。
    // 判定依据是最终产出的 evidences（含 reason 兜底），不是裸的 ai.evidences——
    // 有 reason 就说明模型给了理由，属于「表现确实未达成」而非「没找到相关表现」。
    if (clamp10(ai.score) === 0 && evidences.length === 0) {
      return { score: null, evidences: [], confidence: 0, no_evidence: true };
    }
    return { score: clamp10(ai.score), evidences, confidence: 0.75 };
  }
  return scoreFromHits(code, hits);
}

// ---------- 维度级来源分组装 ----------

function buildDimensionSourceScores(input: EngineInput, hits: MatchHit[], observerHits: MatchHit[]) {
  const manual = manualDimensionScores(input.annotation);

  const std = input.standard ?? fallbackStandard();

  return (dimCode: string): SourceScore[] => {
    const result: SourceScore[] = [];
    const indicators = std.indicators.filter(
      (i) => i.dimension_code === dimCode && i.enabled !== false,
    );

    // 来源1：音视频转写语义分（对该维度下指标求均值）
    {
      const vals = indicators
        .map((ind) => indicatorScore(ind.code, hits, input.llmScores?.av))
        .filter((x) => x.score !== null);
      if (vals.length > 0) {
        const avg = vals.reduce((a, b) => a + (b.score ?? 0), 0) / vals.length;
        const ev = vals.flatMap((v) => v.evidences).slice(0, 4);
        result.push({ source: "av_transcript", score: round1(avg), evidences: ev, confidence: Math.min(0.6, vals.reduce((a, b) => a + b.confidence, 0) / vals.length) });
      } else {
        result.push({ source: "av_transcript", score: null, evidences: [], confidence: 0 });
      }
    }

    // 来源2：学生任务单（V1.4：LLM 语义评分，带原文证据）
    {
      const map = input.taskSheetScores ?? {};
      const hits2 = indicators
        .map((i) => map[i.code])
        .filter((h): h is NonNullable<typeof h> => !!h && typeof h.score === "number");
      if (hits2.length > 0) {
        const avg = hits2.reduce((a, b) => a + (b.score as number), 0) / hits2.length;
        const ev = hits2.flatMap((h) => h.evidences ?? []).slice(0, 3);
        result.push({ source: "task_sheet", score: round1(avg), evidences: ev, confidence: 0.6 });
      } else {
        result.push({ source: "task_sheet", score: null, evidences: [], confidence: 0 });
      }
    }

    // 来源3：观察员记录（结构化分优先，否则用观察文本命中）
    {
      const map = input.observerScores ?? {};
      const vals = indicators.map((i) => map[i.code]).filter((v): v is number => typeof v === "number");
      if (vals.length > 0) {
        result.push({ source: "observer_note", score: round1(vals.reduce((a, b) => a + b, 0) / vals.length), evidences: ["观察员记录结构化（V1.2 接入）"], confidence: 0 });
      } else if (input.observerText || input.llmScores?.observer) {
        const v2 = indicators
          .map((ind) => indicatorScore(ind.code, observerHits, input.llmScores?.observer))
          .filter((x) => x.score !== null);
        if (v2.length > 0) {
          result.push({ source: "observer_note", score: round1(v2.reduce((a, b) => a + (b.score ?? 0), 0) / v2.length), evidences: v2.flatMap((v) => v.evidences).slice(0, 3), confidence: 0.4 });
        } else {
          result.push({ source: "observer_note", score: null, evidences: [], confidence: 0 });
        }
      } else {
        result.push({ source: "observer_note", score: null, evidences: [], confidence: 0 });
      }
    }

    // 来源：教学设计/教案（V1.9：课前设计证据，LLM 语义评分，仅对有设计依据的指标打分）
    {
      const map = input.lessonPlanScores ?? {};
      const hitsPlan = indicators
        .map((i) => map[i.code])
        .filter((h): h is NonNullable<typeof h> => !!h && typeof h.score === "number");
      if (hitsPlan.length > 0) {
        const avg = hitsPlan.reduce((a, b) => a + (b.score as number), 0) / hitsPlan.length;
        const ev = hitsPlan.flatMap((h) => h.evidences ?? []).slice(0, 3);
        result.push({ source: "lesson_plan", score: round1(avg), evidences: ev, confidence: 0.6 });
      } else {
        result.push({ source: "lesson_plan", score: null, evidences: [], confidence: 0 });
      }
    }

    // 来源4：人工标注（维度级）
    {
      const m = manual[dimCode];
      if (m) {
        result.push({ source: "manual_annotation", score: m.score, evidences: m.evidences, confidence: 0.9 });
      } else {
        result.push({ source: "manual_annotation", score: null, evidences: [], confidence: 0 });
      }
    }

    return result;
  };
}

/** 对某维度的多来源分做加权融合（仅对有效来源，按默认/调节权重归一化） */
function fuseSources(scores: SourceScore[], weights: Record<DataSource, number>) {
  const valid = scores.filter((s) => s.score !== null);
  if (valid.length === 0) {
    return { score: null as number | null, needReview: false, evidences: [] as string[], scores: [] as SourceScore[] };
  }

  let wsum = 0;
  let acc = 0;
  for (const s of valid) {
    const w = weights[s.source] ?? 0;
    acc += (s.score as number) * w;
    wsum += w;
  }
  const fused = wsum > 0 ? acc / wsum : valid.reduce((a, b) => a + (b.score as number), 0) / valid.length;

  // 冲突检测：有效来源两两最大分差
  let needReview = false;
  const sv = valid.map((s) => s.score as number);
  if (sv.length >= 2 && Math.max(...sv) - Math.min(...sv) >= CONFLICT_GAP) needReview = true;

  const sorted = valid
    .slice()
    .sort((a, b) => (weights[b.source] ?? 0) - (weights[a.source] ?? 0));
  const evidences = sorted
    .flatMap((s) => s.evidences.slice(0, 2))
    .slice(0, 8);

  return { score: round1(clamp10(fused)), needReview, evidences, scores: sorted };
}

function bandLabel(std: RubricStandard, dimCode: string, score: number | null) {
  if (score === null) return null;
  const dim = std.dimensions.find((d) => d.code === dimCode);
  if (!dim) return null;
  return (dim.bands.find((b) => (score as number) >= b.min && (score as number) <= b.max) ?? dim.bands[0]).label;
}

/** 0-10 分的通用五档标签。全局唯一的五档阈值源（8.1/6.1/4.1/2.1），刻度尺、着色、Word 配色均以此为准 */
/**
 * 通用五档词（V1.33 发展性口径）。
 * 「待提升」→「可精进」、「需重点改进」→「起步阶段」：不抬高任何分数与阈值，
 * 只把面向教师的措辞从判定式改为描述式，避免读完产生挫败感。
 *
 * 注意：旧报告里落库的 level_label 仍是旧词，展示层的配色判断必须新旧双向兼容。
 */
export function bandLabel10(score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  if (score >= 8.1) return "优秀";
  if (score >= 6.1) return "良好";
  if (score >= 4.1) return "中等";
  if (score >= 2.1) return "可精进";
  return "起步阶段";
}

/**
 * 组装课型专属评价：按课型加载要点集，把 LLM 的要点级分数装配成
 * 视角 → 要点的两级结构（无课型或课型不可识别时返回 null）。
 * 说明：课型要点分只来自 AI 语义评分，规则引擎不臆造该区分数。
 */
function buildLessonTypeEvaluation(input: EngineInput): LessonTypeEvaluation | null {
  const model = lessonTypeModelOf(input.standard ?? fallbackStandard(), input.lesson_type);
  if (!model) return null;

  const scores = input.lesson_type_scores ?? {};
  const scored = Object.keys(scores).length > 0;

  const viewpoints: LessonTypeViewpointResult[] = model.viewpoints.map((vp) => {
    const points: LessonTypePointResult[] = vp.points.map((pt) => {
      const hit = scores[pt.code];
      const score =
        hit && hit.score !== null && Number.isFinite(hit.score) ? clamp10(hit.score) : null;
      return {
        code: pt.code,
        no: pt.no,
        name: pt.name,
        definition: pt.definition,
        score,
        level_label: bandLabel10(score),
        reason: hit?.reason || undefined,
        evidences: hit?.evidences?.length ? hit.evidences : undefined,
      };
    });
    const vals = points.map((p) => p.score).filter((v): v is number => v !== null);
    return {
      code: vp.code,
      name: vp.name,
      points,
      score: vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
    };
  });

  const all = viewpoints.flatMap((v) => v.points.map((p) => p.score)).filter((v): v is number => v !== null);
  const totalOn10 = all.length ? round1(all.reduce((a, b) => a + b, 0) / all.length) : null;

  return {
    lesson_type: model.code,
    lesson_type_name: model.name,
    manual_section: model.manual_section,
    summary: model.summary,
    llm_enabled: input.lesson_type_llm_enabled ?? scored,
    llm_used: all.length > 0,
    viewpoints,
    total_score: totalOn10,
    total_score_100: totalOn10 === null ? null : round1(totalOn10 * 10),
    scored_points: all.length,
    total_points: model.viewpoints.reduce((n, v) => n + v.points.length, 0),
    source: input.lesson_type_source ?? "manual",
    confidence: input.lesson_type_confidence ?? null,
    detection_basis: input.lesson_type_basis ?? null,
    model: input.lesson_type_model,
  };
}

// ---------- 表一内涵框架：认知/情感细化观察点评价 ----------

function buildEssenceDomain(
  std: RubricStandard,
  domain: "cognitive" | "affective",
  name: string,
  scores: LlmScoreMap,
  available: Set<string>,
  /** V1.10 两链对账：五维链上同一二级指标的直评分（indicator_code -> 0-10） */
  chainScores: Map<string, number | null>,
): EssenceDomainResult {
  const inds = essenceIndicatorsOf(std, domain);
  const indicators: EssenceIndicatorResult[] = inds.map((meta) => {
    const code = meta.code;
    const points: EssencePointResult[] = (meta.observation_points ?? []).map((p) => {
      const srcs = p.sources ?? [];
      // V1.9d：该点所需材料本次一种都没交 → 不可评，强制留空并标记，
      // 防止模型把「材料缺失」误打成 0 分拉低均值。
      const materialMissing = srcs.length > 0 && !srcs.some((s) => available.has(s));
      const hit = scores[p.code];
      let score =
        hit && hit.score !== null && Number.isFinite(hit.score) ? clamp10(hit.score) : null;
      if (materialMissing) score = null;
      return {
        code: p.code,
        name: p.name,
        definition: p.description ?? "",
        sources: srcs,
        score,
        missing_material: materialMissing || undefined,
        reason: materialMissing ? undefined : hit?.reason || undefined,
        evidences:
          materialMissing || !hit?.evidences?.length
            ? undefined
            : hit.evidences,
      };
    });
    const vals = points.map((p) => p.score).filter((v): v is number => v !== null);
    const pointAgg = vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    const chainScore = chainScores.get(code) ?? null;
    return {
      code,
      name: meta.name,
      category: meta.category ?? "",
      domain,
      points,
      score: pointAgg,
      chain_score: chainScore,
      chain_gap:
        pointAgg === null || chainScore === null
          ? null
          : round1(Math.abs(pointAgg - chainScore)),
    };
  });

  const indVals = indicators.map((i) => i.score).filter((v): v is number => v !== null);
  const allPoints = indicators.flatMap((i) => i.points);
  const scoredPoints = allPoints.filter((p) => p.score !== null).length;
  const domainScore = indVals.length ? round1(indVals.reduce((a, b) => a + b, 0) / indVals.length) : null;
  // V1.10 两链对账：只比较两侧都有分的指标，给出平均绝对差（越小说明两套尺子松紧越接近）
  const gaps = indicators.map((i) => i.chain_gap).filter((v): v is number => v !== null && v !== undefined);

  return {
    domain,
    name,
    indicators,
    score: domainScore,
    score_100: domainScore === null ? null : round1(domainScore * 10),
    scored_indicators: indVals.length,
    total_indicators: inds.length,
    scored_points: scoredPoints,
    total_points: allPoints.length,
    chain_gap_avg: gaps.length ? round1(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
    chain_compared: gaps.length,
  };
}

function buildEssenceEvaluation(
  input: EngineInput,
  /** V1.10 两链对账：五维链的指标结果，用于与观察点聚合分比对松紧 */
  dimensionResults: DimensionResult[] = [],
): EssenceEvaluation | null {
  // 未启用内涵观察点评分时不产出该区块（避免 UI 出现全空结构）
  if (!input.essence_llm_enabled) return null;
  const std = input.standard ?? fallbackStandard();
  const spec = std.essence_domains;
  if (!spec) return null;
  const scores = input.essence_scores ?? {};
  // V1.9d：本次实际提交了哪些证据来源（观察点的 sources 取值：av/observer/task_sheet）
  const available = new Set<string>([
    ...(input.essence_available_sources ?? ["av", "observer", "task_sheet"]),
  ]);
  // V1.10：收集五维链上同编码指标的分数，用于两链对账
  const chainScores = new Map<string, number | null>();
  for (const dr of dimensionResults) {
    for (const ind of dr.indicators) {
      if (ind.indicator_code && !chainScores.has(ind.indicator_code)) {
        chainScores.set(ind.indicator_code, ind.score);
      }
    }
  }
  const cognitive = buildEssenceDomain(std, "cognitive", spec.cognitive.name, scores, available, chainScores);
  const affective = buildEssenceDomain(std, "affective", spec.affective.name, scores, available, chainScores);
  return {
    llm_enabled: true,
    llm_used: cognitive.scored_points + affective.scored_points > 0,
    model: input.essence_model,
    cognitive,
    affective,
    scored_points: cognitive.scored_points + affective.scored_points,
    total_points: cognitive.total_points + affective.total_points,
  };
}

// ---------- 主入口 ----------

export function analyzeLesson(input: EngineInput): AnalysisReport {
  const std = input.standard ?? fallbackStandard();
  const weights: Record<DataSource, number> = { ...DEFAULT_SOURCE_WEIGHTS, ...(input.source_weights ?? {}) };

  // 转写 & 观察文本语义匹配
  const utterances = input.transcript ? parseTranscript(input.transcript) : [];
  const hits = utterances.length ? matchSignals(utterances, "av_transcript") : [];
  const observerUtter = input.observerText ? parseTranscript(input.observerText) : [];
  const observerHits = observerUtter.length ? matchSignals(observerUtter, "observer_note") : [];

  const getSources = buildDimensionSourceScores(input, hits, observerHits);

  // 来源齐备性（可观测，防止静默缺源）
  const hasManual = !!input.annotation && (
    (input.annotation.dimension_scores?.some((d) => typeof d.score === "number") ?? false) ||
    (input.annotation.events?.length ?? 0) > 0 ||
    (input.annotation.interactions?.length ?? 0) > 0 ||
    ((input.annotation.seating?.students ?? []).some((s) => s.role) ?? false)
  );
  const source_availability: Record<DataSource, boolean> = {
    av_transcript: utterances.length > 0,
    task_sheet: Object.keys(input.taskSheetScores ?? {}).length > 0,
    observer_note: !!input.observerText || Object.keys(input.observerScores ?? {}).length > 0,
    lesson_plan: !!input.lessonPlanText || Object.keys(input.lessonPlanScores ?? {}).length > 0,
    manual_annotation: !!hasManual,
  };

  const dimension_results: DimensionResult[] = std.dimensions.map((dim) => {
    const sources = getSources(dim.code);
    const fused = fuseSources(sources, weights);

    // 指标级结果（供分维度详情）
    const indicators: IndicatorResult[] = indicatorsOf(std, dim.code).map((ind) => {
      const t = indicatorScore(ind.code, hits, input.llmScores?.av);
      const o = indicatorScore(ind.code, observerHits, input.llmScores?.observer);
      // 任务单链同样受 0 分无证据守卫约束，与转写/观察两条链一致
      const tsRaw = input.taskSheetScores?.[ind.code];
      const tsScore =
        typeof tsRaw?.score === 'number' && Number.isFinite(tsRaw.score)
          ? clamp10(tsRaw.score)
          : null;
      const tsEvidence = tsRaw?.evidences ?? [];
      const tsNoEvidence = tsScore === 0 && tsEvidence.length === 0;
      const src: SourceScore[] = [
        { source: "av_transcript", score: t.score, evidences: t.evidences, confidence: t.confidence },
        { source: "observer_note", score: o.score, evidences: o.evidences, confidence: o.confidence },
        { source: "task_sheet", score: tsNoEvidence ? null : tsScore, evidences: tsEvidence, confidence: 0 },
        { source: "manual_annotation", score: null, evidences: [], confidence: 0 },
      ];
      const valid = src.filter((s) => s.score !== null);
      const sv = valid.map((s) => s.score as number);
      const needReview = sv.length >= 2 && Math.max(...sv) - Math.min(...sv) >= CONFLICT_GAP;
      const score = valid.length
        ? round1(valid.reduce((a, b) => a + (b.score as number) * (weights[b.source] || 0), 0) /
            valid.reduce((a, b) => a + (weights[b.source] || 0), 0) || 0)
        : null;
      // 任一链触发 0 分无证据守卫即标记；缺材料则按来源齐备性标记，供状态列区分
      const noEvidence = t.no_evidence === true || o.no_evidence === true || tsNoEvidence;
      // 缺材料判定与观察点级 V1.9d 同口径：该指标所需材料一种都没交才算，
      // 只要有一路在手就仍属「有材料」——避免把「材料在但没找到表现」误标成缺材料。
      // PointSource(av/observer/task_sheet) 与 DataSource(五路) 命名不同，只映射三者共有项
      const ptToSource: Record<string, DataSource> = {
        av: 'av_transcript',
        observer: 'observer_note',
        task_sheet: 'task_sheet',
      };
      const ptSources = ind.observation_points.flatMap((pt) => pt.sources ?? []);
      const missingMaterial =
        ptSources.length > 0 &&
        !ptSources.some((sc) => source_availability[ptToSource[sc]]);
      return {
        indicator_code: ind.code,
        name: ind.name,
        score,
        need_review: needReview,
        source_scores: src,
        ...(noEvidence ? { no_evidence: true } : {}),
        ...(missingMaterial ? { missing_material: true } : {}),
      };
    });

    // ---- 分数对账（V1.8）：维度分优先由其下二级指标聚合，保证老师可自行验算 ----
    // 指标级 score 本身已是多源加权融合值，因此其聚合结果与页面展示的指标分完全同口径：
    // 老师把该维度下各二级指标分平均，就能复现维度分，不再出现
    //「二级指标普遍低于 6 分、维度分却显示 7 分」的无从核对问题。
    const scoredInds = indicators.filter((i) => i.score !== null);
    const indicatorAvg = scoredInds.length
      ? round1(scoredInds.reduce((a, b) => a + (b.score as number), 0) / scoredInds.length)
      : null;
    const sourceFused = fused.score;
    // 无二级指标的维度（如 D1/D4/D5）退回落来源融合，并在 UI 标注口径
    const score = indicatorAvg !== null ? indicatorAvg : sourceFused;
    const reconcileGap =
      indicatorAvg !== null && sourceFused !== null
        ? round1(Math.abs(indicatorAvg - sourceFused))
        : null;
    // 复核触发二选一：来源之间打架（原逻辑）｜指标聚合与来源融合对不上（V1.8 新增）
    const gapBroken = reconcileGap !== null && reconcileGap >= RECONCILE_GAP;
    const needReview = fused.needReview || gapBroken;
    const reviewReason = needReview
      ? fused.needReview && gapBroken
        ? ("both" as const)
        : fused.needReview
          ? ("source_conflict" as const)
          : ("reconcile_gap" as const)
      : undefined;

    return {
      dimension_code: dim.code,
      score,
      level_label: bandLabel(std, dim.code, score),
      need_review: needReview,
      indicators,
      evidences: [...fused.evidences, ...manualEvidenceHints(input.annotation, dim.code)].slice(0, 10),
      source_scores: fused.scores,
      reconcile_method: indicatorAvg !== null ? "indicator_aggregate" : "source_fusion",
      indicator_avg: indicatorAvg,
      source_fused: sourceFused,
      reconcile_gap: reconcileGap,
      review_reason: reviewReason,
    };
  });

  // 综合得分：仅对有分维度按其权重归一化
  let total = 0;
  let wsum = 0;
  for (const dr of dimension_results) {
    const dim = std.dimensions.find((d) => d.code === dr.dimension_code)!;
    if (dr.score !== null) {
      total += dr.score * dim.weight;
      wsum += dim.weight;
    }
  }
  const totalOn10 = wsum > 0 ? total / wsum : 0;
  const total100 = round1(totalOn10 * 10);
  const totalLevel = bandLevelOf100(total100);

  // 人工校准（如前端传入，这里从 annotation 透传结构在调用层组装）
  const calibrations: ManualCalibration[] = [];

  return {
    lesson_id: input.lesson_id,
    standard_code: std.code,
    standard_name: std.name,
    standard_version: std.version,
    total_score: total100,
    total_level: totalLevel,
    dimension_results,
    source_weights: weights,
    source_availability,
    calibrations,
    generated_at: new Date().toISOString(),
    lesson_type_eval: buildLessonTypeEvaluation(input),
    essence_eval: buildEssenceEvaluation(input, dimension_results),
  };
}

/** 应用人工校准：覆盖维度分并重算综合分（AI/人工双留痕） */
export function applyCalibration(
  report: AnalysisReport,
  cals: ManualCalibration[],
  standard: RubricStandard = fallbackStandard(),
): AnalysisReport {
  const next: AnalysisReport = {
    ...report,
    calibrations: cals,
    dimension_results: report.dimension_results.map((dr) => {
      const c = cals.find((x) => x.dimension_code === dr.dimension_code && x.final_score !== null);
      if (!c) return dr;
      return {
        ...dr,
        ai_score: dr.score,
        score: c.final_score as number,
        level_label: bandLabel(standard, dr.dimension_code, c.final_score),
      };
    }),
  };
  let total = 0;
  let wsum = 0;
  for (const dr of next.dimension_results) {
    const dim = standard.dimensions.find((d) => d.code === dr.dimension_code)!;
    if (dr.score !== null) {
      total += dr.score * dim.weight;
      wsum += dim.weight;
    }
  }
  next.total_score = round1((wsum > 0 ? total / wsum : 0) * 10);
  next.total_level = bandLevelOf100(next.total_score);
  return next;
}

/**
 * 0-100 分的通用五档标签。
 * 阈值不在此处重复定义——直接委托 bandLabel10(x / 10)，
 * 与 ScaleBar 刻度、指标格着色、Word 配色共用同一套边界（8.1/6.1/4.1/2.1）。
 * 历史遗留：本函数曾是独立实现（85/70/55/35），与 bandLabel10 相差 4–14 分，
 * 导致同一分数在徽标与刻度尺上得到不同结论。V1.35 统一。
 */
export function bandLevelOf100(score100: number): string {
  return bandLabel10(score100 / 10) ?? "起步阶段";
}
