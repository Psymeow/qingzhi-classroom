import 'server-only';
import type { Readable } from 'stream';
import { S3Storage } from 'coze-coding-dev-sdk';

// S3Storage 在运行时自动读取平台存储凭证（endpoint / bucket / token 中间件），这里只需指定 region。
// 全局单例避免 dev 热更新时重复初始化。
const globalForStorage = globalThis as unknown as { __qzS3?: S3Storage };

function getStorage(): S3Storage {
  if (!globalForStorage.__qzS3) {
    globalForStorage.__qzS3 = new S3Storage({ region: 'cn-beijing' });
  }
  return globalForStorage.__qzS3;
}

/** 签名 URL 有效期：2 小时。对象 key 长期持久化，URL 用时再签。 */
const PRESIGN_EXPIRE_SECONDS = 7200;

/**
 * 历史素材 key 映射：lesson_assets.file_url 里的旧 key → 生产桶里的实际 key。
 *
 * 起因：项目从旧项目 import 重建时存储桶没跟着迁移，沙箱期上传的课堂录像全在旧桶，
 * 生产部署读写的是另一个桶，sign-url 服务按环境映射、不接受调用方指定桶，所以老素材
 * 在生产一律 404。已用 /api/admin/media-ingest 把对象搬进生产桶；但 SDK 上传必定在
 * 文件名后追加 8 位随机串（S3Storage.generateObjectKey），落地 key 和库里的旧 key 对不上。
 * 生产环境没有 service_role，改库必须走用户 session，所以这里做一层映射，让播放代理、
 * 教案解析、ASR、时间轴这些调用点继续传旧 key 也能取到对象。
 *
 * 这批讲次数据重建后应删除本表，并一并删掉 /api/admin/media-ingest。
 */
const LEGACY_KEY_REMAP: Record<string, string> = {
  'u_1f04082a-032f-4332-91b8-d68582b4d953/l_b077dc87-8077-4aef-a8b3-42ee78500061/av_video/file_be60773b.mp4':
    'u_1f04082a-032f-4332-91b8-d68582b4d953/l_b077dc87-8077-4aef-a8b3-42ee78500061/av_video/file_be60773b_e32b1b8a.mp4',
  'u_1f04082a-032f-4332-91b8-d68582b4d953/l_b8152d2f-040d-4a16-a0f3-d6195f5e0d7e/av_video/file_83019a7e.mp4':
    'u_1f04082a-032f-4332-91b8-d68582b4d953/l_b8152d2f-040d-4a16-a0f3-d6195f5e0d7e/av_video/file_83019a7e_77e57029.mp4',
  'u_1f04082a-032f-4332-91b8-d68582b4d953/l_b077dc87-8077-4aef-a8b3-42ee78500061/lesson_plan/20261015_05b84ed6.docx':
    'u_1f04082a-032f-4332-91b8-d68582b4d953/l_b077dc87-8077-4aef-a8b3-42ee78500061/lesson_plan/20261015_05b84ed6_32698fbc.docx',
};

/** 把历史素材的旧 key 换成生产桶里的实际 key；其他 key（含新上传）原样返回。 */
function remapLegacyKey(key: string): string {
  return LEGACY_KEY_REMAP[key] ?? key;
}

/** 将任意文件名清洗为对象存储安全的 basename（仅 ASCII 字母数字 . _ -，空格转下划线）。 */
function sanitizeBaseName(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  const cleaned = base
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned || 'file';
}

/** 组装逻辑目录前缀 + 清洗后的文件名，得到送入 SDK 的对象名（SDK 再加 UUID 前缀防冲突）。 */
function buildObjectName(scope: string, fileName: string): string {
  const safe = sanitizeBaseName(fileName);
  const cleanScope = scope
    .split('/')
    .map((seg) => seg.trim().replace(/[^A-Za-z0-9._-]/g, '_'))
    .filter(Boolean)
    .join('/');
  return cleanScope ? `${cleanScope}/${safe}` : safe;
}

