import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface AuthUser {
  id: string;
  email?: string;
  displayName?: string;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

// client.schema('public') 返回的 Postgrest 查询客户端类型
export type DbClient = Awaited<ReturnType<typeof getSupabaseClient>>;

/**
 * 统一鉴权：读取 x-session → 以用户 token 构造客户端 → 调 auth.getUser 强制验签。
 * 任何缺 token / 非法或过期 JWT / 未登录都归一为 AuthError(401)。
 * 返回已通过 RLS 的 public schema 客户端与当前用户。
 */
export async function authenticate(req: NextRequest): Promise<{ user: AuthUser; db: DbClient }> {
  const token = req.headers.get('x-session');
  if (!token) throw new AuthError('请先登录', 401);

  let client;
  try {
    client = await getSupabaseClient(token);
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new AuthError('登录已失效，请重新登录', 401);

    const meta = (data.user.user_metadata ?? {}) as { full_name?: string };
    const user: AuthUser = {
      id: data.user.id,
      email: data.user.email ?? undefined,
      displayName: meta.full_name ?? data.user.email?.split('@')[0],
    };
    return { user, db: client };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    // JWT 解析/校验阶段直接抛异常（如非法 token、密码学校验失败）统一按未认证处理
    throw new AuthError('登录已失效，请重新登录', 401);
  }
}

/** 仅取当前登录用户（保留兼容入口） */
export async function requireUser(req: NextRequest): Promise<AuthUser> {
  const { user } = await authenticate(req);
  return user;
}

/** 仅取已认证客户端（内部同样强制验签） */
export async function userClient(req: NextRequest): Promise<DbClient> {
  const { db } = await authenticate(req);
  return db;
}
