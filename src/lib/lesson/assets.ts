// 课例素材类型与上传约束（前后端共用）。
// kind 与数据库 lesson_assets.kind 枚举对齐。

export type AssetKind =
  | 'av_video'
  | 'av_audio'
  | 'lesson_plan'
  | 'task_sheet'
  | 'observer_record'
  | 'transcript';

export const ASSET_KIND_LABEL: Record<AssetKind, string> = {
  av_video: '课堂视频',
  av_audio: '课堂音频',
  lesson_plan: '教案',
  task_sheet: '任务单',
  observer_record: '观察员记录',
  transcript: '转写文稿',
};

export const ASSET_KIND_HINT: Record<AssetKind, string> = {
  av_video: 'MP4 / MOV / WebM 等课堂录像',
  av_audio: 'MP3 / M4A / WAV 等课堂录音',
  lesson_plan: 'PDF / Word / 图片',
  task_sheet: 'PDF / 图片 / Word',
  observer_record: 'PDF / 图片 / Word / 文本',
  transcript: '纯文本 / Word / PDF（也可在下方直接粘贴）',
};

// 哪些 kind 走上方的分类上传卡片；转写文稿在「课堂转写文稿」区单独提供「上传文稿」入口
// （纯文本文稿浏览器端就地读入文本框，Word/PDF 走素材上传 + 文档解析）。
export const UPLOADABLE_KINDS: AssetKind[] = [
  'av_video',
  'av_audio',
  'lesson_plan',
  'task_sheet',
  'observer_record',
];

// 各类素材允许的 MIME 与扩展名（accept 属性 + 服务端校验共用）。
export const ASSET_ACCEPT: Record<AssetKind, string> = {
  av_video: 'video/*',
  av_audio: 'audio/*',
  lesson_plan: '.pdf,.doc,.docx,.png,.jpg,.jpeg,.webp',
  task_sheet: '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx',
  observer_record: '.pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.txt',
  transcript: '.txt,.md,.csv,.srt,.vtt,.doc,.docx,.pdf',
};

// 允许的 MIME 前缀 / 精确值白名单（服务端二次校验，不能只依赖 accept）。
const GENERIC_DOC = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'application/octet-stream', // 部分浏览器对扩展名文件给通用类型，交由扩展名兜底
]);

/** 转写文稿可直接上传的文档类型（浏览器读不了，走服务端文档解析） */
const TRANSCRIPT_DOC_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** 转写文稿：浏览器端可直接读成文本的扩展名（就地读入，不上传不解析） */
export const TRANSCRIPT_TEXT_EXT = [
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.log',
  '.srt',
  '.vtt',
  '.json',
];

export const ASSET_MIME_RULES: Record<AssetKind, (mime: string) => boolean> = {
  av_video: (m) => m.startsWith('video/'),
  av_audio: (m) => m.startsWith('audio/'),
  lesson_plan: (m) => GENERIC_DOC.has(m),
  task_sheet: (m) => GENERIC_DOC.has(m),
  observer_record: (m) => GENERIC_DOC.has(m),
  transcript: (m) => m.startsWith('text/') || TRANSCRIPT_DOC_MIME.has(m) || m === 'application/octet-stream',
};

/** 扩展名 → MIME 兜底映射（部分浏览器/选择器对视频、音频不给 type，需按扩展名判定）。 */
const EXT_MIME: Record<string, string> = {
  // 视频
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
  mkv: 'video/x-matroska', avi: 'video/x-msvideo', flv: 'video/x-flv', ts: 'video/mp2t',
  // 音频
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  opus: 'audio/opus', aac: 'audio/aac', flac: 'audio/flac', wma: 'audio/x-ms-wma',
  // 文档 / 图片
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', heic: 'image/heic',
};

/**
 * 解析素材 MIME：优先用声明类型；为空或 octet-stream 时按扩展名兜底。
 * 返回在该 kind 规则下合法的 mime；无法判定返回 null（调用方据此拒绝）。
 * 供分片上传合成接口使用——大文件分片时浏览器可能拿不到准确 type，必须能按扩展名兜底。
 */
export function resolveAssetMime(kind: AssetKind, declared: string | undefined, fileName: string): string | null {
  const d = (declared || '').toLowerCase().trim();
  if (d && d !== 'application/octet-stream' && ASSET_MIME_RULES[kind](d)) return d;
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const guessed = EXT_MIME[ext];
  if (guessed && ASSET_MIME_RULES[kind](guessed)) return guessed;
  return null;
}

