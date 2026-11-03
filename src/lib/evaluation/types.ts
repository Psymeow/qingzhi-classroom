// ============================================================
// 情智相长评价体系 · 类型定义
// 设计原则：标准与算法解耦。所有维度/指标/评分档均为数据，可在后台迭代、整库替换。
// ============================================================

import type { LessonTypeModel } from './lesson-type-models';

/** 思维/角色类别（高阶思维三分类、学生角色等使用） */
export type CategoryCode = string;

/** 评分档位（5 档制，0-10 分） */
export interface ScoreBand {
  /** 档位序号 1-5，由低到高 */
  level: 1 | 2 | 3 | 4 | 5;
  /** 分数下界（含） */
  min: number;
  /** 分数上界（含） */
  max: number;
  /** 档位名称，如“优秀”“良好” */
  label: string;
  /** 该档位评分锚点描述（用于 AI 匹配与人工对照） */
  description: string;
}

/** 观察点证据来源：课堂音视频转写、人工观察表、学生任务单 */
export type PointSource = 'av' | 'observer' | 'task_sheet';

/** 观测要点（叶子节点，最细评价点） */
export interface ObservationPoint {
  code: string;
  name: string;
  /** 所属二级指标 code */
  indicator_code: string;
  description?: string;
  /** 可扩展：课型专属观测点标记，通用为 null */
  lesson_type?: string | null;
  /** 该观察点主要依据的证据来源（可多个）；用于提示语与 UI 分组 */
  sources?: PointSource[];
}

/** 二级指标（如高阶思维下的“抽象概括”，情感素养下的“数学兴趣”） */
export interface Indicator {
  code: string;
  name: string;
  /** 所属一级维度 code */
  dimension_code: string;
  /** 思维/情感大类：策略型/批判型/创新型、心理调适/交流协作/信念内省/价值责任 等，无则 null */
  category?: string | null;
  description: string;
  /** 维度内二级指标权重，默认等权；合计归一化为 1 */
  weight?: number;
  observation_points: ObservationPoint[];
  /** 是否启用，支持维度勾选自定义；默认启用 */
  enabled?: boolean;
}

/** 一级维度（五大维度） */
export interface Dimension {
  code: string;
  /** 序号（一~五） */
  order: number;
  name: string;
  /** 总评权重 0-1，五维合计 1 */
  weight: number;
  observation_focus: string;
  /** 该维度整体评分说明（维度内涵） */
  description: string;
  /** 5 档评分锚点 */
  bands: ScoreBand[];
  enabled?: boolean;
}

/** 课型模板 */
export interface LessonTypeTemplate {
  code: string;
  name: string;
  description?: string;
  /** 课型专属附加指标 code 列表（叠加在通用维度之上） */
  extra_indicator_codes?: string[];
  /** 维度权重覆盖（不传则用通用权重） */
  dimension_weight_overrides?: Record<string, number>;
}

/**
 * 内涵分析域：指向一个一级维度，其下二级指标的 observation_points
 * 即为「细化观察点」。换课题时只改这里指向的维度，不必改算法。
 */
export interface EssenceDomainSpec {
  /** 一级维度 code（如 D2） */
  dimension_code: string;
  /** 展示名（如「数学高阶思维」） */
  name: string;
}

/** 一套完整评价标准（支持版本管理、校本替换） */
export interface RubricStandard {
  /** 标准集 code，内置为 qzxc-math-v5 */
  code: string;
  name: string;
  version: string;
  subject: string;
  description: string;
  dimensions: Dimension[];
  indicators: Indicator[];
  lesson_types: LessonTypeTemplate[];
  /**
   * 内涵分析域（认知 / 情感）。缺失时分析报告不产出内涵观察点区块。
   */
  essence_domains?: {
    cognitive: EssenceDomainSpec;
    affective: EssenceDomainSpec;
  };
  /**
   * 课型分析模型（课型即评价模型的路由键）。缺失时不产出课型要点评价。
   * 换学科/课题时整体替换该数组即可，引擎与提示语无需改代码。
   */
  lesson_type_models?: LessonTypeModel[];
}

// ============================================================
// 分析引擎相关类型
// ============================================================

/** 数据来源 */
export type DataSource =
  | "av_transcript" // 音视频对话（V1.1 为导入转写文稿）
  | "task_sheet" // 学生任务单 OCR（V1.2）
  | "observer_note" // 观察员记录结构化（V1.2）
  | "lesson_plan" // 教学设计（教案，课前设计证据）
  | "manual_annotation"; // 人工标注

export const SOURCE_LABEL: Record<DataSource, string> = {
  av_transcript: "音视频对话",
  task_sheet: "任务单分析",
  observer_note: "观察记录",
  lesson_plan: "教学设计",
  manual_annotation: "人工标注",
};

