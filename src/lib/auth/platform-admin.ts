import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import type { AuthUser, DbClient } from '@/lib/auth/server';

// ============================================================
// 平台白名单守卫（唯一入口）
//
// 为什么要收敛：/api/admin、/api/admin/health/schema、/api/me 三处原本各写一遍
// authenticate + rpc('is_platform_admin')，401/403/500 的分支也各写一遍。
// 后台一旦开放写操作，任何新接口漏抄这一段就是一条越权口子。
// 现在所有平台侧接口只允许从 requirePlatformAdmin 取 db，不再自己判权限。
//
// 三层防线（从外到内）：
//   1. 本文件 requirePlatformAdmin → 未登录 401，非白名单 403，判定失败 500
//   2. platform_* / platform_schema_check 等 security definer 函数体内再校验一次
//   3. 表级 RLS（业务读写走登录态连接，RLS 真实生效）
//
// 注意：平台身份与机构身份完全独立。这里判的是 platform_admins 白名单，
// 不是 org_members.role === 'admin'——机构管理员不具备任何平台视角。
// ============================================================

/** 只查白名单，不做响应处理；供 /api/me 这类只需知道「是不是」的接口使用 */
export async function isPlatformAdmin(db: DbClient): Promise<boolean> {
  const { data } = await db.rpc('is_platform_admin');
  return data === true;
}

export interface PlatformAdminGrant {
  ok: true;
  user: AuthUser;
  db: DbClient;
}

export interface PlatformAdminReject {
  ok: false;
  response: NextResponse;
}

export type PlatformAdminResult = PlatformAdminGrant | PlatformAdminReject;

/**
 * 平台接口统一守卫。
 * 用法：
 *   const guard = await requirePlatformAdmin(req);
 *   if (!guard.ok) return guard.response;
 *   const { db } = guard;
 */
export async function requirePlatformAdmin(req: NextRequest): Promise<PlatformAdminResult> {
  let user: AuthUser;
  let db: DbClient;
  try {
    ({ user, db } = await authenticate(req));
  } catch (e) {
    if (e instanceof AuthError) {
      return { ok: false, response: NextResponse.json({ error: e.message }, { status: e.status }) };
    }
    throw e; // 未知故障交给调用方转 500，不要在这里伪装成权限问题
  }

  const { data: allowed, error } = await db.rpc('is_platform_admin');
  if (error) {
    // 权限系统自身故障必须如实暴露，不能降级成 403（否则运营会去查白名单而不是查库）
    console.error('[guard:platform-admin] is_platform_admin 失败', error.message);
    return {
      ok: false,
      response: NextResponse.json({ error: `权限校验失败：${error.message}` }, { status: 500 }),
    };
  }
  if (allowed !== true) {
    return { ok: false, response: NextResponse.json({ error: '没有平台管理权限' }, { status: 403 }) };
  }

  return { ok: true, user, db };
}
