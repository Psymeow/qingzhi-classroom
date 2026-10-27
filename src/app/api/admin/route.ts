import { NextRequest, NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth/server';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';

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

const DEFAULT_LIMIT = 500;
// 与 0009 迁移里 platform_lessons 的 least(..., 1000) 保持一致：
// 上限不一致会造成「请求 2000 条、实际只给 1000 条」的静默截断。
const MAX_LIMIT = 1000;

// 课例筛选枚举白名单，与 0009 函数体内判定一致
const LESSON_STATUS_WHITELIST = ['draft', 'analyzed', 'reviewed'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 白名单校验：只接受 1..MAX_LIMIT 的纯数字；其他输入一律报错，
// 不静默退回默认值——静默处理会让「限 50 条」变成「看全部」，是善研踩过的坑。
function parseLimit(raw: string | null): number | { error: string } {
  const invalid = { error: `limit 必须是 1-${MAX_LIMIT} 之间的整数` };
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const s = raw.trim();
  if (!/^\d{1,4}$/.test(s)) return invalid;
  const n = Number(s);
  if (n < 1 || n > MAX_LIMIT) return invalid;
  return n;
}

/** 校验 YYYY-MM-DD；顺便拒掉 2026-02-30 这类会溢出的日期 */
function parseDateParam(raw: string | null, name: string): string | null | { error: string } {
  if (raw === null || raw.trim() === '') return null;
  const v = raw.trim();
  if (!DATE_RE.test(v)) return { error: `${name} 必须是 YYYY-MM-DD 格式` };
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    return { error: `${name} 不是有效日期` };
  }
  return v;
}

interface LessonFilters {
  limit: number;
  status: string | null;
  from: string | null;
  to: string | null;
  hasReport: boolean | null;
}

// 课例筛选：全部可选，非法值一律 400 并说明原因。
// 返回 {error} 表示校验失败，调用方直接把 error 转成响应。
function parseFilters(params: URLSearchParams): LessonFilters | { error: string } {
  const limit = parseLimit(params.get('limit'));
  if (typeof limit !== 'number') return { error: limit.error };

  let status: string | null = null;
  const statusRaw = params.get('lesson_status')?.trim();
  if (statusRaw) {
    if (!(LESSON_STATUS_WHITELIST as readonly string[]).includes(statusRaw)) {
      return { error: `lesson_status 必须是 ${LESSON_STATUS_WHITELIST.join(' / ')} 之一` };
    }
    status = statusRaw;
  }

  // 注意：typeof null === 'object'，必须先判空，否则 null 会被当成 error 传出去
  const from = parseDateParam(params.get('lesson_from'), 'lesson_from');
  if (from !== null && typeof from === 'object') return from;
  const to = parseDateParam(params.get('lesson_to'), 'lesson_to');
  if (to !== null && typeof to === 'object') return to;
  if (from && to && from > to) return { error: 'lesson_from 不能晚于 lesson_to' };

  let hasReport: boolean | null = null;
  const hrRaw = params.get('lesson_has_report')?.trim().toLowerCase();
  if (hrRaw) {
    if (hrRaw !== 'true' && hrRaw !== 'false') {
      return { error: 'lesson_has_report 必须是 true 或 false' };
    }
    hasReport = hrRaw === 'true';
  }

  return { limit, status, from, to, hasReport };
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requirePlatformAdmin(req);
    if (!guard.ok) return guard.response;
    const { db } = guard;

    // 枚举与格式白名单：非法值直接 400 并说明原因，不静默退化成「无筛选」
    const filters = parseFilters(req.nextUrl.searchParams);
    if ('error' in filters) {
      return NextResponse.json({ error: filters.error }, { status: 400 });
    }

    // 只在真的带了筛选条件时才追加参数：0009 迁移未跑时初始加载仍可用，
    // 筛选动作会因函数签名不匹配降级并在 degraded 里如实显示，不会整页 500。
    const lessonArgs: Record<string, unknown> = { p_limit: filters.limit };
    if (filters.status) lessonArgs.p_status = filters.status;
    if (filters.from) lessonArgs.p_from = filters.from;
    if (filters.to) lessonArgs.p_to = filters.to;
    if (filters.hasReport !== null) lessonArgs.p_has_report = filters.hasReport;

    const settled = await Promise.allSettled([
      db.rpc('platform_overview'),
      db.rpc('platform_orgs'),
      db.rpc('platform_users'),
      db.rpc('platform_lessons', lessonArgs),
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
