import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';

// 后台数据每次都要现算，且失败不能被缓存（缓存住的失败 = 永久白屏）
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ============================================================
// 平台总控台（只读）
// 仅 platform_admins 白名单内的账号可访问；白名单判定在数据库函数内
// （is_platform_admin），四个 RPC 内部也各自再校验一次。
// 这里不提供任何写操作：总台是观察窗口，不是操作入口。
//
// 连接说明：四个 platform_* 都是 security definer 只读函数，
// 按「监管视角」跨租户聚合，因此走登录态连接调用即可，
// 不需要也不应该换成高权限连接。
//
// 故障策略（重要）：四块统计用 allSettled 独立执行，单块失败只降级，
// 不把整页打成 500。降级块通过 degraded 返回，页面顶部明示「部分统计暂不可用」。
// 例外：FORBIDDEN 不降级——那是权限系统本身的问题，必须如实 403。
// ============================================================

const BLOCKS = ['stats', 'orgs', 'users', 'lessons'] as const;
type BlockKey = (typeof BLOCKS)[number];

const FALLBACK: Record<BlockKey, unknown> = {
  stats: {},
  orgs: [],
  users: [],
  lessons: [],
};

function errText(e: unknown): string {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  const msg = (e as { message?: string }).message;
  return msg || '未知错误';
}

export async function GET(req: NextRequest) {
  try {
    const { db } = await authenticate(req);

    const { data: allowed, error: guardErr } = await db.rpc('is_platform_admin');
    if (guardErr) {
      console.error('[admin] is_platform_admin 失败', guardErr.message);
      return NextResponse.json({ error: `权限校验失败：${guardErr.message}` }, { status: 500 });
    }
    if (!allowed) return NextResponse.json({ error: '没有平台管理权限' }, { status: 403 });

    const settled = await Promise.allSettled([
      db.rpc('platform_overview'),
      db.rpc('platform_orgs'),
      db.rpc('platform_users'),
      db.rpc('platform_lessons', { p_limit: 500 }),
    ]);

    const data: Record<BlockKey, unknown> = { ...FALLBACK };
    const degraded: { key: BlockKey; message: string }[] = [];

    settled.forEach((r, i) => {
      const key = BLOCKS[i];
      if (r.status === 'fulfilled') {
        const res = r.value as { data?: unknown; error?: { message?: string } | null };
        if (res.error) {
          // RPC 返回的错误体（PostgREST 不抛异常时走这里）
          const msg = res.error.message || errText(res.error);
          if (msg.includes('FORBIDDEN')) throw new Error('FORBIDDEN');
          console.error(`[admin] ${key} 失败`, msg);
          degraded.push({ key, message: msg });
          return;
        }
        data[key] = res.data ?? FALLBACK[key];
        return;
      }
      const msg = errText(r.reason);
      if (msg.includes('FORBIDDEN')) throw new Error('FORBIDDEN');
      console.error(`[admin] ${key} 失败`, msg);
      degraded.push({ key, message: msg });
    });

    return NextResponse.json(
      {
        stats: data.stats,
        orgs: data.orgs,
        users: data.users,
        lessons: data.lessons,
        degraded,
        fetched_at: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof Error && e.message === 'FORBIDDEN') {
      return NextResponse.json({ error: '没有平台管理权限' }, { status: 403 });
    }
    console.error('[admin] 加载平台总览失败', errText(e));
    return NextResponse.json({ error: `加载平台总览失败：${errText(e)}` }, { status: 500 });
  }
}
