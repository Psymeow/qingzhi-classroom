import 'server-only';
import { LlmError, chatJson, isLlmEnabled, llmModel } from '@/lib/llm/deepseek';
import {
  type GradeBand,
  type LessonTypeModel,
  type LessonTypePoint,
} from '@/lib/evaluation/lesson-type-models';
import type {
  LlmIndicatorScore,
  LlmScoreMap,
  ObservationPoint,
  RubricStandard,
} from '@/lib/evaluation/types';
import { POINT_SOURCE_LABEL } from '@/lib/evaluation/essence-points';
import { pointBandPromptLines } from '@/lib/evaluation/essence-point-bands';
import {
  essenceIndicatorsOf,
  fallbackStandard,
  lessonTypeModelOf,
  subjectLabel,
} from '@/lib/evaluation/standard-registry';

// ============================================================
// LLM 语义评分（DeepSeek）
// 把「课堂转写文稿 / 观察员记录」按评价指标逐项做语义理解与打分，
// 产出与规则引擎同粒度的指标级分数（indicator_code -> 0-10）。
// 与规则引擎的关系：模型分为主，规则分兜底；模型失败时调用方回退规则匹配。
// ============================================================

/** 单次送入模型的文本上限（字符），超出截断以控制时延与成本 */
const MAX_CHARS = 14_000;

/**
 * V1.27：是否把 57 个观察点各自的五档判据注入 prompt。
 * 此前只有一份通用锚点，模型对每个点「什么样算 8 分」只能自由裁量，同一节课的松紧不稳定。
 * 全量注入后单次约多 1 万 token（DeepSeek 下可接受）；若要压成本改回 false 即可回到旧行为。
 */
const INJECT_BAND_NOTES = true;

/**
 * V1.10：两链统一行为锚点。
 * 指标直评链（五维）与观察点链（表一）原先都只写了「0=完全没有，10=充分高质量」，
 * 中间档没有定义，模型自由裁量；加上逐点判断比整体印象更严，导致同一编码在两条链上
 * 得到两套分（如 D2 维度分 6.9 vs 表一认知域 4.1）。这里把分档口径固定成一份，两条链共用。
 */
const BEHAVIOR_ANCHOR_LINES = [
  '【统一行为锚点】（指标层与观察点层共用同一口径，同一分数指同一水平）',
  '- 9-10 典范：多数学生稳定表现该行为，且有迁移、创新、自我调节等超出常规的高质量证据',
  '- 7-8 良好：多数学生能表现该行为，质量稳定，个别环节有亮点',
  '- 5-6 中等：约半数学生或半数环节出现，多为应答式、模仿式，缺乏自主推进',
  '- 3-4 薄弱：少数学生或偶发环节出现，表现浅表，需教师反复引导',
  '- 0-2 缺失：材料中有相关内容但表现确实薄弱（必须引用原文）；完全无证据则不输出该项',
  '- 严禁用 score: 0 表示「无证据」——0 分只用于「有相关表现但确实未达成」且必须给出证据；无证据时输出 null 或不输出该项',
];

function indicatorBrief(std: RubricStandard): string {
  return std.indicators
    .map((i) => {
      // V1.10：把下位观察点一起交给模型，让指标分与逐点判断参照同一批具体行为，
      // 避免「指标层看整体印象、观察点层看细行为」造成的系统性松紧差。
      const pts = (i.observation_points ?? []).map((p) => p.name).filter(Boolean);
      const ptLine = pts.length > 0 ? `｜具体行为：${pts.join('、')}` : '';
      return `- ${i.code} ${i.name}：${i.description}${ptLine}`;
    })
    .join('\n');
}

function codeSetOf(std: RubricStandard): Set<string> {
  return new Set(std.indicators.map((i) => i.code));
}

export type TranscriptKind = 'transcript' | 'observer' | 'task_sheet' | 'lesson_plan';

const KIND_LABEL: Record<TranscriptKind, string> = {
  transcript: '课堂实录（师生对话，可能含时间码）',
  observer: '观察员现场记录（第三方描述，非师生逐句对话）',
  task_sheet: '学生任务单（学生作答痕迹与完成质量，反映个体思维与情感表现）',
  lesson_plan: '教学设计/教案（课前设计文本，反映教学目标、环节与活动的设计意图）',
};