/** 上传文件到对象存储（整块 Buffer，适合中小文件）。@returns 实际对象 key（须持久化该返回值） */
export async function uploadObject(
  buffer: Buffer,
  scope: string,
  fileName: string,
  contentType?: string,
): Promise<string> {
  const storage = getStorage();
  return storage.uploadFile({
    fileContent: buffer,
    fileName: buildObjectName(scope, fileName),
    contentType,
  });
}

/**
 * 流式上传：把一个 Node 可读流直接灌入对象存储，全程不把大文件读进内存。
 * 用于分片拼装后的整文件上传（课堂录像等大文件），避免 Buffer 全量驻留导致沙箱 OOM。
 * @returns 实际对象 key（与 uploadObject 一致，SDK 会加 UUID 前缀）
 */
export async function uploadObjectStream(
  stream: Readable,
  scope: string,
  fileName: string,
  contentType?: string,
): Promise<string> {
  const storage = getStorage();
  return storage.streamUploadFile({
    stream,
    fileName: buildObjectName(scope, fileName),
    contentType,
  });
}

/**
 * 签名地址短缓存。
 *
 * 每次签名 SDK 都要向 sign-url 服务发一次往返（实测约占单次取流耗时的四成），
 * 而播放时浏览器是按 2MB 一小段连续要的，一秒内会来好几次。
 * 签名有效期有 7200s，缓存 600s 完全安全；过期后自然重签，用户无感。
 * 进程内 Map，容量封顶防止长期运行下无限增长。
 */
const SIGN_CACHE_TTL_MS = 600 * 1000;
const SIGN_CACHE_MAX = 200;
const signCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * 为已持久化的对象 key 生成临时签名访问 URL。
 *
 * 签名本身是本地计算，但 SDK 首次调用要先取一次存储凭证，这一步偶发瞬时失败，
 * 之前会让整页音视频一次性签不出地址（表现为黑屏且无任何提示）。
 * 这里做 3 次短退避重试，把「瞬时不稳」挡在用户感知之外；
 * 真持续失败仍然抛出，由上层降级成明确提示，不吞错误。
 *
 * @param bucket 可选，显式指定存储桶名。不传则用运行时默认桶（COZE_BUCKET_NAME）。
 *   传了 bucket 时不做缓存：调用方在做非常规桶的探测，缓存会污染默认路径。
 */
export async function signObjectUrl(
  key: string,
  expireSeconds = PRESIGN_EXPIRE_SECONDS,
  bucket?: string,
): Promise<string> {
  const storage = getStorage();
  // 历史素材的 key 已在生产桶里换了名字，签之前先映射回实际对象；新上传的 key 原样通过。
  const targetKey = remapLegacyKey(key);
  const cacheKey = bucket ? '' : `${targetKey}|${expireSeconds}`;
  if (cacheKey) {
    const hit = signCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.url;
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const url = await storage.generatePresignedUrl({
        key: targetKey,
        expireTime: expireSeconds,
        ...(bucket ? { bucket } : {}),
      });
      if (cacheKey) {
        // 缓存寿命按「签名剩余有效期」与 TTL 取小，绝不给出已过期或快过期的地址
        const safeTtl = Math.min(SIGN_CACHE_TTL_MS, Math.max(0, (expireSeconds - 60) * 1000));
        if (safeTtl > 0) {
          if (signCache.size >= SIGN_CACHE_MAX) {
            const oldest = signCache.keys().next().value;
            if (oldest !== undefined) signCache.delete(oldest);
          }
          signCache.set(cacheKey, { url, expiresAt: Date.now() + safeTtl });
        }
      }
      return url;
    } catch (e) {
      lastError = e;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** 删除对象；对象不存在不视为致命错误（由上层决定是否继续删库行）。 */
export async function deleteObject(key: string): Promise<boolean> {
  try {
    return await getStorage().deleteFile({ fileKey: remapLegacyKey(key) });
  } catch {
    return false;
  }
}

/** 列出运行时默认桶里的对象 key（诊断与跨桶迁移用）。 */
export async function listObjects(prefix?: string): Promise<string[]> {
  const result = await getStorage().listFiles(prefix ? { prefix } : {});
  return result.keys;
}
