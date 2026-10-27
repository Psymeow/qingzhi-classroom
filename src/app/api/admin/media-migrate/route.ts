import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { listObjects, uploadObjectStream } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 课堂录像最大 567MB，「下载 + 流式上传」需要留足执行时间 */
export const maxDuration = 300;

/**
 * 历史素材跨桶迁移。
 *
 * 背景：项目是从旧项目 import 重建的，存储桶没跟着走。沙箱期上传的课堂录像留在
 * 旧桶（coze_storage_7700539814080315411），而生产部署签出来的是另一个桶
 * （coze_storage_7701135298981396530），sign-url 服务按项目映射、不接受调用方
 * 指定桶，所以老素材在生产一律 404。这里把对象从旧桶搬进生产桶：
 *
 *   旧桶签名地址（由平台沙箱签发，公网可下载）
 *     → 服务端 fetch 取流 → uploadObjectStream 写入生产桶 → 回写 lesson_assets.file_url
 *
 * 只做「一个素材一次」的粒度：567MB 单文件不适合和别的一起塞进同一个请求，
 * 前端逐个点击，失败也容易定位是哪一条。
 */

interface MigrateBody {
  assetId?: string;
  sourceUrl?: string;
}

/** 列出生产桶现状 + 待迁移的素材清单（诊断入口）。 */
export async function GET(req: NextRequest) {
  const guard = await requirePlatformAdmin(req);
  if (!guard.ok) return guard.response;
  const { db } = guard;

  let keys: string[] = [];
  let bucketError = '';
  try {
    keys = await listObjects();
  } catch (e) {
    // 列不出桶不致命：说明是凭证问题，但下面按库记录照样能看清单
    bucketError = e instanceof Error ? e.message : String(e);
  }

  const { data, error } = await db
    .from('lesson_assets')
    .select('id, kind, file_name, file_url, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: `读取素材记录失败：${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    bucket_key_count: keys.length,
    bucket_keys: keys.slice(0, 30),
    bucket_error: bucketError || null,
    assets: data ?? [],
  });
}

/** 迁移单个素材：把 sourceUrl 的内容写入生产桶，并把记录指向新 key。 */
export async function POST(req: NextRequest) {
  const guard = await requirePlatformAdmin(req);
  if (!guard.ok) return guard.response;
  const { db } = guard;

  let body: MigrateBody;
  try {
    body = (await req.json()) as MigrateBody;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const assetId = (body.assetId ?? '').trim();
  const sourceUrl = (body.sourceUrl ?? '').trim();
  if (!assetId || !sourceUrl) {
    return NextResponse.json({ error: '缺少 assetId 或 sourceUrl' }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return NextResponse.json({ error: 'sourceUrl 必须是 http(s) 地址' }, { status: 400 });
  }

  const { data: row, error: readError } = await db
    .from('lesson_assets')
    .select('id, file_url, file_name, kind')
    .eq('id', assetId)
    .single();

  if (readError || !row) {
    return NextResponse.json({ error: '素材不存在' }, { status: 404 });
  }

  const oldKey = String(row.file_url ?? '');
  if (!oldKey) {
    return NextResponse.json({ error: '该素材没有对象 key，无法判断存放位置' }, { status: 400 });
  }

  // 沿用原 key 的目录结构（u_<uid>/l_<lessonId>/<kind>），只把文件本体换掉，
  // 这样迁移后的对象仍在同一目录下，后续排查路径不会散。
  const segments = oldKey.split('/');
  const fileName = segments.pop() ?? 'file';
  const scope = segments.join('/');
  if (!scope) {
    return NextResponse.json({ error: `对象 key 结构异常：${oldKey}` }, { status: 400 });
  }

  const upstream = await fetch(sourceUrl, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `源地址取流失败：${upstream.status}` }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? undefined;
  const stream = Readable.fromWeb(
    upstream.body as unknown as import('stream/web').ReadableStream<Uint8Array>,
  );

  let newKey: string;
  try {
    newKey = await uploadObjectStream(stream, scope, fileName, contentType);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `写入生产桶失败：${message}` }, { status: 502 });
  }

  const { error: updateError } = await db
    .from('lesson_assets')
    .update({ file_url: newKey })
    .eq('id', assetId);

  if (updateError) {
    // 对象已经写进去了，记录没改成功必须说清楚，否则用户看到的是「迁移成功但播不了」
    return NextResponse.json(
      { error: `已写入生产桶但更新记录失败：${updateError.message}`, newKey, oldKey },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, assetId, oldKey, newKey, content_type: contentType ?? null });
}