export interface LlmScoringResult {
  /** 指标级评分映射 */
  scores: LlmScoreMap;
  /** 实际使用的模型 */
  model: string;
  /** 成功打分的指标数 */
  scored: number;
}

interface RawScoringResponse {
  indicators?: Array<{
    code?: unknown;
    score?: unknown;
    reason?: unknown;
    evidences?: unknown;
  }>;
}

function buildSystemPrompt(std: RubricStandard): string {
  return [
    `你是${subjectLabel(std.subject)}课堂观察与评价专家，精通「${std.name}」评价框架。`,
    '你需要依据课堂材料，对给定的评价指标逐项判断其表现程度并打分。',
    '判断必须严格基于材料内容，不得臆测、不得套话；没有依据的指标一律不输出。',
  ].join('\n');
}

function buildUserPrompt(text: string, kind: TranscriptKind, std: RubricStandard): string {
  return [
    `【评价指标清单】（共 ${std.indicators.length} 项；每项后列出其下位具体行为，指标分应体现这些行为的整体水平）`,
    ...BEHAVIOR_ANCHOR_LINES,
    '',
    indicatorBrief(std),
    '',
    '【待分析材料】类型：' + KIND_LABEL[kind],
    '"""',
    text,
    '"""',
    '',
    '【打分要求】',
    '1. 逐项判断该指标在材料中的表现程度，给出 0-10 分（0=完全没有体现，10=充分且高质量体现）。',
    '2. 只对能从材料中找到依据的指标打分；完全没有相关表现的指标不要出现在结果里。',
    '3. 每项证据必须引用材料原文（可截取关键句，最多 3 条），严禁编造或改写原意。',
    '4. 每项给出 30 字以内的判定理由。',
    '5. 同一指标多次出现时，按表现质量与频次综合给分，避免仅凭关键词出现就高分。',
    '6. 按统一行为锚点定档：指标分应等于其下位具体行为清单的整体水平。仅有目标、要求、计划等「设计性表述」而缺少课堂实际发生的证据时，最高不超过 6 分；只有少数学生或个别环节出现时，落在 3-5 分。',
    '7. 区分「表现差」与「无法观察」：0-2 分只用于材料有相关内容但表现确实薄弱，且必须引用原文；完全没有可供判断内容的指标，不要输出。',
    ...(kind === 'lesson_plan'
      ? [
          '8. 本材料是课前教学设计（教案），反映设计意图而非课堂实施结果。优先评「教学设计」相关的评价指标（如教学目标、情境与活动设计、分层与评价设计等）；课堂实施、师生互动等必须依赖现场证据的指标，若教案中无相应设计内容则不要打分。',
        ]
      : []),
    '',
    '严格按以下 JSON 结构输出，不要输出任何其他内容：',
    '{"indicators":[{"code":"D2-1","score":7.5,"reason":"判定理由","evidences":["材料原文片段"]}]}',
  ].join('\n');
}

function normalize(raw: RawScoringResponse, codeSet: Set<string>): LlmScoreMap {
  const out: LlmScoreMap = {};
  for (const item of raw.indicators ?? []) {
    const code = typeof item.code === 'string' ? item.code.trim() : '';
    if (!codeSet.has(code) || out[code]) continue;

    const scoreRaw = typeof item.score === 'number' ? item.score : Number(item.score);
    const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.min(10, Math.round(scoreRaw * 10) / 10)) : null;

    const reason = typeof item.reason === 'string' ? item.reason.trim().slice(0, 200) : '';
    const evidences = Array.isArray(item.evidences)
      ? item.evidences
          .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
          .map((e) => e.trim().slice(0, 200))
          .slice(0, 3)
      : [];

    const entry: LlmIndicatorScore = { score, reason, evidences };
    out[code] = entry;
  }
  return out;
}

/**
 * 用 DeepSeek 对一段课堂材料做指标级语义评分。
 * 未配置密钥或调用失败时抛 LlmError，由调用方降级到规则引擎。
 */
