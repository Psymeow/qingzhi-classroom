import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, userClient, AuthError } from '@/lib/auth/server';
import { isPlatformAdmin } from '@/lib/auth/platform-admin';

const profileSchema = z.object({
  display_name: z.string().trim().max(128).nullable().optional(),
  role_title: z.string().trim().max(64).nullable().optional(),
  organization: z.string().trim().max(255).nullable().optional(),
});

// GET /api/me — 当前登录用户 + profile（无 profile 时自动建一条占位，受 RLS 允许本人 upsert）
// platform_admin：是否在平台白名单内，用于决定导航里是否显示「平台总控」入口。
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const db = await userClient(req);

    const platformAdmin = await isPlatformAdmin(db);

    let { data: profile } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (!profile) {
      const { data: up, error: insErr } = await db
        .from('profiles')
        .upsert(
          { id: user.id, display_name: user.displayName ?? null, updated_at: new Date().toISOString() },
          { onConflict: 'id' },
        )
        .select('*')
        .maybeSingle();
      if (insErr) {
        // RLS 拒绝等情况下不致命：仍返回基础用户
        return NextResponse.json({
          user: { id: user.id, email: user.email, displayName: user.displayName },
          profile: null,
          platform_admin: platformAdmin,
        });
      }
      profile = up;
    }
    return NextResponse.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      profile,
      platform_admin: platformAdmin,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取用户信息失败' }, { status: 500 });
  }
}

// PATCH /api/me — 更新本人 profile
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);
    const parsed = profileSchema.safeParse(body ?? {});
    if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 });
    const db = await userClient(req);
    const { data, error } = await db
      .from('profiles')
      .upsert({ id: user.id, ...parsed.data, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ profile: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '保存资料失败' }, { status: 500 });
  }
}
