import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { loadDigests } from '@/lib/research/load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 教研中心 · 课例池
 * GET /api/research/lessons            返回当前用户全部「已生成报告」的课例摘要
 * GET /api/research/lessons?ids=a,b,c  只返回指定课例（对比页用，保持传入顺序）
 */
export async function GET(req: NextRequest) {
  try {
    const { user, db } = await authenticate(req);
    const idsParam = new URL(req.url).searchParams.get('ids');
    const ids = idsParam
      ? idsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8)
      : undefined;
    const lessons = await loadDigests(db, user.id, ids);
    return NextResponse.json({ lessons });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[research] 课例池读取失败', e);
    return NextResponse.json({ error: '读取课例池失败' }, { status: 500 });
  }
}