export async function scoreMaterialWithLlm(
  text: string,
  kind: TranscriptKind,
  standard: RubricStandard = fallbackStandard(),
): Promise<LlmScoringResult> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');
  const body = text.trim();
  if (!body) throw new LlmError('待分析材料为空');

  const clipped = body.length > MAX_CHARS ? body.slice(0, MAX_CHARS) : body;

  const raw = await chatJson<RawScoringResponse>(
    [
      { role: 'system', content: buildSystemPrompt(standard) },
      { role: 'user', content: buildUserPrompt(clipped, kind, standard) },
    ],
    { temperature: 0.2, maxTokens: 4096 },
  );

  const scores = normalize(raw, codeSetOf(standard));
  return { scores, model: llmModel(), scored: Object.keys(scores).length };
}

// ============================================================
// 课型专属要点评分
// 依据《AIC 课型手册 1.0》的课型分析模型：先按课型加载该课型的分析要点集，
// 再让模型对每条要点逐项判断表现程度，产出要点级分数（point_code -> 0-10）。
// 与通用五维指标评分互补：通用指标看「素养水平」，课型要点看「这节课该做的事做到没有」。
// ============================================================

/** 单条要点最多引用的证据数（控制输出长度，避免超出 max_tokens） */
const MAX_EVIDENCES_PER_POINT = 2;

function buildLessonTypeSystemPrompt(band: GradeBand, std: RubricStandard): string {
  const bandName = band === 'primary' ? '小学' : band === 'junior' ? '初中' : '高中';
  const subj = subjectLabel(std.subject);
  const typeNames = (std.lesson_type_models ?? []).map((m) => m.name);
  const typeHint = typeNames.length ? `，熟悉${typeNames.join('、')}等课型的专属分析模型` : '';
  return [
    `你是${bandName}${subj}课堂观察与评价专家，精通「${std.name}」评价模型${typeHint}。`,
    `请始终站在${bandName}${subj}的学段特征上判断：贴合该学段学生的认知水平、学科语言与活动方式，不用更高学段的标准苛责，也不把更高学段才要求的能力当作缺失。`,
    '你需要依据课堂材料，对该课型分析模型中的每一条分析要点逐项判断其表现程度并打分。',
    '判断必须严格基于材料内容，不得臆测、不得套话；没有依据的要点一律不输出。',
    '只按本课型的教学特点判断，不要用其他课型的标准衡量。',
  ].join('\n');
}

function lessonTypeBrief(model: LessonTypeModel): string {
  return model.viewpoints
    .map((v) => {
      const pts = v.points.map((p) => `- ${p.code} ${p.name}：${p.definition}`).join('\n');
      return `【${v.name}】\n${pts}`;
    })
    .join('\n\n');
}

function buildLessonTypeUserPrompt(
  text: string,
  kind: TranscriptKind,
  model: LessonTypeModel,
  points: LessonTypePoint[],
  band: GradeBand,
): string {
  const bandName = band === 'primary' ? '小学' : band === 'junior' ? '初中' : '高中';
  return [
    `【学段】${bandName}`,
    `【本课课型】${model.name}（课型手册 ${model.manual_section} 节）`,
    `【本课型分析要点】（共 ${points.length} 条，按分析视角分组）`,
    lessonTypeBrief(model),
    '',
    '【待分析材料】类型：' + KIND_LABEL[kind],
    '"""',
    text,
    '"""',
    '',
    '【打分要求】',
    '1. 逐条判断该要点在本课中的表现程度，给出 0-10 分（0=完全没有体现，10=充分且高质量体现）。',
    '2. 只对能从材料中找到依据的要点打分；完全没有相关表现的要点不要出现在结果里。',
    `3. 每项最多引用 ${MAX_EVIDENCES_PER_POINT} 条材料原文作为证据，每条不超过 40 字，严禁编造或改写原意。`,
    '4. 每项给出 30 字以内的判定理由。',
    '5. 严格使用给定的要点编码（code）原样返回，不要自造编码。',
    '',
    '严格按以下 JSON 结构输出，不要输出任何其他内容：',
    `{"indicators":[{"code":"${points[0]?.code ?? ''}","score":7.5,"reason":"判定理由","evidences":["材料原文片段"]}]}`,
  ].join('\n');
}

