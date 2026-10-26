import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { loadDigests } from '@/lib/research/load';
import { buildCompare } from '@/lib/research/compare';
import { fallbackInsight, generateResearchInsight } from '@/lib/llm/research-insight';
import { LlmError, isLlmEnabled } from '@/lib/llm/deepseek';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 一次跨课例洞察是单次长 LLM 调用（约 20-40s）
export const maxDuration = 60;

const bodySchema = z.object({
  lesson_ids: z.array(z.string().min(1)).min(2).max(6),
  /** true 时只用规则引擎，不调模型（用户手动选择「不用 AI」） */
  rules_only: z.boolean().optional(),
});

/**
 * 教研中心 · 跨课例 AI 教研洞察
 * POST { lesson_ids: string[] } → { insight, degraded, reason? }
 * 模型不可用/超时时自动降级到规则引擎，保证页面永远有结果。
 */
export async function POST(req: NextRequest) {
  try {
    const { user, db } = await authenticate(req);
    const body = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: '请选择 2-6 节课例后再生成洞察' }, { status: 400 });
    }
    const ids = parsed.data.lesson_ids;

    const digests = await loadDigests(db, user.id, ids);
    if (digests.length < 2) {
      return NextResponse.json(
        { error: '所选课例中可对比的不足 2 节（需要有分析报告）' },
        { status: 422 },
      );
    }
    const cmp = buildCompare(digests);

    if (parsed.data.rules_only || !isLlmEnabled()) {
      return NextResponse.json({
        insight: fallbackInsight(cmp, digests),
        degraded: true,
        reason: parsed.data.rules_only ? '按你的选择未使用 AI' : '未配置 AI 服务，已用规则引擎生成',
      });
    }

    try {
      const insight = await generateResearchInsight(digests, cmp);
      return NextResponse.json({ insight, degraded: false });
    } catch (e) {
      const reason = e instanceof LlmError ? e.message : 'AI 服务暂时不可用';
      console.warn('[research] AI 洞察失败，降级规则引擎：', reason);
      return NextResponse.json({ insight: fallbackInsight(cmp, digests), degraded: true, reason });
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[research] 洞察生成失败', e);
    return NextResponse.json({ error: '生成教研洞察失败，请稍后重试' }, { status: 500 });
  }
}
