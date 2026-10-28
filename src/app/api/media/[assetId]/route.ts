import { NextRequest } from 'next/server';
import { readMediaTicket } from '@/lib/media/ticket';
import { signObjectUrl } from '@/lib/storage/s3';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 课堂音视频流代理。
 *
 * 为什么不直接让浏览器连存储 CDN：实测 `coze-coding-project.tos.coze.site` 的连接耗时
 * 在 6ms 到 20s 之间随机跳（10 次采样里出现过一次 4 秒），视频靠连续 range 请求边下边播，
 * 任何一次连接卡住整段就停在 0:00。改由本路由转发后，浏览器只连自己的域名，
 * 与存储之间的连接质量由服务端承担，客户端不再赌网络。
 *
 * 鉴权走票据（见 lib/media/ticket）：video/audio 标签带不了 x-session。
 * 转发时只透传 Range 相关的必要响应头，不整份读入内存，大文件（实测最大 567MB）也能边取边发。
 */
const FORWARD_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified',
];

/**
 * 单次响应最多转发的字节数。
 *
 * 关键约束：本部署的出网链路会把**整个响应体缓冲完**才把第一个字节交给客户端。
 * 实测同一个接口，请求 256KB 时首字节 0.25s、16MB 时 1.2s、32MB 时 1.2s，
 * 且中断实验显示请求 100MB 时前 2 秒一个字节都收不到——说明不是代码层没 pipe，
 * 是平台在函数返回后仍然整份缓存再发出。
 *
 * 后果：`<video>` 打开时通常发一个 `Range: bytes=0-`（整份）请求，
 * 161MB 要等 3 秒、567MB 要等 12 秒才出第一个字节，拖动进度条再等一次，
 * 用户看到的就是「网页很卡、反应不灵敏」。
 *
 * 缓解办法是把每次响应压到一个小窗口：上游按窗口取，客户端拿到一段就继续要下一段。
 * 2MB 在实测吞吐（约 50MB/s）下约 0.1s 传完，首字节从秒级降回百毫秒级；
 * 浏览器播放只要求「按顺序拿到字节」，收到比自己要的更小的 206 会接着要后面的部分，这是标准行为。
 */
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

/** 只处理 `bytes=a-b` 这一种单区间格式；其余（多区间、后缀区间、怪写法）原样透传，不猜。 */
function narrowRange(range: string): string | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return undefined;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return undefined;
  const start = rawStart === '' ? null : Number(rawStart);
  const end = rawEnd === '' ? null : Number(rawEnd);
  // 后缀区间 bytes=-N（取末尾 N 字节）：不改，交给上游，实践中 N 都很小
  if (start === null) return undefined;
  const capEnd = start + MAX_CHUNK_BYTES - 1;
  if (end === null) return `bytes=${start}-${capEnd}`;
  if (!Number.isFinite(end) || end > capEnd) return `bytes=${start}-${capEnd}`;
  return undefined;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ assetId: string }> }): Promise<Response> {
  const { assetId } = await ctx.params;
  const ticket = req.nextUrl.searchParams.get('t') ?? '';
  const verified = readMediaTicket(ticket, assetId);
  if (!verified) {
    return new Response('播放凭证无效或已过期，请刷新页面重试', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const method = req.method === 'HEAD' ? 'HEAD' : 'GET';
  const rawRange = req.headers.get('range') ?? undefined;
  const range = method === 'HEAD' ? undefined : rawRange ? narrowRange(rawRange) ?? rawRange : undefined;

  /**
   * 历史素材的 key 已在生产桶里换过名（见 LEGACY_KEY_REMAP），签名内部会先映射回真实对象，
   * 这里不再需要按桶兜底：sign-url 服务忽略调用方传的 bucket，双桶重试只是白跑一遍。
   */
  let upstream: Response | null = null;
  let lastError: unknown = null;
  let upstreamHint = '';

  // 与存储 CDN 的连接确实偶发抖动，同一地址再试一次，把瞬时失败挡在用户感知之外。
  for (let attempt = 0; attempt < 2 && !upstream; attempt += 1) {
    try {
      const signed = await signObjectUrl(verified.objectKey);
      try {
        const u = new URL(signed);
        upstreamHint = `${u.host}${u.pathname}`.slice(0, 200);
      } catch {
        upstreamHint = signed.slice(0, 160);
      }
      const res = await fetch(signed, {
        method,
        headers: range ? { Range: range } : undefined,
        cache: 'no-store',
      });
      // 416 说明浏览器请求的范围越界，属于正常协议响应，原样回传让播放器自己收敛
      if (res.ok || res.status === 206 || res.status === 416) {
        upstream = res;
        break;
      }
      lastError = new Error(`上游返回 ${res.status}`);
    } catch (e) {
      lastError = e;
    }
  }

  if (!upstream) {
    const detail = lastError instanceof Error ? lastError.message : '未知错误';
    const where = upstreamHint ? `（${upstreamHint}）` : '';
    return new Response(`媒体取流失败：${detail}${where}`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const headers = new Headers();
  for (const name of FORWARD_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // 票据本身有时效，响应不允许被中间层长期缓存
  headers.set('cache-control', 'private, max-age=0, no-store');

  if (method === 'HEAD' || !upstream.body) {
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  return handle(req, ctx);
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ assetId: string }> }) {
  return handle(req, ctx);
}
