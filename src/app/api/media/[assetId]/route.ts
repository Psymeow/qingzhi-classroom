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
  const range = req.headers.get('range') ?? undefined;

  let upstream: Response | null = null;
  let lastError: unknown = null;
  // 存储 CDN 连接抖动是随机偶发的，代理层多给一次机会，
  // 比让播放器直接卡在 0:00 让用户自己刷新体验好得多。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const signed = await signObjectUrl(verified.objectKey, 300);
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
    return new Response(`媒体取流失败：${detail}`, {
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
