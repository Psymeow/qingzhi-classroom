import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';

// 用邀请码加入机构。真正的校验在数据库函数 join_org_by_invite 内完成，
// 客户端无法自行插入 org_members（该表不开放 insert 策略），避免猜 org_id 直接入组。

const schema = z.object({
  code: z.string().trim().min(4, '邀请码不正确').max(16, '邀请码不正确'),
});

export async function POST(req: NextRequest) {
  try {
    const { db } = await authenticate(req);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }

    const { data, error } = await db.rpc('join_org_by_invite', { p_code: parsed.data.code });
    if (error) {
      const msg = /INVITE_CODE_INVALID/.test(error.message)
        ? '邀请码无效，请向机构管理员确认'
        : /ALREADY_IN_ORG/.test(error.message)
          ? '你已在一个机构中，一个账号只能归属一个机构'
          : error.message;
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    return NextResponse.json({ ok: true, member: Array.isArray(data) ? data[0] ?? null : data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '加入机构失败' }, { status: 500 });
  }
}
