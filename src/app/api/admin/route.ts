import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';

// ============================================================
// 平台总控台（只读）
// 仅 platform_admins 白名单内的账号可访问；白名单判定在数据库函数内
// （is_platform_admin），四个 RPC 内部也各自再校验一次。
// 这里不提供任何写操作：总台是观察窗口，不是操作入口。
// ============================================================

export async function GET(req: NextRequest) {
  try {
    const { db } = await authenticate(req);

    const { data: allowed, error: guardErr } = await db.rpc('is_platform_admin');
    if (guardErr) return NextResponse.json({ error: guardErr.message }, { status: 500 });
    if (!allowed) return NextResponse.json({ error: '没有平台管理权限' }, { status: 403 });

    const [stats, orgs, users, lessons] = await Promise.all([
      db.rpc('platform_overview'),
      db.rpc('platform_orgs'),
      db.rpc('platform_users'),
      db.rpc('platform_lessons', { p_limit: 500 }),
    ]);
    const failed = [stats, orgs, users, lessons].find((r) => r.error);
    if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

    return NextResponse.json({
      stats: stats.data ?? {},
      orgs: orgs.data ?? [],
      users: users.data ?? [],
      lessons: lessons.data ?? [],
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '加载平台总览失败' }, { status: 500 });
  }
}
