'use client';

import { getSupabaseBrowserClientAsync } from '@/lib/supabase-browser';
import { SINGLE_UPLOAD_MAX, CHUNK_SIZE } from '@/lib/lesson/assets';
import type { LessonDigest, ResearchGroup, ResearchInsight } from '@/lib/research/compare';
import type { RunRecordItem } from '@/lib/analysis/run-summary';
export type { RunRecordItem } from '@/lib/analysis/run-summary';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const PUBLIC_PATHS = new Set<string>(['/api/supabase-config']);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 取当前 access_token。刷新/冷启动时 Supabase 会话从本地存储恢复存在空窗，
 * getSession() 可能短暂返回 null（尤其多接口首屏并发时）。此处做有界等待重试，
 * 避免 inputs 等首屏 GET 因瞬时无 token 401 而静默失败、表现为「已保存内容刷新后丢失」。
 * 用户明确处于未登录状态（持续拿不到会话）时返回 null，交由调用方走 401 路由。
 */
async function getAccessToken(attempt = 0): Promise<string | null> {
  const sb = await getSupabaseBrowserClientAsync();
  let token: string | null = null;
  try {
    const { data: sess } = await sb.auth.getSession();
    token = sess?.session?.access_token ?? null;
  } catch (e) {
    // supabase-js 的会话锁（navigator.locks + AbortSignal）在并发/超时时会抛
    // AbortError（"signal is aborted without reason"）。这是瞬时错误，重试即可，
    // 不能让它冒泡成业务失败（曾表现为点「重新运行分析」直接报英文 abort 文案）。
    if (attempt >= 4) throw e;
    await sleep(200 * (attempt + 1)); // 200ms, 400ms, 600ms, 800ms
    return getAccessToken(attempt + 1);
  }
  if (token) return token;
  if (attempt >= 4) return null;
  await sleep(250 * (attempt + 1)); // 250ms, 500ms, 750ms, 1000ms
  return getAccessToken(attempt + 1);
}

/** 统一请求：自动附加当前 access_token 到 x-session（不缓存 token）；会话恢复空窗下对 401 做有界重试 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const isPublic = PUBLIC_PATHS.has(path);
  // 用户主动取消（AbortController）不参与任何重试，直接抛出。
  const aborted = () => init.signal?.aborted === true;

  let token = isPublic ? null : await getAccessToken();
  if (!token && !isPublic) {
    throw new ApiError('请先登录', 401);
  }

  // 仅对 GET 等幂等读请求在「会话恢复空窗」下做一次补试；写请求不自动重试以免重复提交。
  const method = (init.method || 'GET').toUpperCase();
  const retryable = method === 'GET';
  let res = await sendRequest(path, init, token);

  if (res.status === 401 && retryable && !aborted()) {
    // 可能是首屏会话尚未恢复或 token 刚刷新：等待后取最新会话再试一次。
    const fresh = await getAccessToken();
    if (fresh && fresh !== token) {
      token = fresh;
      res = await sendRequest(path, init, token);
    }
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const msg = payload?.error || `请求失败（${res.status}）`;
    throw new ApiError(msg, res.status);
  }
  return payload as T;
}

async function sendRequest(
  path: string,
  init: RequestInit,
  token: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('x-session', token);
  // 含用户数据的接口一律不做 HTTP 缓存：课例元信息等保存后立即 GET 会命中缓存旧值，
  // 表现为「保存成功但页面仍显示未填写」，真机走查已复现。显式 no-store 保证每次读都打到源站。
  return fetch(path, { ...init, headers, cache: 'no-store' });
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, init?: RequestInit) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) }),
  del: <T = unknown>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

// ---------- 业务类型与便捷方法 ----------
export interface StandardSummary {
  id: string;
  code: string;
  name: string;
  version: string;
  subject: string;
  scope: string;
  description: string | null;
  is_active: boolean;
  owner_id: string | null;
  updated_at: string;
}

export interface Lesson {
  id: string;
  user_id?: string;
  title: string;
  teacher_name: string | null;
  school: string | null;
  grade_class: string | null;
  lesson_type: string | null;
  subject: string;
  lesson_date: string | null;
  duration_sec: number | null;
  standard_set_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AssetSummary {
  id: string;
  kind: string;
  file_name: string;
  parse_status: string;
  created_at: string;
}

/** 素材详情：file_url 仅服务端持有（对象 key），前端只拿动态签名 url。 */
export interface Asset {
  id: string;
  kind: string;
  file_name: string;
  file_url?: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  note: string | null;
  parse_status: string;
  created_at: string;
  url?: string | null;
}