/**
 * 用 DeepSeek 对一段课堂材料做「课型专属要点」级语义评分。
 * 未识别课型、未配置密钥或调用失败时抛 LlmError，由调用方决定是否降级。
 */
export async function scoreLessonTypeWithLlm(
  text: string,
  kind: TranscriptKind,
  lessonType: string,
  band: GradeBand = 'primary',
  standard: RubricStandard = fallbackStandard(),
): Promise<LlmScoringResult> {
  const model = lessonTypeModelOf(standard, lessonType);
  if (!model) throw new LlmError(`未识别的课型：${lessonType}`);
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');
  const body = text.trim();
  if (!body) throw new LlmError('待分析材料为空');

  const points = model.viewpoints.flatMap((v) => v.points);
  const clipped = body.length > MAX_CHARS ? body.slice(0, MAX_CHARS) : body;

  const raw = await chatJson<RawScoringResponse>(
    [
      { role: 'system', content: buildLessonTypeSystemPrompt(band, standard) },
      { role: 'user', content: buildLessonTypeUserPrompt(clipped, kind, model, points, band) },
    ],
    { temperature: 0.2, maxTokens: 8192 },
  );

  const scores = normalize(raw, new Set(points.map((p) => p.code)));
  return { scores, model: llmModel(), scored: Object.keys(scores).length };
}

// ============================================================
// 表一内涵框架 · 二级指标细化观察点评分
// 认知（数学高阶思维 3 类 11 指标）与情感（数学情感素养 4 类 8 指标）
// 共 57 个观察点，逐条语义打分；观察点只走 LLM，无规则兜底。
// ============================================================

/** 内涵域（认知 + 情感）下的全部二级指标 */
function essenceIndicators(std: RubricStandard) {
  return [
    ...essenceIndicatorsOf(std, 'cognitive'),
    ...essenceIndicatorsOf(std, 'affective'),
  ];
}

/** 内涵观察点（按二级指标挂载） */
function essencePoints(std: RubricStandard): ObservationPoint[] {
  return essenceIndicators(std).flatMap((i) => i.observation_points ?? []);
}

function essenceCodeSet(std: RubricStandard): Set<string> {
  return new Set(essencePoints(std).map((p) => p.code));
}

function essenceBrief(std: RubricStandard): string {
  const inds = essenceIndicators(std);
  const indName = new Map(inds.map((i) => [i.code, i.name]));
  const indCat = new Map(inds.map((i) => [i.code, i.category ?? '']));
  return inds
    .filter((i) => (i.observation_points ?? []).length > 0)
    .map((i) => {
      const lines = (i.observation_points ?? [])
        .map((p) => {
          const head = `- ${p.code} ${p.name}：${p.description ?? ''}（主要证据来源：${(p.sources ?? [])
            .map((s) => POINT_SOURCE_LABEL[s])
            .join('、')}）`;
          if (!INJECT_BAND_NOTES) return head;
          // V1.27：附上本点自己的五档判据。通用锚点只说「多数学生稳定表现」，
          // 说不出这个点的「稳定表现」具体长什么样；逐点判据补的就是这一层。
          // 未收录判据的点退回单行，不阻断评分。
          const bands = pointBandPromptLines(p.code);
          return bands ? `${head}\n${bands}` : head;
        })
        .join('\n');
      return `【${i.code} ${indName.get(i.code) ?? ''}·${indCat.get(i.code) ?? ''}】\n${lines}`;
    })
    .join('\n\n');
}

export interface EssenceScoringResult {
  /** 观察点级评分：point_code -> 评分 */
  scores: LlmScoreMap;
  model: string;
  scored: number;
}