/** 多源融合默认权重（PRD 3.4.1）
 * 注：lesson_plan 为 V1.9 新增第五路（仅对有设计依据的指标打分），
 * 旧四路权重不变；融合时按有效来源权重归一化，总量>1 不影响分数。
 */
export const DEFAULT_SOURCE_WEIGHTS: Record<DataSource, number> = {
  av_transcript: 0.4,
  task_sheet: 0.25,
  observer_note: 0.2,
  lesson_plan: 0.15,
  manual_annotation: 0.15,
};

/** 单来源对某指标的评分证据 */
export interface SourceScore {
  source: DataSource;
  /** 0-10，null 表示该来源无数据 */
  score: number | null;
  /** 证据摘要（命中的原话/标注/记录） */
  evidences: string[];
  /** 置信度 0-1，无数据为 0 */
  confidence: number;
}

/** 指标融合结果 */
export interface IndicatorResult {
  indicator_code: string;
  /** 二级指标名（V1.13 起写入；旧报告可能缺失，展示侧回退到指标编码） */
  name?: string;
  /** 融合后 0-10；null 表示本次无可评分来源 */
  score: number | null;
  /** 是否存在多源冲突需人工复核 */
  need_review: boolean;
  source_scores: SourceScore[];
  /**
   * 有材料但模型未找到相关课堂表现（score 为 0 且无任何证据支撑）。
   * 与「缺材料」不同：那种是没交任务单/观察表，这种是交了但没找到对应表现。
   * 仅由 engine 的 0 分守卫置 true，旧报告缺省。
   */
  no_evidence?: boolean;
  /** 该指标所需材料本次一种都没交（由 source_availability 汇总，供状态列区分） */
  missing_material?: boolean;
}

/** 维度融合结果 */
export interface DimensionResult {
  dimension_code: string;
  /** 融合后 0-10（若该维度经人工终裁，此处为终裁分） */
  score: number | null;
  /** 人工终裁前的 AI 融合原始分 0-10；未终裁时不返回 */
  ai_score?: number | null;
  /** 5 档等级 label */
  level_label: string | null;
  need_review: boolean;
  indicators: IndicatorResult[];
  evidences: string[];
  /** 维度级各来源原始分（D1/D4/D5 无二级指标时仍可透明展示与复核），证据分组按它渲染 */
  source_scores: SourceScore[];
  /**
   * 分数对账口径（V1.8）：
   * - indicator_aggregate：维度分由其下二级指标聚合得出，老师可自行验算
   * - source_fusion：该维度无二级指标，只能由多来源分融合得出（需在 UI 说明）
   */
  reconcile_method?: "indicator_aggregate" | "source_fusion";
  /** 指标聚合值 0-10（reconcile_method=indicator_aggregate 时与 score 相等） */
  indicator_avg?: number | null;
  /** 多来源加权融合的参考值 0-10（仅作诊断与复核参考，不作为维度分） */
  source_fused?: number | null;
  /** 对账差异 |indicator_avg - source_fused|，超过阈值触发人工复核 */
  reconcile_gap?: number | null;
  /** 触发复核的原因（V1.8）：来源冲突 / 对账有缺口 / 两者皆有；未触发时不返回 */
  review_reason?: "source_conflict" | "reconcile_gap" | "both";
}

/** 人工校准记录（AI 与人工双留痕） */
export interface ManualCalibration {
  dimension_code: string;
  /** 人工最终分，null 表示未覆盖 */
  final_score: number | null;
  review_note?: string;
  reviewer?: string;
  reviewed_at?: string;
}

// ============================================================
// 课型专属分析模型（依据《AIC 课型手册 1.0》数学部分）
// 课型是评价模型的路由键：选定课型后加载该课型的分析要点集逐条评分。
// ============================================================

/** 课型要点评分结果 */
export interface LessonTypePointResult {
  code: string;
  /** 手册原始要点编号 */
  no: number;
  name: string;
  /** 手册给出的判定定义 */
  definition: string;
  /** 0-10；null 表示材料中未找到该要点的表现依据 */
  score: number | null;
  /** 五档等级标签 */
  level_label: string | null;
  reason?: string;
  evidences?: string[];
  /** 与 evidences 等长、一一对应，标记每条证据来源；由合并时写入，缺省表示来源不明 */
  evidence_sources?: DataSource[];
}

/** 课型视角（要点分组）评分结果 */
export interface LessonTypeViewpointResult {
  code: string;
  name: string;
  points: LessonTypePointResult[];
  /** 该视角下有分要点的均值；无分时为 null */
  score: number | null;
}

