import 'server-only';
import type { DbClient } from '@/lib/auth/server';
import type { AnalysisReport, DataSource } from '@/lib/evaluation/types';
import { buildRunSummary, type RunRecordItem } from './run-summary';

// ============================================================
// 运行历史 · 落库与读取（V1.22）
// 关键约束：report_runs 表可能尚未在目标库创建（DDL 由运维执行一次）。
// 因此这里所有数据库操作都是「尽力而为」：
//   * 表不存在 → 不写、不报错，返回 enabled=false，界面显示「未启用」而不是崩掉；
//   * 写入失败 → 只打日志，绝不影响分析本身的结果返回。
// ============================================================

/** 评分 prompt 指纹：修改 llm-scorer / 报告评语等提示词后必须手动升级，
 *  用于解释「同一份材料为何两次运行分数不同」。 */
export const SCORING_PROMPT_VERSION = 'v5.1-2026.10';

interface RecordRunParams {
  lessonId: string;
  userId: string;
  report: AnalysisReport;
  useLlm: boolean;
  durationMs?: number | null;
  trigger?: 'manual' | 'rerun' | 'calibrate';
  sourceWeights?: Record<DataSource, number> | null;
}

/** PostgREST / PostgreSQL 的「表不存在」错误识别（含 schema cache 未刷新） */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205') return true;
  return /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
}

/**
 * 追加一条运行记录。永不抛错。
 * @returns enabled=false 表示该库尚未创建 report_runs 表
 */
export async function recordRun(
  db: DbClient,
  params: RecordRunParams,
): Promise<{ enabled: boolean; saved: boolean }> {
  const { lessonId, userId, report } = params;
  try {
    const summary = buildRunSummary(report);

    const { count, error: countErr } = await db
      .from('report_runs')
      .select('id', { count: 'exact', head: true })
      .eq('lesson_id', lessonId)
      .eq('user_id', userId);
    if (countErr) {
      if (isMissingTable(countErr)) return { enabled: false, saved: false };
      throw countErr;
    }

    const row = {
      lesson_id: lessonId,
      user_id: userId,
      run_no: (count ?? 0) + 1,
      total_score: summary.total_score,
      total_level: summary.total_level || null,
      standard_code: report.standard_code,
      standard_version: report.standard_version,
      model: report.ai_meta?.model ?? null,
      prompt_version: SCORING_PROMPT_VERSION,
      use_llm: params.useLlm,
      ai_used: report.ai_meta?.used === true,
      ai_error: report.ai_meta?.error ?? null,
      duration_ms: params.durationMs ?? null,
      trigger: params.trigger ?? 'manual',
      source_weights: params.sourceWeights ?? report.source_weights ?? null,
      summary,
    };

    const { error } = await db.from('report_runs').insert(row);
    if (error) {
      if (isMissingTable(error)) return { enabled: false, saved: false };
      throw error;
    }
    return { enabled: true, saved: true };
  } catch (e) {
    // 历史留痕失败不能影响分析结果
    console.warn('[run-history] 运行记录写入失败（不影响报告）：', e);
    return { enabled: false, saved: false };
  }
}

/** 读取课例的运行历史（新→旧）。表不存在时 enabled=false。 */
export async function loadRuns(
  db: DbClient,
  userId: string,
  lessonId: string,
  limit = 20,
): Promise<{ enabled: boolean; runs: RunRecordItem[] }> {
  const { data, error } = await db
    .from('report_runs')
    .select(
      'id,run_no,total_score,total_level,model,prompt_version,use_llm,ai_used,ai_error,duration_ms,trigger,created_at,summary',
    )
    .eq('lesson_id', lessonId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTable(error)) return { enabled: false, runs: [] };
    throw error;
  }

  const runs = ((data ?? []) as unknown as RunRecordItem[]).map((r) => ({
    ...r,
    total_score: Number(r.total_score ?? 0),
  }));
  return { enabled: true, runs };
}
