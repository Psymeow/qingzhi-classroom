import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 标注体整体为受控 JSON（前端按 LessonAnnotation 组织），这里只做最外层结构与大小校验，
// 内部字段在分析引擎消费时再按类型使用，避免在 API 层重复维护整套结构。
const annotationSchema = z
  .object({
    seating: z.record(z.string(), z.unknown()),
    role_timeline: z.array(z.unknown()).max(5000),
    interactions: z.array(z.unknown()).max(5000),
    events: z.array(z.unknown()).max(5000),
    phases: z.array(z.unknown()).max(200),
    dimension_scores: z.array(z.unknown()).max(50),
    observer_sheet: z.array(z.unknown()).max(100),
  })
  .passthrough();

// 读取本课例的人工标注（每课例最多一条）。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const { data, error } = await db
      .from('annotations')
      .select('id,payload,version,updated_at')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ annotation: data ?? null });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取标注失败' }, { status: 500 });
  }
}

// 保存（upsert by lesson_id + user_id），version 自增；返回最新 version 供前端对齐。
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = annotationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: '标注数据结构不合法' }, { status: 400 });
    }
    const now = new Date().toISOString();

    const { data: existing } = await db
      .from('annotations')
      .select('id,version')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (existing) {
      const nextVersion = existing.version + 1;
      const { data, error } = await db
        .from('annotations')
        .update({ payload: { ...parsed.data, lesson_id: id }, version: nextVersion, updated_at: now })
        .eq('id', existing.id)
        .select('id,version,updated_at')
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ annotation: data });
    }

    const { data, error } = await db
      .from('annotations')
      .insert({
        lesson_id: id,
        user_id: user.id,
        payload: { ...parsed.data, lesson_id: id },
        version: 1,
        updated_at: now,
      })
      .select('id,version,updated_at')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ annotation: data }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '保存标注失败' }, { status: 500 });
  }
}
