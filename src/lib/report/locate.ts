/**
 * P1-1 证据结构化定位：点击报告中的证据 → 跳转到数据接入区对应原文并选中。
 *
 * 设计：
 * - 证据由 AI 生成，与原文可能有标点/个别字差异，因此做「归一化 + 多段切片」模糊匹配；
 * - 文本缓存由 DataIntake 在回填/编辑时维护，避免重复请求接口；
 * - 跨组件通信用 window CustomEvent（详情页内各区块竖排，无需 props 透传）。
 */

export type LocateSource = 'av_transcript' | 'observer_note' | 'task_sheet' | 'lesson_plan' | 'manual_annotation';

export const LOCATE_EVENT = 'qzc:locate-evidence';

export interface LocateDetail {
  source: LocateSource;
  quote: string;
}

export function dispatchLocate(source: LocateSource, quote: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<LocateDetail>(LOCATE_EVENT, { detail: { source, quote } }));
}

// ---------------- 文本缓存（供时间戳展示等只读用途） ----------------

const textCache: Partial<Record<LocateSource, string>> = {};

export function setSourceText(source: LocateSource, text: string | null | undefined): void {
  textCache[source] = text ?? '';
}

export function getSourceText(source: LocateSource): string {
  return textCache[source] ?? '';
}

// ---------------- 归一化匹配 ----------------

const TIMESTAMP_RE = /(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?/g;

/** 归一化：去时间码、去所有空白与常见标点，仅保留中英文/数字等实义字符。 */
function normalize(s: string): string {
  return s
    .replace(TIMESTAMP_RE, '')
    .replace(/[\s\u3000，。、；：？！,.;:?！“”"'‘’（）()【】《》<>—…·\-]/g, '');
}

/**
 * 在原文中定位引文，返回原文起止索引；找不到返回 null。
 * 策略：① 整句归一化包含；② 引文前 60% 切片；③ 引文中部 40% 切片。
 */
export function locateQuote(haystack: string, quote: string): { start: number; end: number } | null {
  if (!haystack || !quote) return null;

  // 直接在原文上构建「实义字符流」并跳过时间码区间
  const chars: string[] = [];
  const origIdx: number[] = [];
  const tsRe = new RegExp(TIMESTAMP_RE.source, 'g');
  const tsRanges: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = tsRe.exec(haystack)) !== null) {
    tsRanges.push([m.index, m.index + m[0].length]);
  }
  const inTs = (i: number) => tsRanges.some(([a, b]) => i >= a && i < b);
  const punct = /[\s\u3000，。、；：？！,.;:?！“”"'‘’（）()【】《》<>—…·\-]/;
  for (let i = 0; i < haystack.length; i++) {
    if (inTs(i)) continue;
    const ch = haystack[i];
    if (punct.test(ch)) continue;
    chars.push(ch);
    origIdx.push(i);
  }
  const hayNorm = chars.join('');
  const needleNorm = normalize(quote);
  if (!needleNorm) return null;

  // 实义字符流跳过了时间码，映射回原文时区间可能跨过句中时间码，
  // 把选区结束位置截断到区间内第一个时间码之前，避免高亮带进下一句话。
  const trimRange = (start: number, end: number): { start: number; end: number } => {
    const cross = tsRanges.find(([a]) => a >= start && a < end);
    return cross ? { start, end: cross[0] } : { start, end };
  };

  const tryAt = (nStart: number, nLen: number): { start: number; end: number } | null => {
    const seg = needleNorm.slice(nStart, nStart + nLen);
    if (seg.length < 6) return null; // 过短片段易误命中
    const at = hayNorm.indexOf(seg);
    if (at < 0) return null;
    return trimRange(origIdx[at], origIdx[at + seg.length - 1] + 1);
  };

  const full = hayNorm.indexOf(needleNorm);
  if (full >= 0) return trimRange(origIdx[full], origIdx[full + needleNorm.length - 1] + 1);

  const len = needleNorm.length;
  return (
    tryAt(0, Math.ceil(len * 0.6)) ??
    tryAt(Math.floor(len * 0.3), Math.ceil(len * 0.4)) ??
    null
  );
}

/** 找原文某位置之前最近的时间码，返回 mm:ss（或 hh:mm:ss 原样）。 */
export function nearestTimestamp(text: string, index: number): string | null {
  const re = new RegExp(TIMESTAMP_RE.source, 'g');
  let last: string | null = null;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text)) !== null) {
    if (mm.index > index) break;
    last = mm[0];
  }
  if (!last) return null;
  const parts = last.split(':');
  if (parts.length === 3) {
    const total = Number(parts[0]) * 60 + Number(parts[1]);
    return `${String(total).padStart(2, '0')}:${parts[2]}`;
  }
  return last;
}
