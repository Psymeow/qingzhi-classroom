import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { signObjectUrl } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MediaDiagRow {
  id: string;
  lesson_id: string;
  kind: string;
  file_name: string | null;
  file_url: string | null;
  lessons: { title: string | null } | null;
}

/**
 * 媒体只读诊断：登录用户自查「课堂实录上传了却播不出来」。
 *
 * 沙箱内没有绕过 RLS 的凭证（无 service role key），普通服务端查询查不到数据，
 * 因此改为让已登录用户带着自己的 JWT 调本接口：RLS 按 auth.uid() 放行本人数据，
 * 逐行检查 file_url 是否有值、能否签出 URL、对象是否可达（HEAD）。
 * 只读，不写任何数据。
 */
export async function GET(req: NextRequest) {
  try {
    const { user, db } = await authenticate(req);

    const { data, error } = await db
      .from('lesson_assets')
      .select('id,lesson_id,kind,file_name,file_url,lessons(title)')
      .eq('user_id', user.id)
      .in('kind', ['av_video', 'av_audio'])
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as unknown as MediaDiagRow[];

    const assets = await Promise.all(
      rows.map(async (r) => {
        const base = {
          id: r.id,
          lesson_id: r.lesson_id,
          lesson_title: r.lessons?.title ?? null,
          kind: r.kind,
          file_name: r.file_name,
          file_url_empty: !r.file_url,
          file_url_prefix: r.file_url ? r.file_url.slice(0, 48) : null,
        };

        if (!r.file_url) return { ...base, sign: 'skip' as const };

        try {
          const signed = await signObjectUrl(r.file_url, 120);
          let signed_host: string | null = null;
          let head_status: number | null = null;
          try {
            signed_host = new URL(signed).host;
            const head = await fetch(signed, { method: 'HEAD' });
            head_status = head.status;
          } catch {
            // HEAD 失败不影响「能否签名」这一结论
          }
          return { ...base, sign: 'ok' as const, signed_host, head_status };
        } catch (e) {
          return {
            ...base,
            sign: 'err' as const,
            sign_error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );

    return NextResponse.json({
      user_id: user.id,
      bucket_note: {
        name: process.env.COZE_BUCKET_NAME ?? null,
        endpoint: process.env.COZE_BUCKET_ENDPOINT_URL ?? null,
      },
      count: assets.length,
      assets,
    });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '媒体诊断失败' }, { status: 500 });
  }
}
