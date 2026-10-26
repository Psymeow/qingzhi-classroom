/**
 * 课堂切片：把报告里基于课堂实录（转写）的证据，挂到视频时间轴上。
 *
 * 两条时间轴来源：
 * ① 结构化 segments（ASR 识别时直接落库，毫秒精度，推荐）；
 * ② 兜底解析「[mm:ss] 文本」逐行转写（手动上传/粘贴的文稿，精度到秒）。
 *
 * 匹配：证据是 AI 摘的原话，与原文可能有标点/个别字差异，沿用 locate.ts 的归一化思路，
 * 但把「全文归一化字符流」与「每个字符所属的段号」一起建索引，一次 indexOf 即可定位到段。
 */

/** 一段转写（时间轴的最小单位） */
export interface TimelineSegment {
  /** 起，毫秒 */
  s: number;
  /** 止，毫秒；原始数据缺 end 时用下一段起点兜底 */
  e: number;
  /** 段文本，不含时间码前缀 */
  t: string;
  /** 说话人（归一化四类：教师 / 学生 / 齐声 / 媒体）；识别或文稿未标注时缺省 */
  speaker?: string;
}

// ---------------- 说话人归一化 ----------------
// 转写稿里的叫法五花八门（老师/师/T、生1/学生A、齐声说/全体、播放/旁白），
// 统一归到教师 / 学生 / 齐声 / 媒体四类，前端标签与配色只认这四个。

const SPEAKER_CANON: Array<[RegExp, string]> = [
  [/^(教师|老师|师|T|Teacher)$/i, '教师'],
  [/^(齐声(说|答|读|齐)?)|齐说|齐读|全体(同学|学生)?|合(说|答|读)$/, '齐声'],
  [/^(媒体|播放(的)?(录音|音视频)?|录音|视频|旁白|音频|M|Media)$/i, '媒体'],
  [/^(学生|同学|生\d*|学生\d*|男生|女生|S\d*)$/i, '学生'],
];

/** 说话人标签归一化；无法识别的叫法原样返回（不硬塞进四类，避免误导） */
export function normalizeSpeaker(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  for (const [re, canon] of SPEAKER_CANON) {
    if (re.test(s)) return canon;
  }
  return s.slice(0, 8);
}

// 行首时间（区间）：[00:01 - 00:02] / [00:01] / 00:01:20 / 00:01-00:02 均可
const TIME_RANGE_RE =
  /^\s*\[?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*(?:[-~—]\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*)?\]?\s*/;
// 紧随时间码之后的说话人：[教师] / [齐声说] / 教师：/ 生1:（仅词表命中才算，防止把正文冒号误判成说话人）
const LEAD_SPEAKER_BRACKET = /^\[([^\]]{1,8})\]\s*[:：]?\s*/;
const LEAD_SPEAKER_COLON = /^([一-龥]{1,4}|[A-Za-z]\d?)\s*[:：]\s*/;

interface ParsedLine {
  s: number;
  e: number | null;
  speaker?: string;
  text: string;
}

/** 行首元信息（时间码 + 说话人）剥离结果；供时间轴解析与语义评分共用 */
export interface LeadMeta {
  /** 行首时间码起点（毫秒）；无时间码时为 null */
  s: number | null;
  /** 行首区间终点（毫秒）；无区间或区间非法时为 null */
  e: number | null;
  speaker?: string;
  text: string;
}

/**
 * 剥离一行的行首时间码与说话人标签：
 * `[00:01 - 00:02][教师]: 好，上课！` / `00:01:20 师：请看大屏幕` / `师：请看 08:12 处` 均可。
 * 说话人只认词表命中（教师/学生/齐声/媒体及其常见叫法），防止把正文冒号误判成说话人。
 */