export interface AnalysisInput {
  id: string;
  lesson_id: string;
  transcript: string | null;
  transcript_source: string;
  observer_text: string | null;
  /** 学生任务单解析文本（V1.4 通道） */
  task_sheet_text: string | null;
  updated_at: string;
}

/** 文档解析结果（任务单 / 观察记录 → 纯文本） */
export interface ParseAssetResult {
  asset_id: string;
  parse_status: string;
  /** 解析文本落库到的字段名 */
  field: string;
  chars: number;
  preview: string;
}

/** 标准完整对象：content 为评价标准 JSON，结构由评价模块消费，这里用宽松记录类型 */
export type StandardDetail = StandardSummary & { content: Record<string, unknown> };

export interface Profile {
  id: string;
  display_name: string | null;
  role_title: string | null;
  organization: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface LessonDetail extends Lesson {
  assets?: AssetSummary[];
  annotation?: { id: string; version: number; updated_at: string } | null;
  report?: {
    id: string;
    total_score: string;
    total_level: string | null;
    need_review_count: number;
    is_calibrated: boolean;
    updated_at: string;
  } | null;
}

export const lessonsApi = {
  list: () => api.get<{ lessons: Lesson[] }>('/api/lessons').then((r) => r.lessons),
  get: (id: string) => api.get<LessonDetail>(`/api/lessons/${id}`),
  create: (input: Partial<Lesson>) => api.post<{ lesson: Lesson }>('/api/lessons', input).then((r) => r.lesson),
  update: (id: string, input: Partial<Lesson>) =>
    api.patch<{ lesson: Lesson }>(`/api/lessons/${id}`, input).then((r) => r.lesson),
  remove: (id: string) => api.del<{ ok: boolean }>(`/api/lessons/${id}`),
  /** V1.22 分析运行历史：enabled=false 表示目标库尚未创建 report_runs 表 */
  runs: (id: string) =>
    api.get<{ enabled: boolean; runs: RunRecordItem[] }>(`/api/lessons/${id}/runs`),
};

export const standardsApi = {
  list: () => api.get<{ standards: StandardSummary[] }>('/api/standards').then((r) => r.standards),
  get: (id: string) => api.get<{ standard: StandardDetail }>(`/api/standards/${id}`).then((r) => r.standard),
};

export const meApi = {
  get: () => api.get<{ user: { id: string; email?: string; displayName?: string }; profile: Profile | null; platform_admin?: boolean }>('/api/me'),
  update: (input: { display_name?: string | null; role_title?: string | null; organization?: string | null }) =>
    api.patch<{ profile: Profile }>('/api/me', input).then((r) => r.profile),
};

// ---------- 机构与成员（V1.11） ----------
export interface OrgInfo {
  id: string;
  name: string;
  role: string;
  is_owner: boolean;
  /** 仅管理员返回 */
  invite_code: string | null;
}

export interface OrgMember {
  user_id: string;
  display_name?: string | null;
  role: string;
  status: string;
  created_at: string;
}

export interface OrgLessonBrief {
  id: string;
  title: string;
  teacher_name?: string | null;
  grade_class?: string | null;
  status: string;
  visibility?: string | null;
  updated_at: string;
}

export interface OrgPayload {
  org: OrgInfo | null;
  members: OrgMember[];
  lessons?: OrgLessonBrief[];
  stats: { lessons: number; analyzed: number; pending: number } | null;
}

export const orgApi = {
  get: () => api.get<OrgPayload>('/api/org'),
  create: (name: string) => api.post<{ org: OrgInfo }>('/api/org', { name }).then((r) => r.org),
  join: (code: string) => api.post<{ ok: boolean }>('/api/org/join', { code }),
  setRole: (user_id: string, role: string) => api.patch<{ ok: boolean }>('/api/org/members', { user_id, role }),
  remove: (user_id: string) =>
    api.del<{ ok: boolean }>(`/api/org/members?user_id=${encodeURIComponent(user_id)}`),
};


// ---------- 平台总控台（只读） ----------
export interface MePayload {
  user: { id: string; email: string | null; displayName?: string | null };
  profile: Record<string, unknown> | null;
  /** 是否在平台白名单内；决定导航里是否出现「平台总控」入口 */
  platform_admin?: boolean;
}

export interface PlatformStats {
  org_count: number;
  user_count: number;
  member_count: number;
  lesson_count: number;
  report_count: number;
  avg_score: number;
}

export interface PlatformOrg {
  id: string;
  name: string;
  invite_code: string;
  owner_email: string;
  member_count: number;
  lesson_count: number;
  created_at: string;
}

export interface PlatformUser {
  user_id: string;
  email: string;
  joined_at: string;
  role: string;
  org_name: string;
  lesson_count: number;
}

export interface PlatformLesson {
  id: string;
  title: string;
  status: string;
  lesson_type: string;
  teacher_name: string;
  visibility: string;
  org_id: string;
  owner_email: string;
  total_score: number | null;
  report_count: number;
  created_at: string;
}

export interface PlatformPayload {
  stats: PlatformStats;
  orgs: PlatformOrg[];
  users: PlatformUser[];
  lessons: PlatformLesson[];
}

export const platformApi = {
  get: () => api.get<PlatformPayload>('/api/admin'),
};

// ---------- 数据接入：素材文件 + 转写文稿/观察记录 ----------
async function authHeaders(): Promise<Headers> {
  const headers = new Headers();
  // 复用 getAccessToken 的会话空窗重试与 AbortError 兜底：上传/转写这类长请求
  // 不能因为一次会话锁中断就整体失败。
  try {
    const token = await getAccessToken();
    if (token) headers.set('x-session', token);
  } catch {
    // 拿不到 token 就不带头，让服务端按 401 处理，交给调用方提示重新登录。
  }
  return headers;
}

/** 音视频识别为课堂转写文稿的结果 */
export interface TranscribeResult {
  transcript: string;
  truncated: boolean;
  char_count: number;
  duration_ms: number | null;
  /** 时间轴段数（课堂切片用） */
  segment_count?: number;
  /** 逐窗识别的窗口总数 */
  window_count?: number;
  /** 成功对齐的窗口数；与 window_count 差距大说明这次时间轴是近似值 */
  aligned_windows?: number;
  source_kind: 'av_audio' | 'av_video';
}

/** 上传进度事件：loaded/total 为字节数；stage 标记当前阶段（processing = 服务端合成/入库中） */
export type UploadProgress = { loaded: number; total: number; stage: 'uploading' | 'processing' };
type ProgressFn = (p: UploadProgress) => void;

/**
 * 用 XMLHttpRequest 以 multipart/form-data POST。fetch 拿不到上传字节进度，
 * 只有 xhr.upload.onprogress 才能实时反映「已上传多少字节」，用于驱动进度条。
 * 成功返回解析后的 JSON；失败抛 ApiError（带服务端 error 文案与状态码）。
 */
async function postMultipart(
  url: string,
  form: FormData,
  headers: Headers,
  onUpload?: (loaded: number, total: number) => void,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    headers.forEach((value, key) => xhr.setRequestHeader(key, value)); // 复用 authHeaders（x-session 等）
    if (onUpload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onUpload(e.loaded, e.total);
      };
    }
    xhr.onload = () => {
      let payload: unknown = null;
      try { payload = JSON.parse(xhr.responseText); } catch { /* 非 JSON 视为 null */ }
      const obj = payload as { error?: string } | null;
      if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
      else reject(new ApiError(obj?.error || `上传失败（${xhr.status}）`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('网络错误，上传中断，请重试', 0));
    xhr.onabort = () => reject(new ApiError('上传已取消', 0));
    xhr.send(form);
  });
}