// 大小上限（字节）。课堂录像允许较大（整节课 1080p 常在数百 MB 量级）；音频对齐 ASR 上限 100MB；文档/图片控制在常规范围。
const MB = 1024 * 1024;
export const ASSET_MAX_BYTES: Record<AssetKind, number> = {
  av_video: 800 * MB,
  av_audio: 100 * MB,
  lesson_plan: 20 * MB,
  task_sheet: 20 * MB,
  observer_record: 20 * MB,
  transcript: 5 * MB,
};

/** 各类素材的人类可读大小上限，用于上传卡片提示与客户端预校验文案。 */
export const ASSET_MAX_HINT: Record<AssetKind, string> = {
  av_video: '≤ 800MB',
  av_audio: '≤ 100MB',
  lesson_plan: '≤ 20MB',
  task_sheet: '≤ 20MB',
  observer_record: '≤ 20MB',
  transcript: '≤ 5MB',
};

// —— 分片上传参数 ——
// 平台网关对单个请求体硬限 128MB（实测 413 request_body_too_large），该限制无法通过改代码绕过。
// 因此：小于阈值的文件走单次上传；更大的（如整节课录像，天然数百 MB~GB）在客户端切片逐片上传，服务端拼装后流式入 S3。
export const SINGLE_UPLOAD_MAX = 100 * MB; // 单次上传阈值（留出 multipart 开销余量）
export const CHUNK_SIZE = 100 * MB; // 每个分片大小（须 < 128MB 网关上限）

/**
 * 客户端上传前预校验：与服务端同一份大小/MIME 规则，提前拦下超限/类型不符文件，
 * 避免等待上传后才收到 413/415。返回错误文案；通过返回 null。
 */
export function validateAssetFile(kind: AssetKind, file: File): string | null {
  if (!file || file.size === 0) return '文件为空，请重新选择';
  if (file.size > ASSET_MAX_BYTES[kind]) {
    return `${ASSET_KIND_LABEL[kind]}大小不能超过 ${ASSET_MAX_HINT[kind].replace('≤ ', '')}，当前文件 ${(file.size / (1024 * 1024)).toFixed(1)}MB`;
  }
  const mime = (file.type || '').toLowerCase();
  if (mime && !ASSET_MIME_RULES[kind](mime)) {
    return `文件类型不被「${ASSET_KIND_LABEL[kind]}」接受，请选择 ${ASSET_KIND_HINT[kind]}`;
  }
  // MIME 为空（部分安卓 Via/系统选择器不给 type）时，用扩展名兜底
  if (!mime) {
    const name = file.name.toLowerCase();
    const acceptExt = ASSET_ACCEPT[kind]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('.'));
    const extOk = acceptExt.length === 0 || acceptExt.some((ext) => name.endsWith(ext));
    if (!extOk) return `文件类型不被「${ASSET_KIND_LABEL[kind]}」接受，请选择 ${ASSET_KIND_HINT[kind]}`;
  }
  return null;
}

/**
 * 转写文稿上传：判断是否为「浏览器端可直读的纯文本」。
 * 是 → 就地读入文本框（即时、不占存储）；否（Word / PDF）→ 上传后由服务端解析。
 */
export function isPlainTextTranscriptFile(file: File): boolean {
  const name = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  // Word / PDF 明确走服务端解析
  if (TRANSCRIPT_DOC_MIME.has(mime)) return false;
  if (mime.startsWith('text/')) return true;
  // MIME 缺失或不规范（部分安卓选择器只给 application/octet-stream）时用扩展名兜底
  return TRANSCRIPT_TEXT_EXT.some((ext) => name.endsWith(ext));
}

/**
 * 转写文稿文本归一化：去 BOM、统一换行、清理行尾空白、压缩连续空行。
 * 保留「时间码 + 说话人」的行结构——证据定位依赖原文形态。
 */
export function normalizeTranscriptText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isAssetKind(value: string): value is AssetKind {
  return value in ASSET_KIND_LABEL;
}

export function assetKindLabel(value?: string | null): string {
  if (value && value in ASSET_KIND_LABEL) return ASSET_KIND_LABEL[value as AssetKind];
  return value ?? '素材';
}