export function stripLeadMeta(line: string): LeadMeta {
  const tm = line.match(TIME_RANGE_RE);
  let s: number | null = null;
  let e: number | null = null;
  let rest = line;
  if (tm) {
    const start = clockToMs(tm[1]);
    if (start !== null) {
      s = start;
      const end = tm[2] ? clockToMs(tm[2]) : null;
      e = end !== null && end > start ? end : null;
      rest = line.slice(tm[0].length);
    }
  }
  let speaker: string | undefined;
  const br = rest.match(LEAD_SPEAKER_BRACKET);
  if (br) {
    const canon = normalizeSpeaker(br[1]);
    if (canon) speaker = canon;
    rest = rest.slice(br[0].length);
  } else {
    const co = rest.match(LEAD_SPEAKER_COLON);
    if (co) {
      const canon = normalizeSpeaker(co[1]);
      // 词表命中的短词+冒号才当说话人；「问题：xxx」这类正文开头不吞
      if (canon && SPEAKER_CANON.some(([re]) => re.test(co[1].trim()))) {
        speaker = canon;
        rest = rest.slice(co[0].length);
      }
    }
  }
  return { s, e, speaker, text: rest.trim() };
}

/** 解析一行「[mm:ss - mm:ss][说话人]: 文本」；无时间码的行返回 null（并入上一段） */
function parseTimedLine(line: string): ParsedLine | null {
  const m = stripLeadMeta(line);
  if (m.s === null) return null;
  return { s: m.s, e: m.e, speaker: m.speaker, text: m.text };
}

/** 把 mm:ss / hh:mm:ss 换成毫秒；非法返回 null */
export function clockToMs(clock: string): number | null {
  const parts = clock.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
}

/** 毫秒 -> mm:ss（超过一小时给 hh:mm:ss） */
export function msToClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 兜底：从转写文本解析时间轴。支持两类行首：
 * - 逐行时间码：`[08:12] 老师说……` / `08:12 老师说……`
 * - 区间 + 说话人：`[00:01 - 00:02][教师]: 好，上课！`
 * 没有时间码的行并入上一段（不单独成段），第一段之前的内容丢弃（无时间无法定位）。
 */
export function segmentsFromTranscript(text: string): TimelineSegment[] {
  if (!text) return [];
  const segs: TimelineSegment[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseTimedLine(line);
    if (parsed) {
      segs.push({
        s: parsed.s,
        e: parsed.e ?? parsed.s,
        t: parsed.text,
        ...(parsed.speaker ? { speaker: parsed.speaker } : {}),
      });
    } else if (segs.length && line.trim()) {
      // 无时间码的续行：并到上一段
      const last = segs[segs.length - 1];
      last.t = `${last.t} ${line.trim()}`.trim();
    }
  }
  segs.sort((a, b) => a.s - b.s);
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].e <= segs[i].s) {
      // end 缺失：用下一段起点，最后一段给 +8 秒（一句课堂口语的典型长度）
      segs[i].e = i + 1 < segs.length ? segs[i + 1].s : segs[i].s + 8000;
    }
  }
  return segs;
}

/** 规范化 segments：按起点排序、补 end、丢弃空段、透传说话人 */
export function normalizeSegments(input: unknown): TimelineSegment[] {
  if (!Array.isArray(input)) return [];
  const out: TimelineSegment[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { s?: unknown; e?: unknown; t?: unknown; speaker?: unknown };
    const s = Number(r.s);
    const e = Number(r.e);
    const t = typeof r.t === 'string' ? r.t.trim() : '';
    if (!Number.isFinite(s) || s < 0 || !t) continue;
    const speaker = typeof r.speaker === 'string' ? normalizeSpeaker(r.speaker) : '';
    out.push({ s, e: Number.isFinite(e) && e > s ? e : s, t, ...(speaker ? { speaker } : {}) });
  }
  out.sort((a, b) => a.s - b.s);
  for (let i = 0; i < out.length; i++) {
    if (out[i].e <= out[i].s) {
      out[i].e = i + 1 < out.length ? out[i + 1].s : out[i].s + 8000;
    }
  }
  return out;
}

// ---------------- 证据 -> 段 定位 ----------------

