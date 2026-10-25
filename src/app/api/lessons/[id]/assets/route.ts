import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { uploadObject, signObjectUrl } from '@/lib/storage/s3';
import {
  isAssetKind,
  ASSET_MIME_RULES,
  ASSET_MAX_BYTES,
} from '@/lib/lesson/assets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 对外响应列：不含 file_url（对象 key），只返回动态签名 url
const ASSET_COLS = 'id,kind,file_name,mime_type,size_bytes,note,parse_status,created_at';
// 服务端查询需额外取 file_url 用于签名
const ASSET_COLS_INTERNAL = `${ASSET_COLS},file_url`;

// 列出当前课例的全部素材，并为有对象 key 的素材动态生成签名访问 URL。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }
    const { data, error } = await db
      .from('lesson_assets')
      .select(ASSET_COLS_INTERNAL)
      .eq('lesson_id', id)
      .order('kind')
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const assets = await Promise.all(
      (data ?? []).map(async (a) => {
        let url: string | null = null;
        if (a.file_url) {
          try {
            url = await signObjectUrl(a.file_url);
          } catch {
            url = null;
          }
        }
        const pub = { ...a };
        delete pub.file_url;
        return { ...pub, url };
      }),
    );
    return NextResponse.json({ assets });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取素材失败' }, { status: 500 });
  }
}

// multipart/form-data 上传：字段 file（文件）、kind（素材类型）、note?（备注）
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const form = await req.formData();
    const kind = String(form.get('kind') ?? '');
    if (!isAssetKind(kind)) {
      return NextResponse.json({ error: '不支持的素材类型' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '缺少上传文件' }, { status: 400 });
    }
    const maxBytes = ASSET_MAX_BYTES[kind];
    if (file.size <= 0) {
      return NextResponse.json({ error: '文件为空' }, { status: 400 });
    }
    if (file.size > maxBytes) {
      const limitMb = Math.round(maxBytes / (1024 * 1024));
      return NextResponse.json({ error: `文件超过 ${limitMb}MB 上限` }, { status: 413 });
    }
    const mime = file.type || 'application/octet-stream';
    if (!ASSET_MIME_RULES[kind](mime)) {
      return NextResponse.json({ error: '文件类型不被该素材分类接受' }, { status: 415 });
    }

    const originalName = file.name || `${kind}.bin`;
    const buffer = Buffer.from(await file.arrayBuffer());

    let objectKey: string;
    try {
      objectKey = await uploadObject(buffer, `u_${user.id}/l_${id}/${kind}`, originalName, mime);
    } catch {
      return NextResponse.json({ error: '文件存储失败，请稍后重试' }, { status: 502 });
    }

    const noteRaw = form.get('note');
    const note = noteRaw ? String(noteRaw).slice(0, 1000) : null;

    const { data: row, error } = await db
      .from('lesson_assets')
      .insert({
        lesson_id: id,
        user_id: user.id,
        kind,
        file_name: originalName.slice(0, 512),
        file_url: objectKey, // 持久化对象 key，而非签名 URL
        mime_type: mime.slice(0, 128),
        size_bytes: file.size,
        note,
        parse_status: 'pending',
      })
      .select(ASSET_COLS)
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    let url: string | null = null;
    try {
      url = await signObjectUrl(objectKey);
    } catch {
      url = null;
    }
    // row 已不含 file_url（ASSET_COLS 未选取），仅回传签名 url
    return NextResponse.json({ asset: { ...row, url } }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '上传失败' }, { status: 500 });
  }
}
