import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INPUT_COLS =
  'id,lesson_id,transcript,transcript_source,observer_text,task_sheet_text,updated_at';

// 文本上限：转写文稿 20 万字，任务单 12 万字，观察记录 5 万字（超出由前端提示）。
const inputSchema = z.object({
  transcript: z.string().max(200_000).nullable().optional(),
  observer_text: z.string().max(50_000).nullable().optional(),
  task_sheet_text: z.string().max(120_000).nullable().optional(),
});

// 读取本课例的转写文稿与观察记录（每课例最多一条 input）。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const { data, error } = await db
      .from('ai_analysis_inputs')
      .select(INPUT_COLS)
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ input: data ?? null });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取文本数据失败' }, { status: 500 });
  }
}

// 保存（upsert by lesson_id + user_id）。V1.1 转写为手动导入，固定 transcript_source='manual'。
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    const parsed = inputSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: '内容超出长度限制或参数不合法' }, { status: 400 });
    }
    const { transcript, observer_text, task_sheet_text } = parsed.data;
    const now = new Date().toISOString();

    // 部分更新语义：只覆盖本次显式提供的字段，未提供的字段保持原值；
    // 空白字符串归一为 null（用于清空对应字段）。
    const hasT = transcript !== undefined;
    const hasO = observer_text !== undefined;
    const hasS = task_sheet_text !== undefined;
    const normTranscript = hasT && transcript && transcript.trim() ? transcript : null;
    const normObserver = hasO && observer_text && observer_text.trim() ? observer_text : null;
    const normSheet = hasS && task_sheet_text && task_sheet_text.trim() ? task_sheet_text : null;

    const { data: existing } = await db
      .from('ai_analysis_inputs')
      .select('id,transcript,observer_text,task_sheet_text')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    // 计算合并后的最终字段；全部为空则不落库（删除现有记录）。
    const finalTranscript = hasT ? normTranscript : existing?.transcript ?? null;
    const finalObserver = hasO ? normObserver : existing?.observer_text ?? null;
    const finalSheet = hasS ? normSheet : existing?.task_sheet_text ?? null;

    if (!finalTranscript && !finalObserver && !finalSheet) {
      if (existing) {
        await db.from('ai_analysis_inputs').delete().eq('id', existing.id);
      }
      return NextResponse.json({ input: null });
    }

    if (existing) {
      const { data, error } = await db
        .from('ai_analysis_inputs')
        .update({
          transcript: finalTranscript,
          observer_text: finalObserver,
          task_sheet_text: finalSheet,
          transcript_source: 'manual',
          updated_at: now,
        })
        .eq('id', existing.id)
        .select(INPUT_COLS)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ input: data });
    }

    const { data, error } = await db
      .from('ai_analysis_inputs')
      .insert({
        lesson_id: id,
        user_id: user.id,
        transcript: finalTranscript,
        observer_text: finalObserver,
        task_sheet_text: finalSheet,
        transcript_source: 'manual',
        updated_at: now,
      })
      .select(INPUT_COLS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ input: data });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '保存文本数据失败' }, { status: 500 });
  }
}
