import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { runConsistency } from '@/lib/analysis/consistency';
import { gradeBandOf } from '@/lib/evaluation/lesson-type-detect';
import { resolveStandard } from '@/lib/evaluation/standard-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 稳定性自检：对同一份材料重复 N 轮 AI 评分，比较各指标波动。
const schema = z
  .object({
    runs: z.number().int().min(1).max(5).optional(),
    kind: z.enum(['transcript', 'observer']).optional(),
    lesson_type: z.string().max(32).nullable().optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const parsed = schema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 });
    }

    const [inputRes, lessonRes] = await Promise.all([
      db
        .from('ai_analysis_inputs')
        .select('transcript,observer_text')
        .eq('lesson_id', id)
        .eq('user_id', user.id)
        .maybeSingle(),
      db
        .from('lessons')
        .select('lesson_type,grade_class,standard_set_id')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    // V1.4：按课例绑定的标准集解析评价标准（为空回落内置种子）
    const standard = await resolveStandard(
      db,
      (lessonRes.data?.standard_set_id as string | null) ?? null,
    );

    const kind = parsed.data.kind ?? 'transcript';
    const text =
      kind === 'observer'
        ? ((inputRes.data?.observer_text as string | null) ?? '')
        : ((inputRes.data?.transcript as string | null) ?? '');
    if (!text.trim()) {
      return NextResponse.json(
        { error: kind === 'observer' ? '该课例暂无观察记录文本' : '该课例暂无转写文稿' },
        { status: 422 },
      );
    }

    const lessonType =
      parsed.data.lesson_type ?? ((lessonRes.data?.lesson_type as string | null) ?? null);

    const report = await runConsistency({
      lesson_id: id,
      text,
      kind,
      lesson_type: lessonType,
      grade_band: gradeBandOf((lessonRes.data?.grade_class as string | null) ?? null),
      runs: parsed.data.runs,
      standard,
    });
    return NextResponse.json({ consistency: report });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e instanceof Error ? e.message : '稳定性自检失败';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