/** 课型专属评价结果 */
export interface LessonTypeEvaluation {
  /** 归一化后的课型编码（new/review/comment/practice/topic） */
  lesson_type: string;
  lesson_type_name: string;
  /** 手册小节号 */
  manual_section: string;
  /** 课型定位一句话 */
  summary: string;
  /** 是否请求了 AI 语义评分（课型要点评分的唯一来源） */
  llm_enabled: boolean;
  /** 是否成功产出要点分 */
  llm_used: boolean;
  viewpoints: LessonTypeViewpointResult[];
  /** 有分要点的均值（0-10） */
  total_score: number | null;
  /** 有分要点均值换算 0-100 */
  total_score_100: number | null;
  scored_points: number;
  total_points: number;
  /** 课型来源：模型自动识别 / 人工指定 */
  source: "auto" | "manual";
  /** 自动识别置信度 0-1 */
  confidence?: number | null;
  /** 自动识别依据摘要 */
  detection_basis?: string | null;
  /** 实际使用的模型 */
  model?: string;
}

/**
 * 维度级 AI 解读（按需生成）：为单个维度的评分回答四问——
 * 依据/素材、为什么是这个分、如何解读、如何提升。
 * 与 ai_commentary 一样只做解读与建议，不修改任何评分数据。
 */
export interface DimensionInterpretation {
  dimension_code: string;
  /** 评分依据与素材：用了哪些材料、哪些指标/证据支撑这个分 */
  basis: string;
  /** 为什么这节课该维度评这个分：从证据到分数的推理 */
  why: string;
  /** 如何解读这个分：等级含义、维度间位置与阅读边界 */
  how_to_read: string;
  /** 如何提升：先写可补充的材料（任务单/观察记录等），再写教学设计与实施的改进 */
  how_to_improve: string;
}

/** 完整分析报告结果 */
export interface AnalysisReport {
  lesson_id: string;
  standard_code: string;
  /** 标准中文名（V1.4.1 起随快照落库；旧快照缺省，展示时回落 code） */
  standard_name?: string;
  standard_version: string;
  /** 综合得分 0-100 */
  total_score: number;
  /** 综合等级 */
  total_level: string;
  dimension_results: DimensionResult[];
  source_weights: Record<DataSource, number>;
  /** 各来源数据是否齐备（用于可观测，避免静默缺源） */
  source_availability: Record<DataSource, boolean>;
  calibrations: ManualCalibration[];
  generated_at: string;
  /** AI（DeepSeek）参与情况：是否启用、是否成功、模型与降级原因 */
  ai_meta?: AiMeta;
  /** AI 生成的报告评语（教学分析与改进建议），模型不可用时缺省 */
  ai_commentary?: AiCommentary;
  /** 各维度的 AI 解读（四段长文，查看报告时按需生成并回写），旧报告缺省 */
  dimension_interpretations?: DimensionInterpretation[];
  /**
   * 表一内涵观察点的 AI 解读（V1.19）：认知/情感各一段四段长文，
   * 复用 DimensionInterpretation 结构，dimension_code = 'cognitive' / 'affective'；
   * 查看报告时按需生成并回写，旧报告缺省 */
  essence_interpretations?: DimensionInterpretation[];
  /** 课型专属分析模型评价结果（未设置或无法识别课型时为 null） */
  lesson_type_eval?: LessonTypeEvaluation | null;
  /** 表一内涵框架细化评价：认知（高阶思维 11 指标）+ 情感（情感素养 8 指标）观察点 */
  essence_eval?: EssenceEvaluation | null;
}

// ============================================================
// 表一内涵框架：二级指标细化观察点评价（认知 11 + 情感 8）
// ============================================================

/** 单个观察点的评价结果 */
export interface EssencePointResult {
  code: string;
  name: string;
  /** 观察点定义 */
  definition: string;
  /** 主要证据来源 */
  sources: PointSource[];
  /** 0-10；无证据留空，不臆造 */
  score: number | null;
  /**
   * V1.9d：未评分的原因。
   * 'missing_material' = 该点所需材料本次未提交（如只交了转写，任务单/观察表专属点不可评）；
   * 未设置 = 材料齐备但未找到表现证据。
   * 两种情况都不参与平均，但前者提示用户补材料，后者是真实的低表现/无表现。
   */
  missing_material?: boolean;
  reason?: string;
  evidences?: string[];
}

