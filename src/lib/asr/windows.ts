/**
 * 逐窗识别：把课堂音轨切成固定窗口分别识别，用窗口边界给文本定位。
 *
 * 为什么需要它：平台 ASR 不返回分段（见 timeline.ts 顶部说明），整段一次识别
 * 只能靠「按字数比例铺在音轨上」，误差会累积到十几秒到几十秒。
 * 切成窗口后，每窗文本的绝对时间由窗口边界确定，误差被关在窗内，
 * 窗内再用静音停顿对齐到句，句子级精度可到数秒。
 *
 * 实测（90 秒音轨 POC）：流复制切窗边界误差 ≤0.06 秒；单窗识别约 2.2 秒且以固定
 * 开销为主，与窗长弱相关；60 秒窗内可获得 14~20 个停顿锚点。
 * 45 分钟课 = 45 个窗，并发 8 路约 15~25 秒跑完。
 */

import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ASRClient } from 'coze-coding-dev-sdk';
import { deleteObject, signObjectUrl, uploadObject } from '@/lib/storage/s3';
import {
  buildTimedTranscript,
  clipSilences,
  type AsrSegment,
  type AudioProbe,
} from './timeline';

/** 窗口长度：60 秒。30 秒窗每个边界约 2/3 会切断句子，60 秒把边界数量减半。 */
export const WINDOW_MS = 60_000;
/** 并发上限：单窗是网络型 IO（上传 + 识别），8 路实测稳定。 */
export const WINDOW_CONCURRENCY = 8;
/** 至少这么多比例的窗口识别成功，才认为逐窗对齐可用；否则退回整段映射。 */
const MIN_OK_RATIO = 0.6;

export interface WindowAlignResult {
  segments: AsrSegment[];
  windowCount: number;
  okCount: number;
}

/** 逐窗对齐结果是否够格替换兜底时间轴 */
export function alignmentAcceptable(r: WindowAlignResult): boolean {
  return (
    r.windowCount > 0 && r.okCount >= Math.ceil(r.windowCount * MIN_OK_RATIO) && r.segments.length > 0
  );
}

/** 把可访问的音频 URL 落到本地，供后续原地切窗（避免每个窗口重复拉流） */
export async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`音轨下载失败：HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
}

/** 流复制切窗：不重编码，MP3 按帧切分，边界误差在一帧（约 26ms）量级 */
function cutWindow(input: string, startMs: number, lenMs: number, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      (startMs / 1000).toFixed(3),
      '-t',
      (lenMs / 1000).toFixed(3),
      '-i',
      input,
      '-c',
      'copy',
      out,
    ]);
    p.on('error', (e) => reject(new Error(`ffmpeg 无法启动：${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 切窗失败（退出码 ${code}）`));
    });
  });
}

/** 小并发池：保持结果顺序，单次失败不影响其他项 */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 平台 ASR 返回的文本可能在顶层，也可能在 rawData.result 下 */
function textOf(result: unknown): string {
  const r = result as { text?: string; rawData?: { result?: { text?: string } } };
  return (r.text ?? r.rawData?.result?.text ?? '').trim();
}

/**
 * 主入口：按窗识别并拼出绝对时间的时间轴。
 *
 * 每个窗口：切分 -> 上传临时对象 -> 识别 -> 删临时对象 -> 窗内句级对齐。
 * 临时对象用完即删，不在对象存储里堆积。
 */
export async function buildWindowSegments(opts: {
  asr: ASRClient;
  uid: string;
  /** 本地音轨路径（视频走已抽出的音轨，音频走下载后的原文件） */
  sourcePath: string;
  probe: AudioProbe;
  workdir: string;
  maxChars: number;
}): Promise<WindowAlignResult> {
  const { asr, uid, sourcePath, probe, workdir, maxChars } = opts;
  const total = probe.durationMs;
  if (total <= 0) return { segments: [], windowCount: 0, okCount: 0 };

  const windows: Array<{ i: number; s: number; e: number }> = [];
  for (let s = 0; s < total; s += WINDOW_MS) {
    windows.push({ i: windows.length, s, e: Math.min(s + WINDOW_MS, total) });
  }

  const results = await mapLimit(windows, WINDOW_CONCURRENCY, async (w) => {
    const out = path.join(workdir, `win_${w.i}.mp3`);
    try {
      await cutWindow(sourcePath, w.s, w.e - w.s, out);
      const buf = await readFile(out);
      if (!buf.byteLength) throw new Error('切窗结果为空');
      const key = await uploadObject(
        buf,
        `u_${uid}/asr_win`,
        `w${w.i}_${Date.now()}.mp3`,
        'audio/mpeg',
      );
      let text = '';
      try {
        const url = await signObjectUrl(key);
        const r = await asr.recognize({ uid, url });
        text = textOf(r);
      } finally {
        await deleteObject(key).catch(() => {});
      }
      if (!text) throw new Error('该窗无识别结果');
      // 窗内静音：复用整段一次探测的结果，裁到窗口区间并平移
      const local = clipSilences(probe.silences, w.s, w.e).map((g) => ({
        s: g.s - w.s,
        e: g.e - w.s,
      }));
      const built = buildTimedTranscript(text, w.e - w.s, local, maxChars);
      return {
        ok: true as const,
        segments: built.segments.map((seg) => ({
          s: seg.s + w.s,
          e: seg.e + w.s,
          t: seg.t,
        })),
      };
    } catch {
      return { ok: false as const, segments: [] as AsrSegment[] };
    } finally {
      await rm(out, { force: true }).catch(() => {});
    }
  });

  const okResults = results.filter((r) => r.ok);
  const segments = okResults.flatMap((r) => r.segments).sort((a, b) => a.s - b.s);
  return { segments, windowCount: windows.length, okCount: okResults.length };
}
