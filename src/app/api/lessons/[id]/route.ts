import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { userClient, requireUser, AuthError, type DbClient } from '@/lib/auth/server';

const LESSON_COLS =
  'id,user_id,title,teacher_name,school,grade_class,lesson_type,subject,lesson_date,duration_sec,standard_set_id,status,created_at,updated_at';

const patchSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  teacher_name: z.string().trim().max(128).nullable().optional(),
  school: z.string().trim().max(255).nullable().optional(),
  grade_class: z.string().trim().max(128).nullable().optional(),
  lesson_type: z.string().max(32).nullable().optional(),
  subject: z.string().max(32).optional(),
  lesson_date: z.string().nullable().optional(),
  duration_sec: z.number().int().nonnegative().nullable().optional(),
  standard_set_id: z.string().max(36).nullable().optional(),
  status: z.enum(['draft', 'analyzed', 'reviewed']).optional(),
});

async function ownedLesson(db: DbClient, user_id: string, id: string) {
  const { data, error } = await db
    .from('lessons')
    .select(LESSON_COLS)
    .eq('id', id)
    .eq('user_id', user_id)
    .maybeSingle();
  if (error) return { error };
  if (!data) return { notFound: true };
  return { data };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const db = await userClient(req);
    const res = await ownedLesson(db, user.id, id);
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
    if (res.notFound) return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });

    // 附带聚合：素材数、是否有标注、最新报告概要
    const [assets, ann, rep] = await Promise.all([
      db.from('lesson_assets').select('id,kind,file_name,parse_status,created_at').eq('lesson_id', id),
      db.from('annotations').select('id,version,updated_at').eq('lesson_id', id).maybeSingle(),
      db
        .from('reports')
        .select('id,total_score,total_level,need_review_count,is_calibrated,updated_at')
        .eq('lesson_id', id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    // 前端 lessonsApi.get 直接把响应当作 LessonDetail 使用（LessonDetail extends Lesson），
    // 因此课例字段必须平铺在顶层，只把聚合字段单独附加；不能再包一层 { lesson }，
    // 否则 title/teacher_name/school/grade_class/lesson_type/status 全部读成 undefined，
    // 详情页会显示「—/未设置」、报告抬头的学校班级教师也全为空横线。
    return NextResponse.json({
      ...(res.data as Record<string, unknown>),
      assets: assets.data ?? [],
      assetsError: assets.error?.message,
      annotation: ann.data ?? null,
      report: rep.data ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取课例失败' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(body ?? {});
    if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 });

    const db = await userClient(req);
    const check = await ownedLesson(db, user.id, id);
    if (check.error) return NextResponse.json({ error: check.error.message }, { status: 500 });
    if (check.notFound) return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });

    const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
    const { data, error } = await db
      .from('lessons')
      .update(patch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select(LESSON_COLS)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ lesson: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '更新课例失败' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await ctx.params;
    const db = await userClient(req);
    // 与 GET/PATCH 一致：先校验归属，跨用户删除返回 404（RLS 也会兜底，确保删不到他人课例）。
    const check = await ownedLesson(db, user.id, id);
    if (check.error) return NextResponse.json({ error: check.error.message }, { status: 500 });
    if (check.notFound) return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    const { error } = await db.from('lessons').delete().eq('id', id).eq('user_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '删除课例失败' }, { status: 500 });
  }
}
