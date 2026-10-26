import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { getLatestReport } from '@/lib/analysis/runner';
import { generateEssenceInterpretations } from '@/lib/llm/essence-commentary';
import { isLlmEnabled, LlmError } from '@/lib/llm/deepseek';
import { resolveStandard } from '@/lib/evaluation/standard-registry';
import type { AnalysisReport } from '@/lib/evaluation/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 内涵解读是单次长 LLM 调用（约 20-50s），生成后立即落库。
export const maxDuration = 60;

/**
 * 按需生成「表一 · 认知与情感内涵观察点」的 AI 解读（依据/为什么/怎么读/怎么提升）
 * 并写回报告。与五维维度解读同款：查看报告时按需生成一次，
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
    if (!report?.essence_eval?.llm_used) {
      return NextResponse.json({ error: '报告暂无内涵观察点评分结果' }, { status: 422 });
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

    const interpretations = await generateEssenceInterpretations(report, standard);

    // 写回报告：与运行分析共用同一条 reports 行，只补 result 上的解读字段
    const merged: AnalysisReport = { ...report, essence_interpretations: interpretations };
    const { error: upErr } = await db
      .from('reports')
      .update({ result: merged, updated_at: new Date().toISOString() })
      .eq('lesson_id', id)
      .eq('user_id', user.id);
    if (upErr) throw upErr;

    return NextResponse.json({ interpretations });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof LlmError) return NextResponse.json({ error: e.message }, { status: 502 });
    console.error('[analysis] 内涵解读生成失败', e);
    return NextResponse.json({ error: '生成内涵解读失败' }, { status: 500 });
  }
}
