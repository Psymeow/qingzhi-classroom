import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { userClient, requireUser, AuthError } from '@/lib/auth/server';

const createSchema = z.object({
  title: z.string().trim().min(1, '课例标题不能为空').max(255),
  teacher_name: z.string().trim().max(128).optional().nullable(),
  school: z.string().trim().max(255).optional().nullable(),
  grade_class: z.string().trim().max(128).optional().nullable(),
  lesson_type: z.string().max(32).optional().nullable(),
  subject: z.string().max(32).optional(),
  lesson_date: z.string().optional().nullable(),
  duration_sec: z.number().int().nonnegative().optional().nullable(),
  standard_set_id: z.string().max(36).optional().nullable(),
});

const LESSON_COLS =
  'id,title,teacher_name,school,grade_class,lesson_type,subject,lesson_date,duration_sec,standard_set_id,status,created_at,updated_at';

export async function GET(req: NextRequest) {
  try {
    const db = await userClient(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    let q = db.from('lessons').select(LESSON_COLS).order('updated_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ lessons: data ?? [] });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取课例列表失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '参数不合法' }, { status: 400 });
    }
    const v = parsed.data;
    const db = await userClient(req);

    // 已加入机构的教师，课例自动归属该机构（可见性默认 private：仅本人与机构管理员可见）
    const { data: member } = await db
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    const orgId = (member as { org_id?: string } | null)?.org_id ?? null;

    const row: Record<string, unknown> = {
      user_id: user.id,
      org_id: orgId,
      title: v.title,
      teacher_name: v.teacher_name || null,
      school: v.school || null,
      grade_class: v.grade_class || null,
      lesson_type: v.lesson_type || null,
      subject: v.subject || 'math',
      lesson_date: v.lesson_date || null,
      duration_sec: v.duration_sec ?? null,
      standard_set_id: v.standard_set_id || null,
      status: 'draft',
    };

    const { data, error } = await db.from('lessons').insert(row).select(LESSON_COLS).single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ lesson: data }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '创建课例失败' }, { status: 500 });
  }
}
