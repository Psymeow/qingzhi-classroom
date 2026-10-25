import 'server-only';
import type { DbClient } from '@/lib/auth/server';
import { analyzeLesson, applyCalibration, type EngineInput } from '@/lib/evaluation/engine';
import type {
  AiMeta,
  AnalysisReport,
  DataSource,
  LlmScoreMap,
  ManualCalibration,
  RubricStandard,
} from '@/lib/evaluation/types';
import { isLlmEnabled, llmModel } from '@/lib/llm/deepseek';
import { friendlyAiError, friendlyCommentaryError } from '@/lib/llm/ai-error';
import { scoreLessonTypeWithLlm, scoreMaterialWithLlm, scoreEssenceWithLlm } from '@/lib/evaluation/llm-scorer';
import { gradeBandOf } from '@/lib/evaluation/lesson-type-detect';
import { normalizeLessonType, type GradeBand } from '@/lib/evaluation/lesson-type-models';
import { resolveStandard } from '@/lib/evaluation/standard-registry';
import { generateCommentary } from '@/lib/llm/report-commentary';

// ============================================================
// 分析引擎接线层（服务端）
// 职责：按课例聚合「转写文稿 + 观察员记录 + 人工标注」→ 跑多源融合引擎
//      → 应用人工校准 → 结果落 reports（每课例保留一条最新报告）。
// 纯计算逻辑在 evaluation/engine.ts，本文件只负责取数、装配与持久化。
// ============================================================

