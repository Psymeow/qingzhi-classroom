import 'server-only';
import crypto from 'crypto';

/**
 * 媒体播放票据。
 *
 * 为什么需要票据：`<video>` / `<audio>` 标签由浏览器直接发请求，带不了 `x-session`，
 * 所以媒体代理路由拿不到登录态。票据把「这一条素材的对象 key + 过期时间」加密后放进 URL，
 * 代理路由解密即可转发，既不需要再查库、也不需要把用户 JWT 暴露在地址栏里。
 *
 * 安全边界与改造前一致：票据在有效期内等同于一次临时授权，泄露即可播放该条素材
 * （原来的 2 小时签名 URL 也是这个性质）；票据只能解出单条素材的对象 key，不能换出用户身份。
 */
const TICKET_TTL_SECONDS = 7200;

/** 密钥由部署环境已有的 SUPABASE_ANON_KEY 派生，避免额外新增环境变量。 */
function deriveKey(): Buffer {
  return crypto
    .createHash('sha256')
    .update(`qz-media-stream:${process.env.SUPABASE_ANON_KEY ?? 'local-dev'}`)
    .digest();
}

interface TicketPayload {
  /** 素材 id，与 URL 中的 assetId 比对，防止张冠李戴 */
  a: string;
  /** 对象存储 key */
  k: string;
  /** 过期时间（秒级 Unix） */
  e: number;
}

/** 签发播放票据：iv(12) + authTag(16) + ciphertext，base64url。 */
export function issueMediaTicket(assetId: string, objectKey: string): string {
  const payload: TicketPayload = {
    a: assetId,
    k: objectKey,
    e: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS,
  };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url');
}

/** 校验并解出票据；无效、被篡改、过期一律返回 null，不抛错。 */
export function readMediaTicket(ticket: string, assetId: string): { objectKey: string } | null {
  try {
    const buf = Buffer.from(ticket, 'base64url');
    // iv(12) + tag(16) 至少 28 字节，再加密文长度
    if (buf.length <= 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(), iv);
    decipher.setAuthTag(tag);
    const raw = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    const payload = JSON.parse(raw) as Partial<TicketPayload>;
    if (!payload.k || !payload.a || typeof payload.e !== 'number') return null;
    if (payload.a !== assetId) return null;
    if (payload.e < Math.floor(Date.now() / 1000)) return null;
    return { objectKey: payload.k };
  } catch {
    return null;
  }
}

/** 拼出前端可直接放进 src 的播放地址。 */
export function mediaStreamUrl(assetId: string, objectKey: string): string {
  return `/api/media/${encodeURIComponent(assetId)}?t=${issueMediaTicket(assetId, objectKey)}`;
}
