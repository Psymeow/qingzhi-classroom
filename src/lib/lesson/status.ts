import type { DbClient } from '@/lib/auth/server';

/**
 * 用 reports 是否存在纠正课例状态。
 *
 * 背景（V1.20 fix）：saveReport 只写 reports 表，从不回写 lessons.status，
 * 导致已经生成过报告的课例在「我的课例」列表、机构页统计里仍显示「待分析」。
 * 这里做一次读侧纠正，历史数据也能立刻显示正确；写侧（saveReport）同时补上状态推进。
 *
 * 规则：已有报告 → analyzed；手工置为 reviewed 的不降级；无报告保持原状。
 */
export async function deriveAnalyzedStatus<T extends { id: string; status?: string | null }>(
  db: DbClient,
  lessons: T[],
): Promise<T[]> {
  if (lessons.length === 0) return lessons;
  const candidateIds = lessons.filter((l) => l.status !== 'reviewed').map((l) => l.id);
  if (candidateIds.length === 0) return lessons;

  const { data, error } = await db.from('reports').select('lesson_id').in('lesson_id', candidateIds);
  // 读不到报告表就按原状态展示，不能因为一次纠正查询失败影响列表本身
  if (error) return lessons;

  const analyzed = new Set(
    ((data ?? []) as { lesson_id: string }[]).map((r) => r.lesson_id),
  );
  return lessons.map((l) => {
    if (l.status === 'reviewed' || !analyzed.has(l.id)) return l;
    return { ...l, status: 'analyzed' } as T;
  });
}
