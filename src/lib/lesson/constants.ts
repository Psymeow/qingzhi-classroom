// 课型与状态的展示映射
// 课型枚举已对齐《AIC 课型手册 1.0》数学部分的 5 个课型（新授/复习/讲评/实践/专题）；
// 旧枚举（exercise / inquiry / *_lesson）通过 normalizeLessonType 兼容映射，避免历史课例显示为空。
import {
  LESSON_TYPE_LIST,
  LESSON_TYPE_MODELS,
  normalizeLessonType,
  type LessonTypeCode,
} from '@/lib/evaluation/lesson-type-models';

export const LESSON_TYPES: { value: LessonTypeCode; label: string }[] = LESSON_TYPE_LIST;

/** 课型简称（空间受限的标签位使用） */
export const LESSON_TYPE_SHORT: Record<string, string> = {
  new: '新授',
  review: '复习',
  comment: '讲评',
  practice: '实践',
  topic: '专题',
};

export function lessonTypeLabel(value?: string | null): string {
  if (!value) return '未设置';
  const normalized = normalizeLessonType(value);
  return normalized ? LESSON_TYPE_MODELS[normalized].name : value;
}

export function lessonTypeShort(value?: string | null): string {
  const normalized = normalizeLessonType(value);
  if (!normalized) return '未设置';
  return LESSON_TYPE_SHORT[normalized] ?? LESSON_TYPE_MODELS[normalized].name;
}

export const LESSON_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: '待分析', cls: 'bg-slate-100 text-slate-600' },
  analyzed: { label: '已分析', cls: 'bg-blue-100 text-blue-700' },
  reviewed: { label: '已复核', cls: 'bg-emerald-100 text-emerald-700' },
};

export function statusMeta(value?: string | null) {
  return LESSON_STATUS[value ?? 'draft'] ?? LESSON_STATUS.draft;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 把 ISO 时间转成老师能看懂的相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期。
 * 时间非法或缺失时返回空串，由调用方决定回退文案（避免把「—」这类占位符拼进句子里）。
 */
export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚'; // 服务器时钟略快于本地时，按「刚刚」处理
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDate(iso);
}
