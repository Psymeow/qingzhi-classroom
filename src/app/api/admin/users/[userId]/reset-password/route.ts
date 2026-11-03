import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { z } from 'zod';
import { AuthError } from '@/lib/auth/server';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { getSupabaseClient, getSupabaseServiceRoleKey } from '@/storage/database/supabase-client';

// ============================================================
// 平台管理员代重置用户密码（helpdesk 模式）
//
// 为什么不做成「任何人输入账号就能重置」：那等于放弃身份验证，等于后门。
// 这里要求调用方先过 requirePlatformAdmin（登录 + platform_admins 白名单），
// 再用 service_role 改目标账号密码——与邮件重置并行的第二条恢复通道，
// 用于邮箱收不到信、账号被锁等场景。
//
// 密码只在本次响应回传一次，不入库、不写日志，由管理员线下转告用户。
// ============================================================

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resetSchema = z.object({
  // 留空则服务端生成；传了就用传入值（便于管理员设一个可口头告知的密码）
  password: z.string().min(8, '新密码至少 8 位').max(128, '新密码过长').optional(),
});

/** 20 位随机密码，避开易混淆字符（0/O、1/l/I），用 randomInt 避免取模偏置 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 20; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const guard = await requirePlatformAdmin(req);
    if (!guard.ok) return guard.response;

    const { userId } = await params;
    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json({ error: '用户 ID 不合法' }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = resetSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }

    // 改他人密码必须 service_role；缺 key 时如实报 503，
    // 不能静默降级成 anon（那样会被 GoTrue 401 拒绝，错误信息反而误导排查方向）
    const serviceRoleKey = await getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
      return NextResponse.json({ error: '服务端未配置 service_role 密钥，无法代改密码' }, { status: 503 });
    }

    const admin = await getSupabaseClient();
    const password = parsed.data.password ?? generatePassword();

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) {
      const msg = error.message || '';
      if (/not.?found|does not exist/i.test(msg)) {
        return NextResponse.json({ error: '用户不存在或已被删除' }, { status: 404 });
      }
      console.error('[admin/reset-password] updateUserById 失败', msg);
      return NextResponse.json({ error: `重置失败：${msg}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, password, generated: !parsed.data.password });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[admin/reset-password] 请求失败', e);
    return NextResponse.json({ error: '重置密码请求失败' }, { status: 500 });
  }
}