/**
 * 大文件分片上传：客户端按 CHUNK_SIZE 切片逐片 POST 到 /assets/chunk（每片 < 128MB 网关上限），
 * 全部成功后 POST /assets/complete 由服务端拼装入 S3、建行。整程只在本地切片，不把大文件读进内存。
 * 平台网关对单请求体硬限 128MB，故整节课录像（数百 MB~GB）必须走此路径。
 * 过程中通过 onProgress 上报字节进度（已完成分片 + 当前片字节累计），全部传完后报 processing。
 */
async function chunkedUpload(
  lessonId: string,
  file: File,
  kind: string,
  note?: string,
  onProgress?: ProgressFn,
): Promise<Asset> {
  const uploadId = crypto.randomUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  for (let i = 0; i < totalChunks; i += 1) {
    const start = i * CHUNK_SIZE;
    const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
    const form = new FormData();
    form.append('kind', kind);
    form.append('uploadId', uploadId);
    form.append('chunkIndex', String(i));
    form.append('totalChunks', String(totalChunks));
    form.append('totalSize', String(file.size));
    form.append('chunk', chunk, `part-${i}`);
    const headers = await authHeaders(); // 每片取新 token，长上传中 token 过期也能续上
    // 进度 = 已完成分片字节 + 当前片已传字节（onUpload 回调逐段上报）
    await postMultipart(
      `/api/lessons/${lessonId}/assets/chunk`,
      form,
      headers,
      onProgress
        ? (loaded) => onProgress({ loaded: i * CHUNK_SIZE + loaded, total: file.size, stage: 'uploading' })
        : undefined,
    );
    // 片传完后对齐到片边界，保证进度单调递增（即便 onprogress 事件较粗也不回退）
    onProgress?.({ loaded: Math.min(start + chunk.size, file.size), total: file.size, stage: 'uploading' });
  }

  // 全部分片已上传，进入服务端合成 / 入 S3 阶段（此时无字节可报，报 processing）
  onProgress?.({ loaded: file.size, total: file.size, stage: 'processing' });

  const headers = await authHeaders();
  headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api/lessons/${lessonId}/assets/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      uploadId,
      kind,
      fileName: file.name || `${kind}.bin`,
      mimeType: file.type || undefined,
      note: note || null,
      totalSize: file.size,
      totalChunks,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(payload?.error || `分片合成失败（${res.status}）`, res.status);
  return payload.asset as Asset;
}

