/**
 * 课堂实录的时间轴能力（V1.14 课堂切片的基础设施）。
 *
 * 平台 ASR 只回一段纯文本，不返回任何分段或时间戳
 * （实测 result.utterances 与 result.duration 恒为 undefined，rawData 里也只有 text），
 * 所以时间轴必须自己造。两条路径都从这里出发：
 *   ① ideal：按窗切分后逐窗识别（见 window-asr.ts），窗口边界绝对准确；
 *   ② fallback：整段文本按「有声时段」比例铺开，精度只到句子级。
 * 两者共用同一套「句子切分 + 静音区间 -> 时间」的映射。
 */

import { spawn } from 'node:child_process';

/** 一段转写（时间轴的最小单位），时间为毫秒 */
export type AsrSegment = { s: number; e: number; t: string };

export interface AudioProbe {
  durationMs: number;
  silences: Array<{ s: number; e: number }>;
}

export interface TimedTranscript {
  text: string;
  segments: AsrSegment[];
  truncated: boolean;
  durationMs: number;
}

/**
 * 用 ffmpeg 探测音轨总时长与静音区间（一次解码，不落文件）。
 *
 * 为什么需要静音区间：课堂里大量时间在练习、板书、巡视（几乎无声），
 * 若按总时长线性铺开文本，误差会一路累积到几分钟。先扣掉静音、
 * 文本只铺在「有声」时段上，误差才收得住。
 */
export function probeAudioTimeline(input: string): Promise<AudioProbe> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-hide_banner',
      '-i',
      input,
      '-af',
      'silencedetect=noise=-35dB:d=0.5',
      '-f',
      'null',
      '-',
    ]);
    let buf = '';
    p.stderr.on('data', (d: Buffer) => {
      buf += d.toString();
      if (buf.length > 4000000) buf = buf.slice(-2000000);
    });
    p.on('error', (e) => reject(new Error(`ffmpeg 无法启动：${e.message}`)));
    p.on('close', () => {
      let durationMs = 0;
      const dm = buf.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (dm) {
        durationMs = Math.round((Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3])) * 1000);
      }
      const starts: number[] = [];
      let m: RegExpExecArray | null;
      const reStart = /silence_start:\s*(-?\d+(?:\.\d+)?)/g;
      while ((m = reStart.exec(buf)) !== null) starts.push(Number(m[1]) * 1000);
      const ends: number[] = [];
      const reEnd = /silence_end:\s*(-?\d+(?:\.\d+)?)/g;
      while ((m = reEnd.exec(buf)) !== null) ends.push(Number(m[1]) * 1000);
      const silences: Array<{ s: number; e: number }> = [];
      for (let k = 0; k < starts.length; k++) {
        const s = Math.max(0, starts[k]);
        const e = k < ends.length ? ends[k] : durationMs;
        if (e > s) silences.push({ s, e });
      }
      resolve({ durationMs, silences });
    });
  });
}

/**
 * 按句读把 ASR 文本切开。ASR 只给连续文本、没有分段，
 * 这里按句末标点切；过长的口语长句再按逗号二次切，保证每句都能挂上一个时刻。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const rough = text.split(/(?<=[\u3002\uFF01\uFF1F!?\uFF1B;\n])/);
  for (const r of rough) {
    const s = r.trim();
    if (!s) continue;
    if (s.length <= 60) {
      out.push(s);
      continue;
    }
    let buf = '';
    for (const part of s.split(/(?<=[\uFF0C,\u3001])/)) {
      if (buf && (buf + part).length > 60) {
        out.push(buf);
        buf = part;
      } else {
        buf += part;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/** 从 [0, duration] 里扣掉静音，得到「有声」区间 */
export function voicedRanges(
  durationMs: number,
  silences: Array<{ s: number; e: number }>,
): Array<{ s: number; e: number }> {
  const sorted = [...silences].sort((a, b) => a.s - b.s);
  const out: Array<{ s: number; e: number }> = [];
  let cursor = 0;
  for (const g of sorted) {
    const gs = Math.max(cursor, Math.min(g.s, durationMs));
    if (gs > cursor) out.push({ s: cursor, e: gs });
    cursor = Math.max(cursor, Math.min(g.e, durationMs));
  }
  if (cursor < durationMs) out.push({ s: cursor, e: durationMs });
  return out.filter((r) => r.e > r.s + 200);
}

/** 把全局静音区间裁剪到 [s, e) 窗口内（窗口识别复用一次探测结果，避免逐窗解码） */
export function clipSilences(
  silences: Array<{ s: number; e: number }>,
  s: number,
  e: number,
): Array<{ s: number; e: number }> {
  const out: Array<{ s: number; e: number }> = [];
  for (const g of silences) {
    const gs = Math.max(g.s, s);
    const ge = Math.min(g.e, e);
    if (ge > gs + 200) out.push({ s: gs, e: ge });
  }
  return out;
}

/** 「有声毫秒偏移」-> 真实时间毫秒 */
export function voicedOffsetToReal(
  ranges: Array<{ s: number; e: number }>,
  offsetMs: number,
): number {
  let acc = 0;
  for (const r of ranges) {
    const len = r.e - r.s;
    if (offsetMs <= acc + len) return r.s + (offsetMs - acc);
    acc += len;
  }
  return ranges.length ? ranges[ranges.length - 1].e : 0;
}

/**
 * 文本 + 音轨时间信息 -> 转写文稿与分段时间轴。
 *
 * 把句子按字符数均匀铺在「有声」时段上，得到每句的起止时间。
 * 用于两条路径：整段文本的兜底映射，以及单个窗口内的句级对齐
 * （窗口内时长只有几十秒，误差被限制在相邻句之间）。
 */
export function buildTimedTranscript(
  text: string,
  durationMs: number,
  silences: Array<{ s: number; e: number }>,
  maxChars: number,
): TimedTranscript {
  const plain = (text ?? '').trim();
  const clipped = plain.slice(0, maxChars);
  const truncated = plain.length > maxChars;
  if (!clipped) return { text: '', segments: [], truncated: false, durationMs };

  const sentences = splitSentences(clipped);
  const ranges = durationMs > 0 ? voicedRanges(durationMs, silences) : [];
  const voicedTotal = ranges.reduce((n, r) => n + (r.e - r.s), 0);
  if (!sentences.length || voicedTotal <= 0) {
    return { text: clipped, segments: [], truncated, durationMs };
  }

  const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;
  const segments: AsrSegment[] = [];
  let charAcc = 0;
  for (const s of sentences) {
    const startOff = (charAcc / totalChars) * voicedTotal;
    charAcc += s.length;
    const endOff = (charAcc / totalChars) * voicedTotal;
    const start = Math.round(voicedOffsetToReal(ranges, startOff));
    const end = Math.round(voicedOffsetToReal(ranges, endOff));
    segments.push({ s: start, e: Math.max(end, start + 800), t: s });
  }
  return { text: clipped, segments, truncated, durationMs };
}