export interface RunAnalysisOptions {
  /** 权重调节（仅覆盖传入的来源，其余用默认 40/25/20/15） */
  source_weights?: Partial<Record<DataSource, number>>;
  /** 人工校准（维度终裁分 + 复核备注） */
  calibrations?: Array<{
    dimension_code: string;
    final_score: number | null;
    review_note?: string;
  }>;
  reviewer?: string;
  /** 是否启用 LLM（DeepSeek）语义评分；默认 true，未配置密钥时自动降级为规则引擎 */
  useLlm?: boolean;
  /** 是否生成 AI 报告评语；默认跟随 useLlm */
  useCommentary?: boolean;
  /** 运行时指定/覆盖课型；不传则使用课例已保存的课型 */
  lesson_type?: string | null;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 记录一条 LLM 子任务的失败：原始技术信息仅进服务端控制台，
 * 用户侧提示统一走 friendlyAiError 脱敏。
 */
function recordLlmFailure(errors: string[], prefix: string, e: unknown) {
  console.error(`[llm-fallback] ${prefix}`, e instanceof Error ? e.message : String(e));
  errors.push(friendlyAiError(errMsg(e), prefix));
}

/** AI 评分阶段总时限（毫秒）：单次请求 45s，整段留 55s 预算，超出则未完成项降级为规则引擎。 */
const LLM_STAGE_TIMEOUT_MS = 55_000;

/**
 * 调用 LLM 对文本材料做两级语义评分：
 * ① 通用五维指标（素养水平）；② 课型专属分析要点（本课型该做的事做到没有）。
 * 任何失败（未配密钥 / 超时 / 返回异常）都降级为规则引擎，绝不阻断分析主流程。
 */
async function collectLlmScores(
  engineInput: EngineInput,
  enabled: boolean,
  band: GradeBand,
  standard: RubricStandard,
): Promise<{
  llmScores?: { av?: LlmScoreMap; observer?: LlmScoreMap };
  taskSheetScores?: LlmScoreMap;
  lessonPlanScores?: LlmScoreMap;
  lessonTypeScores?: LlmScoreMap;
  lessonTypeModelName?: string;
  lessonTypeRequested: boolean;
  essenceScores?: LlmScoreMap;
  essenceRequested: boolean;
  essenceModelName?: string;
  aiMeta: AiMeta;
}> {
  const model = llmModel();
  const lessonType = normalizeLessonType(engineInput.lesson_type);
  if (!enabled) {
    return { lessonTypeRequested: false, essenceRequested: false, aiMeta: { enabled: false, used: false, model, error: null } };
  }
  if (!isLlmEnabled()) {
    return {
      lessonTypeRequested: false,
      essenceRequested: false,
      aiMeta: { enabled: true, used: false, model, error: friendlyAiError('未配置 DEEPSEEK_API_KEY') },
    };
  }

  const transcript = engineInput.transcript?.trim();
  const observerText = engineInput.observerText?.trim();
  const taskSheetText = engineInput.taskSheetText?.trim();
  const lessonPlanText = engineInput.lessonPlanText?.trim();
  if (!transcript && !observerText && !taskSheetText && !lessonPlanText) {
    return {
      lessonTypeRequested: false,
      essenceRequested: false,
      aiMeta: { enabled: true, used: false, model, error: friendlyAiError('暂无可供 AI 分析的文本材料') },
    };
  }

  const av: LlmScoreMap = {};
  const observer: LlmScoreMap = {};
  const ltScores: LlmScoreMap = {};
  // 表一内涵观察点：av/observer 分别取分，同点两源都有分时取均值
  const essenceAv: LlmScoreMap = {};
  const essenceOb: LlmScoreMap = {};
  const essenceTs: LlmScoreMap = {};
  const taskSheet: LlmScoreMap = {};
  const errors: string[] = [];
  const jobs: Array<Promise<void>> = [];

  if (transcript) {
    jobs.push(
      scoreMaterialWithLlm(transcript, 'transcript', standard)
        .then((r) => {
          Object.assign(av, r.scores);
        })
        .catch((e) => {
          recordLlmFailure(errors, '转写文稿', e);
        }),
      scoreEssenceWithLlm(transcript, 'transcript', band, standard)
        .then((r) => {
          Object.assign(essenceAv, r.scores);
        })
        .catch((e) => {
          recordLlmFailure(errors, '内涵观察点（转写文稿）', e);
        }),
    );
  }
  if (observerText) {
    jobs.push(
      scoreMaterialWithLlm(observerText, 'observer', standard)
        .then((r) => {
          Object.assign(observer, r.scores);
        })
        .catch((e) => {
          recordLlmFailure(errors, '观察记录', e);
        }),
      scoreEssenceWithLlm(observerText, 'observer', band, standard)
        .then((r) => {
          Object.assign(essenceOb, r.scores);
        })
        .catch((e) => {
          recordLlmFailure(errors, '内涵观察点（观察记录）', e);
        }),
    );
  }
  // 学生任务单（V1.4）：同一份材料同时进「通用指标」与「内涵观察点」两条评分链
  if (taskSheetText) {
    jobs.push(
      scoreMaterialWithLlm(taskSheetText, 'task_sheet', standard)
        .then((r) => {
          Object.assign(taskSheet, r.scores);
        })
        .catch((e) => {
          recordLlmFailure(errors, '学生任务单', e);
        }),
      scoreEssenceWithLlm(taskSheetText, 'task_sheet', band, standard)
        .then((r) => {
          Object.assign(essenceTs, r.scores);
        })
        .catch((e) => {
          recordLlmFailure(errors, '内涵观察点（学生任务单）', e);
        }),
    );
  }

  // 教学设计/教案（V1.9）：课前设计证据，只进通用指标链（不进课型要点与表一观察点）
  const lessonPlan: LlmScoreMap = {};
  if (lessonPlanText) {
    jobs.push(
      scoreMaterialWithLlm(lessonPlanText, 'lesson_plan', standard)
        .then((r) => {
          Object.assign(lessonPlan, r.scores);
        })
        .catch((e) => {
          recordLlmFailure(errors, '教学设计', e);
        }),
    );
  }

  // 课型专属要点评分：先按课型加载要点集，再与通用指标评分并行请求
  let ltModelName: string | undefined;
  const lessonTypeRequested = Boolean(lessonType);
  if (lessonType) {
    if (transcript) {
      jobs.push(
        scoreLessonTypeWithLlm(transcript, 'transcript', lessonType, band, standard)
          .then((r) => {
            Object.assign(ltScores, r.scores);
            ltModelName = r.model;
          })
          .catch((e) => {
            recordLlmFailure(errors, '课型要点（转写文稿）', e);
          }),
      );
    }
    if (observerText) {
      jobs.push(
        scoreLessonTypeWithLlm(observerText, 'observer', lessonType, band, standard)
          .then((r) => {
            Object.assign(ltScores, r.scores);
            ltModelName = r.model;
          })
          .catch((e) => {
            recordLlmFailure(errors, '课型要点（观察记录）', e);
          }),
      );
    }
  }

  // 带总时限地等待全部子任务：超时未返回的子任务降级，已完成的评分照常采用。
  let stageTimedOut = false;
  await Promise.race([
    Promise.all(jobs),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        stageTimedOut = true;
        resolve();
      }, LLM_STAGE_TIMEOUT_MS);
    }),
  ]);
  if (stageTimedOut) {
    console.error('[llm-fallback] AI 评分阶段总时限到达，未完成任务降级到规则引擎');
    errors.push(friendlyAiError('timeout', '部分 AI 评分未在时限内返回'));
  }

  const llmScores: { av?: LlmScoreMap; observer?: LlmScoreMap } = {};
  if (Object.keys(av).length) llmScores.av = av;
  if (Object.keys(observer).length) llmScores.observer = observer;

  const ltCount = Object.keys(ltScores).length;

  // 内涵观察点多源合并（音视频 / 观察记录 / 学生任务单）：多源有分取均值，证据合并
  const essenceScores: LlmScoreMap = {};
  const essenceSrcOf = (code: string) => [essenceAv[code], essenceOb[code], essenceTs[code]];
  for (const code of new Set([
    ...Object.keys(essenceAv),
    ...Object.keys(essenceOb),
    ...Object.keys(essenceTs),
  ])) {
    const srcs = essenceSrcOf(code);
    const vals = srcs.map((s) => s?.score).filter((v): v is number => typeof v === 'number');
    essenceScores[code] = {
      score: vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10 : null,
      reason: srcs.find((s) => s?.reason)?.reason ?? '',
      evidences: srcs.flatMap((s) => s?.evidences ?? []).slice(0, 3),
    };
  }
  const essenceCount = Object.keys(essenceScores).length;
  const essenceModelName = essenceCount > 0 ? model : undefined;

  const used = Boolean(llmScores.av || llmScores.observer);
  const tsCount = Object.keys(taskSheet).length;
  const lpCount = Object.keys(lessonPlan).length;
  return {
    llmScores: used ? llmScores : undefined,
    taskSheetScores: tsCount ? taskSheet : undefined,
    lessonPlanScores: lpCount ? lessonPlan : undefined,
    lessonTypeScores: ltCount ? ltScores : undefined,
    lessonTypeModelName: ltModelName,
    lessonTypeRequested,
    essenceScores: essenceCount ? essenceScores : undefined,
    essenceRequested: true,
    essenceModelName,
    aiMeta: {
      enabled: true,
      used: used || tsCount > 0 || lpCount > 0 || ltCount > 0 || essenceCount > 0,
      model,
      error: errors.length ? errors.join('；') : null,
    },
  };
}