export const assetsApi = {
  list: async (lessonId: string): Promise<Asset[]> => {
    const r = await api.get<{ assets: Asset[] }>(`/api/lessons/${lessonId}/assets`);
    return r.assets;
  },
  upload: async (lessonId: string, file: File, kind: string, note?: string, onProgress?: ProgressFn): Promise<Asset> => {
    // 超过单次阈值（网关 128MB 请求体限制）的大文件走分片上传
    if (file.size > SINGLE_UPLOAD_MAX) return chunkedUpload(lessonId, file, kind, note, onProgress);
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    if (note) form.append('note', note);
    const headers = await authHeaders(); // 不设 Content-Type，浏览器自动带 multipart boundary
    // 单次上传：字节进度上报；传满后转 processing（服务端入 S3 / 建行）阶段
    const payload = await postMultipart(
      `/api/lessons/${lessonId}/assets`,
      form,
      headers,
      onProgress
        ? (loaded, total) =>
            onProgress(
              loaded >= total
                ? { loaded: total, total, stage: 'processing' }
                : { loaded, total, stage: 'uploading' },
            )
        : undefined,
    );
    return (payload as { asset: Asset }).asset;
  },
  remove: (lessonId: string, assetId: string) =>
    api.del<{ ok: boolean }>(`/api/lessons/${lessonId}/assets/${assetId}`),
  /** 触发服务端文档解析（任务单 / 观察记录），幂等可重复调用 */
  parse: (lessonId: string, assetId: string) =>
    api.post<ParseAssetResult>(`/api/lessons/${lessonId}/assets/${assetId}/parse`),
  /** 音视频 ASR 识别为课堂转写文稿（服务端落库 transcript_source='asr'） */
  transcribe: (lessonId: string, assetId: string) =>
    api.post<TranscribeResult>(`/api/lessons/${lessonId}/assets/${assetId}/transcribe`),
};

