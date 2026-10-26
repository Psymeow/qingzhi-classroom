import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';

// ============================================================
// 后台健康自检：GET /api/admin/health/schema
// 部署后的第一条命令。检查后台与核心链路依赖的表 / 列 / 函数是否存在。
// 全绿 = 「迁移先于代码」这条纪律被执行了；有红项 = 说明有迁移没跑。
// 只读，仅平台白名单可访问；探针逻辑在数据库函数 platform_schema_check 内
// （0008 迁移），函数体内再次校验白名单。
// ============================================================

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SchemaCheckItem = {
  name: string;
  ok: boolean;
  detail: string;
};

export async function GET(req: NextRequest) {
  try {
    const { db } = await authenticate(req);

    const { data: allowed, error: guardErr } = await db.rpc('is_platform_admin');
    if (guardErr) {
      return NextResponse.json({ error: `权限校验失败：${guardErr.message}` }, { status: 500 });
    }
    if (!allowed) return NextResponse.json({ error: '没有平台管理权限' }, { status: 403 });

    const { data, error } = await db.rpc('platform_schema_check');
    if (error) {
      const msg = error.message || '健康自检失败';
      // 探针函数本身不存在（0008 迁移没跑）时给出可执行指引，而不是一个裸 500
      if (/does not exist|schema cache|Could not find the function/i.test(msg)) {
        return NextResponse.json(
          {
            ok: false,
            passed: 0,
            total: 0,
            items: [],
            error: '健康自检函数不存在，请先执行 migrations/0008_platform_health.sql',
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const items: SchemaCheckItem[] = Array.isArray(data) ? data : [];
    const passed = items.filter((i) => i.ok).length;
    const failed = items.filter((i) => !i.ok);

    return NextResponse.json(
      {
        ok: failed.length === 0,
        passed,
        total: items.length,
        items,
        fetched_at: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[admin/health] 自检失败', e);
    return NextResponse.json({ error: '健康自检请求失败' }, { status: 500 });
  }
}
