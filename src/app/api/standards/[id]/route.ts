import { NextRequest, NextResponse } from 'next/server';
import { userClient, AuthError } from '@/lib/auth/server';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const db = await userClient(req);
    const { data, error } = await db.from('standard_sets').select('*').eq('id', id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: '标准不存在或无权访问' }, { status: 404 });
    return NextResponse.json({ standard: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取评价标准失败' }, { status: 500 });
  }
}