export const inputsApi = {
  get: async (lessonId: string): Promise<AnalysisInput | null> => {
    const r = await api.get<{ input: AnalysisInput | null }>(`/api/lessons/${lessonId}/inputs`);
    return r.input;
  },
  save: (
    lessonId: string,
    body: {
      transcript?: string | null;
      observer_text?: string | null;
      task_sheet_text?: string | null;
    },
  ) =>
    api.put<{ input: AnalysisInput | null }>(`/api/lessons/${lessonId}/inputs`, body).then((r) => r.input),
  /** AI 为转写文稿逐行标注说话人（教师/学生/齐声/媒体），返回改写后的文稿 */
  labelSpeakers: (lessonId: string, opts?: { signal?: AbortSignal }) =>
    api.post<{ transcript: string; labeled_lines: number; capped: boolean }>(
      `/api/lessons/${lessonId}/transcript/label-speakers`,
      {},
      opts?.signal ? { signal: opts.signal } : undefined,
    ),
};

// ---------- 人工标注（整份 JSON，version 自增） ----------
export interface AnnotationDoc {
  id: string;
  version: number;
  updated_at: string;
}

export interface SaveAnnotationBody {
  seating: Record<string, unknown>;
  role_timeline: unknown[];
  interactions: unknown[];
  events: unknown[];
  phases: unknown[];
  dimension_scores: unknown[];
  observer_sheet: unknown[];
}

export const annotationApi = {
  get: async (
    lessonId: string,
  ): Promise<{ annotation: (AnnotationDoc & { payload?: Partial<SaveAnnotationBody> }) | null }> =>
    api.get<{ annotation: (AnnotationDoc & { payload?: Partial<SaveAnnotationBody> }) | null }>(
      `/api/lessons/${lessonId}/annotation`,
    ),
  save: async (lessonId: string, payload: SaveAnnotationBody) => {
    const r = await api.put<{ annotation: AnnotationDoc }>(`/api/lessons/${lessonId}/annotation`, payload);
    return r.annotation;
  },
};

// ---------- 分析报告（多源融合引擎） ----------
import type { AnalysisReport, DataSource, DimensionInterpretation } from '@/lib/evaluation/types';

export interface StoredReport {
  id: string;
  result: AnalysisReport;
  total_score: number;
  total_level: string | null;
  need_review_count: number;
  is_calibrated: boolean;
  source_weights: Record<DataSource, number> | null;
  created_at?: string;
  updated_at?: string;
}

export interface RunAnalysisBody {
  source_weights?: Partial<Record<DataSource, number>>;
  calibrations?: Array<{
    dimension_code: string;
    final_score: number | null;
    review_note?: string;
  }>;
  /** 是否启用 AI（DeepSeek）语义评分与报告评语；默认启用 */
  use_llm?: boolean;
  /** 运行时指定/覆盖课型（new/review/comment/practice/topic，兼容旧枚举） */
  lesson_type?: string | null;
}

