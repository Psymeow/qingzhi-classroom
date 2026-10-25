import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import {
  buildReport,
  saveReport,
  getLatestReport,
  reportHasAnySource,
} from '@/lib/analysis/runner';
import { SOURCE_LABEL } from '@/lib/evaluation/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 平台函数时长上限：单次 AI 请求 45s、AI 阶段总时限 55s，留出规则引擎降级与落库时间。
export const maxDuration = 60;

const SOURCE_KEYS = Object.keys(SOURCE_LABEL) as Array<keyof typeof SOURCE_LABEL>;

const calibrationSchema = z.object({
  dimension_code: z.string().min(1).max(16),
  final_score: z.number().min(0).max(10),
  review_note: z.string().max(2000).optional(),
});

// 运行分析：权重调节（0-1，服务端归一化）+ 人工校准。
const runSchema = z
  .object({
    source_weights: z
      .record(z.string(), z.number().min(0).max(1))
      .optional(),
    calibrations: z.array(calibrationSchema).max(20).optional(),
    /** 是否启用 AI（DeepSeek）语义评分与报告评语；默认启用，模型不可用时自动降级 */
    use_llm: z.boolean().optional(),
    /** 运行时指定/覆盖课型（new/review/comment/practice/topic，兼容旧枚举）；不传则用课例已保存课型 */
    lesson_type: z.string().max(32).nullable().optional(),
  })
  .strict();

// 读取课例最近一次分析报告。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const report = await getLatestReport(db, id, user.id);
    return NextResponse.json({ report: report ?? null });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取分析报告失败' }, { status: 500 });
  }
}

// 运行多源融合分析并持久化（每课例一条，覆盖更新）。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = runSchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: '分析参数不合法' }, { status: 400 });
    }

    // 仅接受已知来源键，权重在引擎内按有效来源归一化。
    let source_weights: Record<string, number> | undefined;
    if (parsed.data.source_weights) {
      source_weights = {};
      for (const key of SOURCE_KEYS) {
        const v = parsed.data.source_weights[key];
        if (typeof v === 'number') source_weights[key] = v;
      }
    }

    const runOpts = {
      source_weights,
      calibrations: parsed.data.calibrations,
      reviewer: user.displayName ?? user.email,
      useLlm: parsed.data.use_llm,
      lesson_type: parsed.data.lesson_type,
    };

    // 先在内存中预览，确认至少有一个有效数据源再落库，避免写入全空报告。
    const preview = await buildReport(db, id, user.id, runOpts);
    if (!reportHasAnySource(preview)) {
      return NextResponse.json(
        { error: '暂无可分析的数据：请先导入转写文稿或完成人工标注' },
        { status: 422 },
      );
    }

    // 复用预览结果落库，避免重复调用模型
    const saved = await saveReport(db, id, user.id, preview, runOpts);
    return NextResponse.json({ report: saved });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '运行分析失败' }, { status: 500 });
  }
}
