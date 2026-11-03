import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { getLatestReport } from '@/lib/analysis/runner';
import { generateEvidenceReadings } from '@/lib/llm/evidence-reading';
import { isLlmEnabled, LlmError } from '@/lib/llm/deepseek';
import { resolveStandard } from '@/lib/evaluation/standard-registry';
import type { AnalysisReport } from '@/lib/evaluation/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 逐条证据解读是单次长 LLM 调用，生成后立即落库。
export const maxDuration = 60;

/**
 * 按需生成各维度证据的逐条解读（这反映了什么 / 为什么支撑这个分）并写回报告。
 * 不在分析阶段自动生成，避免拖慢「运行分析」；旧报告首次查看时补生成一次，
 * 之后随 reports.result 持久化，不再重复调用模型。
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const saved = await getLatestReport(db, id, user.id);
    if (!saved) {
      return NextResponse.json({ error: '尚未生成分析报告' }, { status: 404 });
    }
    const report = saved.result as AnalysisReport;
    if (!report?.dimension_results?.length) {
      return NextResponse.json({ error: '报告暂无五维结果' }, { status: 422 });
    }
    if (!isLlmEnabled()) {
      return NextResponse.json({ error: 'AI 服务未配置，无法生成解读' }, { status: 503 });
    }

    // 与分析阶段同一口径：按课例绑定的标准集解析评价标准（为空时回落内置种子）
    const { data: lessonRow, error: lErr } = await db
      .from('lessons')
      .select('standard_set_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (lErr) throw lErr;
    const standard = await resolveStandard(
      db,
      (lessonRow as { standard_set_id?: string | null } | null)?.standard_set_id ?? null,
    );

    const readings = await generateEvidenceReadings(report, standard);

    // 写回报告：与运行分析共用同一条 reports 行，只补 result 上的解读字段
    const merged: AnalysisReport = { ...report, evidence_readings: readings };
    const { error: upErr } = await db
      .from('reports')
      .update({ result: merged, updated_at: new Date().toISOString() })
      .eq('lesson_id', id)
      .eq('user_id', user.id);
    if (upErr) throw upErr;

    return NextResponse.json({ readings });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof LlmError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error('[analysis] 证据解读生成失败', e);
    return NextResponse.json({ error: '生成证据解读失败' }, { status: 500 });
  }
}
