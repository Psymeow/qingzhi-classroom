import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { loadRuns } from '@/lib/analysis/run-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 课例分析运行历史（V1.22）
 * GET /api/lessons/:id/runs
 * → { enabled: true, runs: RunRecordItem[] }        正常
 * → { enabled: false, runs: [] }                    目标库尚未创建 report_runs 表（界面显示「未启用」）
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const result = await loadRuns(db, user.id, id);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[run-history] 读取运行历史失败', e);
    return NextResponse.json({ error: '读取运行历史失败' }, { status: 500 });
  }
}