export const analysisApi = {
  get: async (lessonId: string): Promise<StoredReport | null> => {
    const r = await api.get<{ report: StoredReport | null }>(`/api/lessons/${lessonId}/analysis`);
    return r.report;
  },
  run: async (
    lessonId: string,
    body: RunAnalysisBody = {},
    opts?: { signal?: AbortSignal },
  ): Promise<StoredReport> => {
    const r = await api.post<{ report: StoredReport }>(
      `/api/lessons/${lessonId}/analysis`,
      body,
      opts?.signal ? { signal: opts.signal } : undefined,
    );
    return r.report;
  },
  /** 按需生成五维 AI 解读（依据/为什么/怎么读/怎么提升），服务端生成后写回报告 */
  generateInterpretations: async (
    lessonId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<DimensionInterpretation[]> => {
    const r = await api.post<{ interpretations: DimensionInterpretation[] }>(
      `/api/lessons/${lessonId}/analysis/interpretation`,
      {},
      opts?.signal ? { signal: opts.signal } : undefined,
    );
    return r.interpretations ?? [];
  },
  /** 按需生成表一内涵观察点 AI 解读（认知/情感各一段四段长文），服务端生成后写回报告 */
  generateEssenceInterpretations: async (
    lessonId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<DimensionInterpretation[]> => {
    const r = await api.post<{ interpretations: DimensionInterpretation[] }>(
      `/api/lessons/${lessonId}/analysis/essence-interpretation`,
      {},
      opts?.signal ? { signal: opts.signal } : undefined,
    );
    return r.interpretations ?? [];
  },
};

// ---------- 课型（评价模型路由键） ----------
export interface LessonTypeOption {
  value: string;
  label: string;
}
export interface LessonTypeStat {
  code: string;
  name: string;
  viewpoints: number;
  points: number;
}
export interface LessonTypeInfo {
  lesson_type: string | null;
  raw_lesson_type: string | null;
  grade_band: 'primary' | 'junior' | 'senior';
  options: LessonTypeOption[];
  stats: LessonTypeStat[];
}
export interface LessonTypeDetection {
  lesson_type: string;
  lesson_type_name: string;
  confidence: number;
  basis: string;
  model: string;
  candidates: { code: string; score: number }[];
}
export interface ConsistencyItem {
  code: string;
  label: string;
  scores: (number | null)[];
  mean: number | null;
  min: number | null;
  max: number | null;
  gap: number | null;
  std: number | null;
  stable: boolean;
}
export interface ConsistencyReport {
  lesson_id: string;
  lesson_type: string | null;
  lesson_type_name: string | null;
  kind: 'transcript' | 'observer';
  runs: number;
  model: string;
  indicators: ConsistencyItem[];
  lesson_type_points: ConsistencyItem[];
  summary: {
    compared: number;
    stable: number;
    unstable: number;
    avg_gap: number | null;
    max_gap: number | null;
    level: string;
  };
  errors: string[];
  generated_at: string;
}

export const lessonTypeApi = {
  get: (lessonId: string) =>
    api.get<LessonTypeInfo>(`/api/lessons/${lessonId}/lesson-type`),
  detect: (lessonId: string, apply = false) =>
    api
      .post<{ detection: LessonTypeDetection; applied: boolean }>(
        `/api/lessons/${lessonId}/lesson-type`,
        { apply },
      )
      .then((r) => r),
  set: (lessonId: string, lessonType: string | null) =>
    api
      .patch<{ lesson_type: string | null }>(`/api/lessons/${lessonId}/lesson-type`, {
        lesson_type: lessonType,
      })
      .then((r) => r.lesson_type),
};

export const consistencyApi = {
  run: (
    lessonId: string,
    body: { runs?: number; kind?: 'transcript' | 'observer'; lesson_type?: string | null } = {},
  ) =>
    api
      .post<{ consistency: ConsistencyReport }>(
        `/api/lessons/${lessonId}/analysis/consistency`,
        body,
      )
      .then((r) => r.consistency),
};

// ---------- 教研中心（V1.21）：跨课例对比与 AI 教研洞察 ----------
export type { LessonDigest, ResearchGroup, ResearchInsight };

export const researchApi = {
  /** 课例池：默认返回全部已分析课例；传 ids 时按给定顺序返回 */
  lessons: (ids?: string[]) =>
    api
      .get<{ lessons: LessonDigest[] }>(
        ids?.length
          ? `/api/research/lessons?ids=${encodeURIComponent(ids.join(','))}`
          : '/api/research/lessons',
      )
      .then((r) => r.lessons),
  /** 生成跨课例教研洞察（AI 不可用时后端自动降级规则引擎） */
  insight: (lessonIds: string[], rulesOnly = false) =>
    api.post<{ insight: ResearchInsight; degraded: boolean; reason?: string }>(
      '/api/research/insight',
      {
        lesson_ids: lessonIds,
        rules_only: rulesOnly,
      },
    ),
};
