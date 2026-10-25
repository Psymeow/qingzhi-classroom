import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { detectLessonType, gradeBandOf } from '@/lib/evaluation/lesson-type-detect';
import {
  LESSON_TYPE_LIST,
  LESSON_TYPE_STATS,
  normalizeLessonType,
} from '@/lib/evaluation/lesson-type-models';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 45;

const detectSchema = z.object({ apply: z.boolean().optional() }).strict();

const setSchema = z.object({ lesson_type: z.string().max(32).nullable() }).strict();

// 读取课例当前课型与可选课型清单（含各课型视角/要点规模）。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const { data } = await db
      .from('lessons')
      .select('lesson_type,grade_class')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    const stored = (data?.lesson_type as string | null | undefined) ?? null;
    return NextResponse.json({
      lesson_type: normalizeLessonType(stored),
      raw_lesson_type: stored,
      grade_band: gradeBandOf(data?.grade_class as string | null | undefined),
      options: LESSON_TYPE_LIST,
      stats: LESSON_TYPE_STATS,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取课型信息失败' }, { status: 500 });
  }
}

// 依据课堂材料自动识别课型；apply=true 时同时写回课例。
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const parsed = detectSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 });
    }

    const [lessonRes, inputRes] = await Promise.all([
      db
        .from('lessons')
        .select('title,subject,grade_class')
        .eq('id', id)
        .eq('user_id', user.id)
        .maybeSingle(),
      db
        .from('ai_analysis_inputs')
        .select('transcript,observer_text')
        .eq('lesson_id', id)
        .eq('user_id', user.id)
        .maybeSingle(),
    ]);

    try {
      const detection = await detectLessonType({
        title: (lessonRes.data?.title as string | null) ?? null,
        subject: (lessonRes.data?.subject as string | null) ?? null,
        grade: (lessonRes.data?.grade_class as string | null) ?? null,
        transcript: (inputRes.data?.transcript as string | null) ?? null,
        observerText: (inputRes.data?.observer_text as string | null) ?? null,
      });

      let applied = false;
      if (parsed.data.apply) {
        const { error } = await db
          .from('lessons')
          .update({ lesson_type: detection.lesson_type })
          .eq('id', id)
          .eq('user_id', user.id);
        applied = !error;
      }
      return NextResponse.json({ detection, applied });
    } catch (e) {
      const msg = e instanceof Error ? e.message : '课型识别失败';
      return NextResponse.json({ error: msg }, { status: 422 });
    }
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '课型识别失败' }, { status: 500 });
  }
}

// 人工指定或清除课型（传 null 清除）。
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const parsed = setSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: '参数不合法' }, { status: 400 });
    }

    const raw = parsed.data.lesson_type;
    const code = raw === null ? null : normalizeLessonType(raw);
    if (raw !== null && !code) {
      return NextResponse.json({ error: '课型取值不合法' }, { status: 400 });
    }

    const { error } = await db
      .from('lessons')
      .update({ lesson_type: code })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) {
      return NextResponse.json({ error: '保存课型失败' }, { status: 500 });
    }
    return NextResponse.json({ lesson_type: code });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '保存课型失败' }, { status: 500 });
  }
}
