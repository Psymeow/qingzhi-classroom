import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { deriveAnalyzedStatus } from '@/lib/lesson/status';

// ============================================================
// 机构（组织）基础接口 · V1.11
// GET  ：我的机构 + 成员 + 概览统计（未加入时 org=null）
// POST ：创建机构并成为超级管理员（admin/owner）
// 权限：读取靠 RLS（同机构成员可读成员名单），写操作在应用层校验角色
// 注意：建机构必须走 create_organization RPC——org_members 刻意不开放 insert 策略，
//      客户端直连写成员会被 RLS 拒绝（V1.15 修复）。
// ============================================================

const createSchema = z.object({
  name: z.string().trim().min(2, '机构名称至少 2 个字').max(80),
});

export async function GET(req: NextRequest) {
  try {
    const { user, db } = await authenticate(req);

    const { data: mine, error: mineErr } = await db
      .from('org_members')
      .select('org_id, role, status, display_name')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    if (mineErr) return NextResponse.json({ error: mineErr.message }, { status: 500 });
    if (!mine) return NextResponse.json({ org: null, members: [], stats: null });

    const { data: org, error: orgErr } = await db
      .from('organizations')
      .select('id,name,owner_id,created_at,invite_code')
      .eq('id', mine.org_id)
      .maybeSingle();
    if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });
    if (!org) return NextResponse.json({ org: null, members: [], stats: null });

    const [{ data: members }, { data: lessons }] = await Promise.all([
      db
        .from('org_members')
        .select('user_id,display_name,role,status,created_at')
        .eq('org_id', mine.org_id)
        .eq('status', 'active')
        .order('created_at', { ascending: true }),
      db
        .from('lessons')
        .select('id,title,teacher_name,grade_class,status,visibility,updated_at')
        .eq('org_id', mine.org_id)
        .order('updated_at', { ascending: false })
        .limit(30),
    ]);

    const list = await deriveAnalyzedStatus(db, lessons ?? []);
    const analyzed = list.filter((l) => l.status === 'analyzed' || l.status === 'reviewed').length;

    return NextResponse.json({
      org: {
        id: org.id,
        name: org.name,
        role: mine.role,
        is_owner: org.owner_id === user.id,
        // 邀请码只对管理员可见，避免普通教师外传
        invite_code: mine.role === 'admin' ? org.invite_code : null,
      },
      members: members ?? [],
      lessons: list,
      stats: {
        lessons: list.length,
        analyzed,
        pending: list.length - analyzed,
      },
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取机构信息失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticate(req);
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }

    // 建机构 + 写 admin 成员在数据库函数内原子完成：
    // org_members 不开放 insert 策略，客户端直写必然被 RLS 拒绝，且会留下 0 成员的孤儿机构。
    const { data, error } = await db.rpc('create_organization', { p_name: parsed.data.name });
    if (error) {
      const msg = /ALREADY_IN_ORG/.test(error.message)
        ? '你已在一个机构中，一个账号只能归属一个机构'
        : /NAME_INVALID/.test(error.message)
          ? '机构名称需为 2~80 个字'
          : /UNAUTHENTICATED/.test(error.message)
            ? '登录已失效，请重新登录'
            : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    const created = (Array.isArray(data) ? data[0] : data) as
      | { org_id: string; name: string; invite_code: string }
      | null
      | undefined;
    if (!created) return NextResponse.json({ error: '创建机构失败' }, { status: 400 });

    return NextResponse.json(
      { org: { id: created.org_id, name: created.name, role: 'admin', invite_code: created.invite_code } },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '创建机构失败' }, { status: 500 });
  }
}