export interface SavedReport {
  id: string;
  result: AnalysisReport;
  total_score: number;
  total_level: string | null;
  need_review_count: number;
  is_calibrated: boolean;
  source_weights: Record<DataSource, number> | null;
  created_at?: string;
  updated_at?: string;
}

/** 报告是否没有任何可用数据源（全空，不建议落库） */
export function reportHasAnySource(report: AnalysisReport): boolean {
  return Object.values(report.source_availability).some(Boolean);
}

/** 统计需要人工复核的维度数（指标级冲突明细保留在 result JSON 内） */
function countReviewDimensions(report: AnalysisReport): number {
  return report.dimension_results.filter((d) => d.need_review).length;
}

/**
 * 聚合数据并运行分析（不落库），便于预览。
 * 调用方需先确认课例归属。
 */
export async function buildReport(
  db: DbClient,
  lessonId: string,
  userId: string,
  opts: RunAnalysisOptions = {},
): Promise<AnalysisReport> {
  const [inputRes, annRes, lessonRes] = await Promise.all([
    db
      .from('ai_analysis_inputs')
      .select('transcript,observer_text,task_sheet_text,lesson_plan_text')
      .eq('lesson_id', lessonId)
      .eq('user_id', userId)
      .maybeSingle(),
    db
      .from('annotations')
      .select('payload')
      .eq('lesson_id', lessonId)
      .eq('user_id', userId)
      .maybeSingle(),
    db
      .from('lessons')
      .select('lesson_type,grade_class,standard_set_id')
      .eq('id', lessonId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const input = inputRes.data as {
    transcript?: string | null;
    observer_text?: string | null;
    task_sheet_text?: string | null;
    lesson_plan_text?: string | null;
  } | null;
  const annotation = (annRes.data as { payload?: unknown } | null)?.payload ?? null;
  const lessonRow = lessonRes.data as {
    lesson_type?: string | null;
    grade_class?: string | null;
    standard_set_id?: string | null;
  } | null;
  const storedType = lessonRow?.lesson_type ?? null;

  // V1.4：按课例绑定的标准集解析评价标准（为空/不可解析时回落内置种子）
  const standard = await resolveStandard(db, lessonRow?.standard_set_id ?? null);

  // 课型是评价模型的路由键：运行时指定优先，其次用课例已保存的课型
  const lessonType = normalizeLessonType(opts.lesson_type ?? storedType);
  // 学段差异化：由年级班级文本推断小学/初中/高中，注入课型评分提示语
  const gradeBand: GradeBand = gradeBandOf(lessonRow?.grade_class ?? null);

  const engineInput: EngineInput = {
    lesson_id: lessonId,
    standard,
    transcript: input?.transcript ?? undefined,
    observerText: input?.observer_text ?? undefined,
    taskSheetText: input?.task_sheet_text ?? undefined,
    lessonPlanText: input?.lesson_plan_text ?? undefined,
    annotation: annotation as EngineInput['annotation'],
    source_weights: opts.source_weights,
    lesson_type: lessonType,
    lesson_type_source: 'manual',
  };

  // V1.9d：表一观察点本次实际具备的证据来源；缺失来源专属的观察点不参与评分
  const essenceAvailable: string[] = [];
  if ((input?.transcript ?? '').trim().length > 0) essenceAvailable.push('av');
  if ((input?.observer_text ?? '').trim().length > 0) essenceAvailable.push('observer');
  if ((input?.task_sheet_text ?? '').trim().length > 0) essenceAvailable.push('task_sheet');
  engineInput.essence_available_sources = essenceAvailable;

  // V1.2/V1.3：先让 LLM 做「通用指标 + 课型专属要点 + 表一内涵观察点」语义评分，再跑多源融合引擎
  const {
    llmScores,
    taskSheetScores,
    lessonPlanScores,
    lessonTypeScores,
    lessonTypeModelName,
    lessonTypeRequested,
    essenceScores,
    essenceRequested,
    essenceModelName,
    aiMeta,
  } = await collectLlmScores(engineInput, opts.useLlm !== false, gradeBand, standard);
  if (llmScores) engineInput.llmScores = llmScores;
  if (taskSheetScores) engineInput.taskSheetScores = taskSheetScores;
  if (lessonPlanScores) engineInput.lessonPlanScores = lessonPlanScores;
  if (lessonTypeScores) engineInput.lesson_type_scores = lessonTypeScores;
  engineInput.lesson_type_llm_enabled = lessonTypeRequested;
  engineInput.lesson_type_model = lessonTypeModelName;
  if (essenceScores) engineInput.essence_scores = essenceScores;
  engineInput.essence_llm_enabled = essenceRequested;
  engineInput.essence_model = essenceModelName;

  let report = analyzeLesson(engineInput);

  const cals: ManualCalibration[] = (opts.calibrations ?? [])
    .filter((c) => c.final_score !== null)
    .map((c) => ({
      dimension_code: c.dimension_code,
      final_score: c.final_score,
      review_note: c.review_note || undefined,
      reviewer: opts.reviewer,
      reviewed_at: new Date().toISOString(),
    }));

  if (cals.length > 0) {
    report = applyCalibration(report, cals, standard);
  }

  // AI 报告评语（仅做解读与建议，不改变任何评分）；失败静默降级
  const wantCommentary = opts.useCommentary ?? opts.useLlm !== false;
  if (wantCommentary && isLlmEnabled()) {
    try {
      report.ai_commentary = await generateCommentary(report, standard);
    } catch (e) {
      console.error('[llm-fallback] 评语生成失败', errMsg(e));
      aiMeta.error = [aiMeta.error, friendlyCommentaryError()].filter(Boolean).join('；') || null;
    }
  }

  report.ai_meta = aiMeta;
  return report;
}

/** 把已构建的报告 upsert 到 reports（每课例一条，覆盖更新），返回落库行 */
export async function saveReport(
  db: DbClient,
  lessonId: string,
  userId: string,
  report: AnalysisReport,
  opts: RunAnalysisOptions = {},
): Promise<SavedReport> {
  const nowIso = new Date().toISOString();
  const needReviewCount = countReviewDimensions(report);
  const isCalibrated = (opts.calibrations ?? []).some((c) => c.final_score !== null);

  const row = {
    lesson_id: lessonId,
    user_id: userId,
    standard_code: report.standard_code,
    standard_version: report.standard_version,
    total_score: report.total_score,
    total_level: report.total_level,
    result: report,
    source_weights: report.source_weights,
    need_review_count: needReviewCount,
    is_calibrated: isCalibrated,
    updated_at: nowIso,
  };

  const { data: existing, error: selErr } = await db
    .from('reports')
    .select('id')
    .eq('lesson_id', lessonId)
    .eq('user_id', userId)
    .maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    const { data, error } = await db
      .from('reports')
      .update(row)
      .eq('id', existing.id)
      .select('id,result,total_score,total_level,need_review_count,is_calibrated,source_weights,created_at,updated_at')
      .single();
    if (error) throw error;
    return data as unknown as SavedReport;
  }

  const { data, error } = await db
    .from('reports')
    .insert(row)
    .select('id,result,total_score,total_level,need_review_count,is_calibrated,source_weights,created_at,updated_at')
    .single();
  if (error) throw error;
  return data as unknown as SavedReport;
}

/** 聚合 → 分析 → upsert 到 reports，返回落库行 */
export async function buildAndSaveReport(
  db: DbClient,
  lessonId: string,
  userId: string,
  opts: RunAnalysisOptions = {},
): Promise<SavedReport> {
  const report = await buildReport(db, lessonId, userId, opts);
  return saveReport(db, lessonId, userId, report, opts);
}

/** 读取课例最新报告 */
export async function getLatestReport(
  db: DbClient,
  lessonId: string,
  userId: string,
): Promise<SavedReport | null> {
  const { data, error } = await db
    .from('reports')
    .select('id,result,total_score,total_level,need_review_count,is_calibrated,source_weights,created_at,updated_at')
    .eq('lesson_id', lessonId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as SavedReport) ?? null;
}