/** 二级指标（认知/情感）的观察点结果 */
export interface EssenceIndicatorResult {
  code: string;
  name: string;
  /** 一级类别：策略型/批判型/创新型；心理调适/交流协作/信念内省/价值责任 */
  category: string;
  /** 所属一级内涵：cognitive 认知 / affective 情感 */
  domain: 'cognitive' | 'affective';
  points: EssencePointResult[];
  /** 有分观察点均值（0-10） */
  score: number | null;
  /**
   * V1.10 两链对账：同一编码在五维指标直评链上的分数。
   * 两条链共用同一份量表与行为锚点，这里的差用于监控松紧度是否相当（目标 ≤1.0）。
   */
  chain_score?: number | null;
  /** V1.10 两链对账：|观察点聚合分 − 指标直评分|；任一侧无分时为 null */
  chain_gap?: number | null;
}

/** 一级内涵（认知或情感）的评价结果 */
export interface EssenceDomainResult {
  domain: 'cognitive' | 'affective';
  name: string;
  /** 二级指标数（认知 11 / 情感 8） */
  indicators: EssenceIndicatorResult[];
  /** 有分指标均值（0-10） */
  score: number | null;
  /** 0-100 */
  score_100: number | null;
  scored_indicators: number;
  total_indicators: number;
  scored_points: number;
  total_points: number;
  /** V1.10 两链对账：可比指标的平均绝对差（观察点聚合 vs 指标直评）；无可比项时缺省 */
  chain_gap_avg?: number | null;
  /** V1.10 两链对账：参与比较的指标数 */
  chain_compared?: number;
}

/** 表一内涵框架细化评价 */
export interface EssenceEvaluation {
  llm_enabled: boolean;
  llm_used: boolean;
  model?: string;
  cognitive: EssenceDomainResult;
  affective: EssenceDomainResult;
  /** 有分观察点总数 */
  scored_points: number;
  /** 观察点总数（57） */
  total_points: number;
}

/** LLM 对单个指标的语义评分 */
export interface LlmIndicatorScore {
  /** 0-10；null 表示模型认为该指标无相关表现 */
  score: number | null;
  /** 模型给出的判定理由 */
  reason: string;
  /** 模型引用的原文证据 */
  evidences: string[];
  /** 与 evidences 等长、一一对应，标记每条证据来源；由合并时写入，缺省表示来源不明 */
  evidence_sources?: DataSource[];
}

/** 指标级 LLM 评分映射：indicator_code -> 评分 */
export type LlmScoreMap = Record<string, LlmIndicatorScore>;

/** AI 参与元信息 */
export interface AiMeta {
  /** 是否请求了 AI */
  enabled: boolean;
  /** AI 是否成功产出（评分或评语） */
  used: boolean;
  /** 实际使用的模型 */
  model: string;
  /** 降级原因；未启用时为 null */
  error?: string | null;
}

/** AI 报告评语 */
export interface AiCommentary {
  /** 总体结论（2-4 句） */
  summary: string;
  /** 课堂亮点 */
  highlights: string[];
  /** 改进建议 */
  suggestions: string[];
  /**
   * V1.11 情智关系解读：一句话说清本课「情感」与「认知」如何相互支撑、或在哪里彼此阻滞。
   * 旧快照无此字段，前端需容错。
   */
  essence_coupling?: string;
  /**
   * V1.11 可执行动作：3 条下一节课就能改的具体行为（区别于「改进建议」的方向性表述）。
   * 旧快照无此字段，前端需容错。
   */
  action_items?: string[];
  model: string;
  generated_at: string;
}

/** 情智双侧速读（V1.11）：由报告派生，不落库 */
export interface EssenceHeadline {
  /** 认知侧（数学高阶思维 D2）0-100，与下方五维表同源同尺；无数据为 null */
  cognitive_100: number | null;
  /** 情感侧（数学情感素养 D3）0-100，与下方五维表同源同尺；无数据为 null */
  affective_100: number | null;
  /**
   * 关系形态（不是水平高低，也不比较优劣）：两线并进 / 认知侧走得更前 / 情感侧走得更前 / 材料待补。
   * 「情智相长」的核心是异步带动——认知与情感本可以不同步，把两者压成一个木桶短板标签
   * 会把「竞赛课（认知强情感冷）」与「活动课（情感热认知浅）」混成同一档，而两者下节课
   * 该改的方向完全相反。因此这里报告的是结构关系：哪一侧走得更前，仅此而已。
   * 报告关系不等于比较优劣 —— 两个向度衡量的是不同的东西，「认知更好」不成立。
   */
  state: "parallel" | "cog_ahead" | "aff_ahead" | "insufficient";
  /** 认知侧档位名（取自 bandLevelOf100，与五维表同源同尺）；无数据为 null */
  cognitive_band: string | null;
  /** 情感侧档位名（同上）；无数据为 null */
  affective_band: string | null;
  /** 材料齐备路数 / 应备路数 */
  material_ready: number;
  material_total: number;
  /** 指标覆盖（已评 / 全部） */
  indicator_scored: number;
  indicator_total: number;
}