/**
 * 归一化时剔除的字符：空白与中英文标点。
 * 用码点转义而非直接写全角符号——全角标点经过消息传输/落盘容易被改写成等价字符，
 * 一旦字符类变形，证据就再也匹配不上原文。
 */
const STRIP_SRC =
  '[\\s\\u3000\\u0027",.;:?!\\uFF0C\\u3002\\u3001\\uFF1B\\uFF1A\\uFF1F\\uFF01\\u201C\\u201D\\u2018\\u2019\\uFF08\\uFF09()\\u3010\\u3011\\u300A\\u300B<>\\u2014\\u2026\\u00B7-]';
const PUNCT = new RegExp(STRIP_SRC);
const PUNCT_ALL = new RegExp(STRIP_SRC, 'g');

/** 归一化字符流 + 每个字符所属段号，供一次 indexOf 定位 */
interface SegmentIndex {
  chars: string;
  /** 与 chars 等长：该字符属于第几段 */
  segOf: number[];
}

function buildIndex(segments: TimelineSegment[]): SegmentIndex {
  const chars: string[] = [];
  const segOf: number[] = [];
  segments.forEach((seg, i) => {
    for (const ch of seg.t) {
      if (PUNCT.test(ch)) continue;
      chars.push(ch);
      segOf.push(i);
    }
  });
  return { chars: chars.join(''), segOf };
}

function normalize(s: string): string {
  return s.replace(PUNCT_ALL, '');
}

/**
 * 为一段引文找所属转写段。策略与 locateQuote 一致：
 * ① 整句归一化命中；② 前 60% 切片；③ 中部 40% 切片。
 */
export function findSegment(index: SegmentIndex, quote: string): number | null {
  const needle = normalize(quote);
  if (!needle) return null;
  const hit = (n: string): number | null => {
    if (n.length < 6) return null; // 过短易误命中
    const at = index.chars.indexOf(n);
    return at < 0 ? null : index.segOf[at];
  };
  const len = needle.length;
  return (
    hit(needle) ??
    hit(needle.slice(0, Math.ceil(len * 0.6))) ??
    hit(needle.slice(Math.floor(len * 0.3), Math.floor(len * 0.3) + Math.ceil(len * 0.4)))
  );
}

/** 全局跳转事件：报告证据、时间轴圆点 → 课堂播放器（LessonPlayer 监听执行） */
export const SEEK_EVENT = 'qz:seek';

export interface SeekDetail {
  /** 目标位置，毫秒 */
  ms: number;
  /** 来源说明（指标 code / 模块名），便于排障 */
  reason?: string;
}

/** 派发一次跳转请求；由 LessonPlayer 接收并把播放头移到对应时刻 */
export function seekTo(ms: number, reason?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SeekDetail>(SEEK_EVENT, { detail: { ms, reason } }));
}

/** 时间轴上的一个证据点 */
export interface TimelineMarker {
  /** 落在第几段 */
  segIndex: number;
  startMs: number;
  endMs: number;
  /** 该段原文（报告里点击后展示） */
  text: string;
  /** AI 摘的那句证据（可能与原文有出入） */
  quote: string;
}

/**
 * 把一组证据挂到时间轴上：命中段 -> 标记点。
 * 同一段被多条证据命中时合并（时间轴上不重复打点），保留第一条引文。
 */
export function markersFor(segments: TimelineSegment[], quotes: Array<string | null | undefined>): TimelineMarker[] {
  if (!segments.length) return [];
  const index = buildIndex(segments);
  const seen = new Set<number>();
  const out: TimelineMarker[] = [];
  for (const q of quotes) {
    if (!q || !q.trim()) continue;
    const segIndex = findSegment(index, q);
    if (segIndex === null || seen.has(segIndex)) continue;
    seen.add(segIndex);
    const seg = segments[segIndex];
    out.push({ segIndex, startMs: seg.s, endMs: seg.e, text: seg.t, quote: q.trim() });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}
