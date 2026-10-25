import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { deleteObject } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 删除素材：先定位属于本课例且本人的素材行，拿到对象 key 后删对象，再删库行。
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; assetId: string }> },
) {
  try {
    const { user, db } = await authenticate(req);
    const { id, assetId } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const { data: asset, error: fetchErr } = await db
      .from('lesson_assets')
      .select('id,file_url')
      .eq('id', assetId)
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    if (!asset) return NextResponse.json({ error: '素材不存在' }, { status: 404 });

    // 对象存储删除失败不阻塞库行清理（可能已被生命周期策略清理）。
    if (asset.file_url) await deleteObject(asset.file_url);

    const { error: delErr } = await db
      .from('lesson_assets')
      .delete()
      .eq('id', assetId)
      .eq('lesson_id', id)
      .eq('user_id', user.id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '删除素材失败' }, { status: 500 });
  }
}
