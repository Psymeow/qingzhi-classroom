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
 * 为已持久化的对象 key 生成临时签名访问 URL。
 *
 * 签名本身是本地计算，但 SDK 首次调用要先取一次存储凭证，这一步偶发瞬时失败，
 * 之前会让整页音视频一次性签不出地址（表现为黑屏且无任何提示）。
 * 这里做 3 次短退避重试，把「瞬时不稳」挡在用户感知之外；
 * 真持续失败仍然抛出，由上层降级成明确提示，不吞错误。
 *
 * @param bucket 可选，显式指定存储桶名。不传则用运行时默认桶（COZE_BUCKET_NAME）。
 *   历史素材留在旧桶时，需要由调用方显式指定，否则签出的地址指向空的新桶。
 */
export async function signObjectUrl(
  key: string,
  expireSeconds = PRESIGN_EXPIRE_SECONDS,
  bucket?: string,
): Promise<string> {
  const storage = getStorage();
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await storage.generatePresignedUrl({
        key,
        expireTime: expireSeconds,
        ...(bucket ? { bucket } : {}),
      });
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
    return await getStorage().deleteFile({ fileKey: key });
  } catch {
    return false;
  }
}

/** 列出运行时默认桶里的对象 key（诊断与跨桶迁移用）。 */
export async function listObjects(prefix?: string): Promise<string[]> {
  const result = await getStorage().listFiles(prefix ? { prefix } : {});
  return result.keys;
}
