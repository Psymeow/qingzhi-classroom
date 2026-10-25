import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';

// ============================================================
// 机构成员管理（仅 admin 可调用）
// PATCH ：调整成员角色（admin / leader / teacher）
// DELETE：软移除成员（status=removed），保留其历史课例
// 约束：不能修改自己、不能移除机构创建者（owner）
// ============================================================

const patchSchema = z.object({
  user_id: z.string().min(1),
  role: z.enum(['admin', 'leader', 'teacher']),
});

interface MyMember {
  org_id: string;
  role: string;
}

async function requireAdmin(
  db: Awaited<ReturnType<typeof authenticate>>['db'],
  userId: string,
): Promise<{ orgId: string } | { error: NextResponse }> {
  const { data: mine } = await db
    .from('org_members')
    .select('org_id,role,status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  const row = mine as MyMember | null;
  if (!row) return { error: NextResponse.json({ error: '你还没有归属机构' }, { status: 400 }) };
  if (row.role !== 'admin') return { error: NextResponse.json({ error: '只有机构管理员可以管理成员' }, { status: 403 }) };
  return { orgId: row.org_id };
}

export async function PATCH(req: NextRequest) {
  try {
    const { user, db } = await authenticate(req);
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }
    const guard = await requireAdmin(db, user.id);
    if ('error' in guard) return guard.error;

    if (parsed.data.user_id === user.id) {
      return NextResponse.json({ error: '不能修改自己的角色，请联系其他管理员' }, { status: 400 });
    }

    const { error } = await db
      .from('org_members')
      .update({ role: parsed.data.role, updated_at: new Date().toISOString() })
      .eq('org_id', guard.orgId)
      .eq('user_id', parsed.data.user_id)
      .eq('status', 'active');
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '调整成员角色失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { user, db } = await authenticate(req);
    const target = new URL(req.url).searchParams.get('user_id');
    if (!target) return NextResponse.json({ error: '缺少 user_id' }, { status: 400 });

    const guard = await requireAdmin(db, user.id);
    if ('error' in guard) return guard.error;
    if (target === user.id) return NextResponse.json({ error: '不能移除自己' }, { status: 400 });

    const { data: org } = await db
      .from('organizations')
      .select('owner_id')
      .eq('id', guard.orgId)
      .maybeSingle();
    if ((org as { owner_id?: string } | null)?.owner_id === target) {
      return NextResponse.json({ error: '不能移除机构创建者' }, { status: 400 });
    }

    const { error } = await db
      .from('org_members')
      .update({ status: 'removed', updated_at: new Date().toISOString() })
      .eq('org_id', guard.orgId)
      .eq('user_id', target);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '移除成员失败' }, { status: 500 });
  }
}
