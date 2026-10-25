import 'server-only';
import type { DbClient } from '@/lib/auth/server';

/**
 * 校验课例归属当前用户。RLS 已做隔离，这里再显式 user_id 双条件，
 * 未命中统一按 404 处理（不泄露资源是否存在）。
 */
export async function ensureLessonOwned(db: DbClient, userId: string, lessonId: string): Promise<boolean> {
  const { data, error } = await db
    .from('lessons')
    .select('id')
    .eq('id', lessonId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
