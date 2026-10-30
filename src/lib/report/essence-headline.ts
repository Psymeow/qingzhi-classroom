// ============================================================
// 情智判读（纯逻辑，中立模块）
// 原本定义在 EssenceOnePager.tsx（首行 'use client'）里，被 export-docx.ts 引用。
// Next.js 下服务端模块调用 client 模块的普通导出会抛错，导致 Word 导出 500。
// 这里抽出为无 'use client'/'use server' 标记的中立文件，页面与 Word 两侧共用。
// ============================================================

import type { AnalysisReport, EssenceHeadline } from '@/lib/evaluation/types';
import { bandLevelOf100 } from '@/lib/evaluation/engine';
export function deriveEssenceHeadline(report: AnalysisReport): EssenceHeadline {
  // 认知/情感取自五维直评口径（D2 / D3），与下方五维表同源同尺。
  // 早期版本取的是 essence_eval 的观察点链（chain 口径），结果同一个域在同一页上
  // 出现两个不同数字、方向还相反（本例内涵链 35<36、五维链 54>51），读者无从判断。
  const dimScore = (code: string) =>
    report.dimension_results.find((d) => d.dimension_code === code)?.score ?? null;
  // V1.32 摘掉「融合落地」卡：D1「情智融合设计」量教案里的设计意图（应然），
  // D4「情智共生实施」量课堂实际发生（实然），把「想的」和「做的」平均，
  // 得到的数既不代表设计水平也不代表实施水平；且落差才是信息，平均恰恰把
  // 「设计好但落地打折」这个最该被看见的信号抹掉了。D1/D4 的正位在下方五维表。
  const to100 = (v: number | null) => (v === null ? null : v * 10);

  const cog = to100(dimScore('D2'));
  const aff = to100(dimScore('D3'));

  // 档位名直接复用 bandLevelOf100：与下方五维表同一套尺子，
  // 避免出现「同一分数五维说中等、情智说起步」的口径冲突。
  const cogBand = cog === null ? null : bandLevelOf100(cog);
  const affBand = aff === null ? null : bandLevelOf100(aff);

  // 判定的是两向度的关系形态，不是共同水平，更不做高低优劣比较。
  // 阈值见 ESSENCE_GAP_THRESHOLD（未标定的默认值，待真实课例标定后再固化）。
  let state: EssenceHeadline['state'] = 'insufficient';
  if (cog !== null && aff !== null) {
    const gap = cog - aff;
    if (Math.abs(gap) <= ESSENCE_GAP_THRESHOLD) state = 'parallel';
    else if (gap > ESSENCE_GAP_THRESHOLD) state = 'cog_ahead';
    else state = 'aff_ahead';
  }

  const availability = Object.values(report.source_availability ?? {}) as boolean[];
  const indicatorTotal = report.dimension_results.reduce((n, d) => n + d.indicators.length, 0);
  const indicatorScored = report.dimension_results.reduce(
    (n, d) => n + d.indicators.filter((i) => i.score !== null && i.score !== undefined).length,
    0,
  );

  return {
    cognitive_100: cog,
    affective_100: aff,
    cognitive_band: cogBand,
    affective_band: affBand,
    state,
    material_ready: availability.filter(Boolean).length,
    material_total: availability.length,
    indicator_scored: indicatorScored,
    indicator_total: indicatorTotal,
  };
}

/**
 * 「两线并进」的判定阈值（0-100 制）。
 * 15 分 = 0-10 制的 1.5 分 ≈ 0.75 个档位间距（相邻档位间距为 20 分）。
 *
 * **未标定。** 该值按「差距明显但尚未跨档」的直觉设定，尚未用真实课例校准。
 * 标定方法：取 10 节以上真实课例，由教研员独立判读其两向度是否构成「重心偏移」，
 * 再回推分差分布，取能最大程度复现人工判读的切分点。
 * 标定前，对外不要把这个判定表述为已验证有效。
 */
export const ESSENCE_GAP_THRESHOLD = 15;

export const STATE_META: Record<
  EssenceHeadline['state'],
  { label: string; desc: string; badge: string; ring: string }
> = {
  // 关系形态（不是水平档，也不是优劣判定）：只说哪一侧走得更前。
  // 配色沿用原语义：并进=emerald、有前后=sky、缺材料=muted；
  // 关系形态不是警示，故不用 amber / 红色。
  parallel: {
    label: '两线并进',
    desc: '两个向度的水平接近，这节课两条线走得比较齐。',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    ring: 'from-emerald-50/80',
  },
  cog_ahead: {
    label: '认知侧走得更前',
    desc: '认知侧的推进比情感侧更明显，学生在思考上走得更远，投入感还没跟上。',
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    ring: 'from-sky-50/80',
  },
  aff_ahead: {
    label: '情感侧走得更前',
    desc: '情感侧的投入比认知推进更明显，学生愿意参与，深度思考还没跟上。',
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    ring: 'from-sky-50/80',
  },
  insufficient: {
    label: '材料待补',
    desc: '还差课堂转写或观察点材料，补齐后可以重新生成判读。',
    badge: 'bg-muted text-muted-foreground border-border',
    ring: 'from-muted/60',
  },
};

// 四档通用：说明这是重心位置而非好坏。必须每档都显示，否则教师会把「走得更前」读成更好。
export const NOT_A_VERDICT =
  '这只是说明这节课的重心在哪一侧，不是好坏判断。两个向度衡量的是不同的东西，不该比高低。';
