import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { parseObjectToText } from '@/lib/analysis/doc-parse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ============================================================
// 素材文本解析：把已上传的文档（转写文稿 / 任务单 / 观察记录）解析为纯文本，
// 写入 ai_analysis_inputs 对应字段，供 AI 语义评分直接使用。
// 该接口幂等，可对同一素材重复调用（重新解析）。
// ============================================================

/** 素材类型 → 解析结果写入的文本字段 */
const TEXT_FIELD: Record<string, 'task_sheet_text' | 'observer_text' | 'transcript' | 'lesson_plan_text'> = {
  task_sheet: 'task_sheet_text',
  observer_record: 'observer_text',
  transcript: 'transcript',
  lesson_plan: 'lesson_plan_text',
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id, assetId } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const { data: asset, error: aErr } = await db
      .from('lesson_assets')
      .select('id,kind,file_name,file_url')
      .eq('id', assetId)
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    if (!asset) return NextResponse.json({ error: '素材不存在' }, { status: 404 });

    const kind = String(asset.kind ?? '');
    const field = TEXT_FIELD[kind];
    if (!field) {
      return NextResponse.json(
        { error: '该素材类型不需要文本解析（仅转写文稿 / 任务单 / 观察记录 / 教学设计）' },
        { status: 400 },
      );
    }
    if (!asset.file_url) {
      return NextResponse.json({ error: '素材缺少存储对象' }, { status: 400 });
    }

    const parsed = await parseObjectToText(String(asset.file_url));
    const now = new Date().toISOString();

    await db
      .from('lesson_assets')
      .update({
        parse_status: parsed.ok ? 'parsed' : 'failed',
        meta: {
          parse_error: parsed.ok ? null : (parsed.error ?? '解析失败'),
          parsed_at: now,
          chars: parsed.text.length,
        },
      })
      .eq('id', assetId)
      .eq('user_id', user.id);

    if (!parsed.ok) {
      return NextResponse.json(
        { asset_id: assetId, parse_status: 'failed', error: parsed.error ?? '文档解析失败' },
        { status: 422 },
      );
    }

    // 写入（或更新）本课例的 AI 分析输入文本
    const { data: existing } = await db
      .from('ai_analysis_inputs')
      .select('id')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    const payload: Record<string, unknown> = { [field]: parsed.text, updated_at: now };
    if (existing) {
      const { error } = await db
        .from('ai_analysis_inputs')
        .update(payload)
        .eq('id', existing.id)
        .eq('user_id', user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    } else {
      const { error } = await db
        .from('ai_analysis_inputs')
        .insert({ lesson_id: id, user_id: user.id, ...payload });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      asset_id: assetId,
      parse_status: 'parsed',
      field,
      chars: parsed.text.length,
      preview: parsed.text.slice(0, 800),
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '文档解析失败' }, { status: 502 });
  }
}