function buildEssenceUserPrompt(
  text: string,
  kind: TranscriptKind,
  band: GradeBand = 'primary',
  std: RubricStandard = fallbackStandard(),
): string {
  const bandName = band === 'senior' ? '高中' : band === 'junior' ? '初中' : '小学';
  const inds = essenceIndicators(std);
  const pts = essencePoints(std);
  return [
    `【学段】${bandName}（请按${bandName}学段学生的认知与情感发展水平判断表现是否充分，区分学段适切性）`,
    `【内涵观察点清单】（共 ${pts.length} 个，按 ${inds.length} 个二级指标分组；每条已标注主要证据来源）`,
    essenceBrief(std),
    '',
    '【证据来源说明】',
    '- 课堂音视频：师生逐句对话与课堂过程；人工观察表：第三方质性记录（参与面、情绪、角色行为）；学生任务单：作答痕迹与完成质量。',
    '- 本次材料类型为' +
      KIND_LABEL[kind] +
      '。仅依据「学生任务单」才能判断的观察点，在本材料中通常无证据，应留空。',
    '',
    '【待分析材料】',
    '"""',
    text,
    '"""',
    '',
    ...BEHAVIOR_ANCHOR_LINES,
    '',
    '【打分要求】',
    '1. 逐观察点按上述统一锚点定档给分，与五维指标评分使用同一口径：某指标下各观察点若普遍落 5-6，该指标整体也应落在 5-6，不要因逐点判断而系统性压低。',
    '2. 严格基于材料：找不到证据的观察点一律不输出；不得因教师提到该词就给高分，要看学生的真实思维/情感表现。',
    '3. 区分「表现差」与「无法观察」：0-2 分仅用于材料中有相关内容但表现确实很弱，且必须引用到原文证据；材料中根本没有可供判断的内容时，该点直接不输出，严禁用 0 分表达「没看到」。',
    '4. 尊重证据来源：标注为「学生任务单」的观察点只能依据任务单作答痕迹打分，标注为「人工观察表」的只能依据第三方观察记录打分；本材料不含该来源时，相关观察点一律不输出，不要用课堂转写中的内容代替。',
    '5. 每条最多 1 条材料原文证据（40 字内），严禁编造；30 字内理由。',
    '6. 严格使用给定观察点编码（如 D2-1-P1），不要自造编码。',
    '',
    '严格按以下 JSON 结构输出，不要输出任何其他内容：',
    '{"indicators":[{"code":"D2-1-P1","score":7,"reason":"理由","evidences":["原文片段"]}]}',
  ].join('\n');
}

/**
 * 用 DeepSeek 对一段课堂材料做表一内涵观察点（57 个）级语义评分。
 * 未配置密钥或材料为空时抛 LlmError；调用方负责多材料合并与降级。
 */
export async function scoreEssenceWithLlm(
  text: string,
  kind: TranscriptKind,
  band: GradeBand = 'primary',
  standard: RubricStandard = fallbackStandard(),
): Promise<EssenceScoringResult> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');
  const body = text.trim();
  if (!body) throw new LlmError('待分析材料为空');

  const clipped = body.length > MAX_CHARS ? body.slice(0, MAX_CHARS) : body;
  const spec = standard.essence_domains;
  const cogName = spec?.cognitive.name ?? '认知素养';
  const affName = spec?.affective.name ?? '情感素养';
  const catsOf = (d: 'cognitive' | 'affective') =>
    Array.from(
      new Set(essenceIndicatorsOf(standard, d).map((i) => i.category).filter(Boolean)),
    ).join('、');
  const raw = await chatJson<RawScoringResponse>(
    [
      {
        role: 'system',
        content:
          `你是${subjectLabel(standard.subject)}课堂观察与评价专家，精通「${standard.name}」模型的${cogName}（${catsOf('cognitive')}）与${affName}（${catsOf('affective')}）观察框架。` +
          '你需要依据课堂材料，对细化观察点逐项判断学生真实表现并打分；必须严格基于材料，不得臆测、不得套话，没有依据的观察点一律不输出。',
      },
      { role: 'user', content: buildEssenceUserPrompt(clipped, kind, band, standard) },
    ],
    { temperature: 0.2, maxTokens: 8192 },
  );

  const scores = normalize(raw, essenceCodeSet(standard));
  return { scores, model: llmModel(), scored: Object.keys(scores).length };
}
