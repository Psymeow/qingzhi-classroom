import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { listObjects, uploadObjectStream } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 课堂录像最大 567MB，「下载 + 流式上传」需要留足执行时间 */
export const maxDuration = 300;

// ============================================================
// 历史素材搬运（运维用途，一次性）
//
// 为什么需要它：项目从旧项目 import 重建后，存储桶没跟着迁移。沙箱期上传的素材落在
// 旧桶，生产部署读写的是另一个桶，sign-url 服务按环境映射、不接受调用方指定桶，
// 所以老素材在生产一律 404。
//
// 为什么不用 /api/admin/media-migrate：那个接口走 requirePlatformAdmin，需要浏览器
// 登录态；而生产环境没有 service_role key，写库只能靠用户 session。这里退一步只
// 搬对象、不碰数据库，key 映射回到代码里做（见 s3.ts 的 legacyKeyRemap）。
//
// 鉴权：MEDIA_INGEST_TOKEN 环境变量，请求头 x-ingest-token 精确匹配。
// 搬运完成后本文件应连同 MEDIA_INGEST_TOKEN 一起删除。
// ============================================================

/** 常量时间比较，避免按字节提前返回泄漏 token 前缀 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorize(req: NextRequest): NextResponse | null {
  const expected = (process.env.MEDIA_INGEST_TOKEN ?? '').trim();
  if (!expected) {
    return NextResponse.json({ error: '未配置 MEDIA_INGEST_TOKEN，本接口停用' }, { status: 503 });
  }
  const got = (req.headers.get('x-ingest-token') ?? '').trim();
  if (!got || !safeEqual(got, expected)) {
    return NextResponse.json({ error: '令牌无效' }, { status: 401 });
  }
  return null;
}

interface IngestBody {
  key?: string;
  sourceUrl?: string;
}

/** 列出生产桶现状，用于确认搬运结果。 */
export async function GET(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;

  try {
    const keys = await listObjects();
    return NextResponse.json({ bucket_key_count: keys.length, bucket_keys: keys.slice(0, 50) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `列举生产桶失败：${message}` }, { status: 502 });
  }
}

/**
 * 把 sourceUrl 的内容搬进生产桶。
 *
 * key 沿用旧对象 key（含 u_<uid>/l_<lessonId>/<kind> 目录），SDK 会在文件名后追加
 * 8 位随机串，所以落地的 key 与旧 key 不同；调用方拿到 newKey 后到 s3.ts 的映射表登记。
 */
export async function POST(req: NextRequest) {
  const denied = authorize(req);
  if (denied) return denied;

  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const oldKey = (body.key ?? '').trim();
  const sourceUrl = (body.sourceUrl ?? '').trim();

  if (!oldKey || !sourceUrl) {
    return NextResponse.json({ error: '缺少 key 或 sourceUrl' }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(sourceUrl)) {
    return NextResponse.json({ error: 'sourceUrl 必须是 http(s) 地址' }, { status: 400 });
  }

  const segments = oldKey.split('/');
  const fileName = segments.pop() ?? 'file';
  const scope = segments.join('/');

  const upstream = await fetch(sourceUrl, { cache: 'no-store' });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `源地址取流失败：${upstream.status}` }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') ?? undefined;
  const declaredLength = upstream.headers.get('content-length');
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

  return NextResponse.json({
    ok: true,
    oldKey,
    newKey,
    content_type: contentType ?? null,
    source_bytes: declaredLength ? Number(declaredLength) : null,
  });
}
