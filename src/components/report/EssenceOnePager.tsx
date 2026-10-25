'use client';

import { Brain, Heart, Gauge, Sparkles, Target, ChevronDown, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { AnalysisReport, EssenceHeadline } from '@/lib/evaluation/types';

// ============================================================
// 情智相长 · 一页速读（V1.11）
// 目的：把「认知侧」「情感侧」「两者如何相互支撑」放在报告最前面，
//       让校长/教研员 30 秒内拿到本课的情智判读，全量证据链仍在下方。
// 数据全部由已有报告派生，不新增采集、不新增评分。
// ============================================================

/** 从报告派生情智速读指标（纯函数，便于复用与复核） */
export function deriveEssenceHeadline(report: AnalysisReport): EssenceHeadline {
  const ess = report.essence_eval ?? null;
  const cog = ess?.llm_used ? (ess.cognitive.score_100 ?? null) : null;
  const aff = ess?.llm_used ? (ess.affective.score_100 ?? null) : null;
  const gap = cog !== null && aff !== null ? Math.abs(cog - aff) : null;

  const dimScore = (code: string) =>
    report.dimension_results.find((d) => d.dimension_code === code)?.score ?? null;
  const d1 = dimScore('D1');
  const d4 = dimScore('D4');
  const fusionParts = [d1, d4].filter((x): x is number => x !== null);
  const fusion = fusionParts.length
    ? fusionParts.reduce((a, b) => a + b, 0) / fusionParts.length
    : null;

  let state: EssenceHeadline['state'] = 'insufficient';
  if (cog !== null && aff !== null) {
    if (gap !== null && gap <= 10) {
      if (cog >= 70 && aff >= 70) state = 'synergy';
      else if (cog < 60 && aff < 60) state = 'both_weak';
      else state = 'parallel';
    } else if (cog - aff > 10) {
      state = 'cognition_leading';
    } else {
      state = 'affect_leading';
    }
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
    gap,
    fusion_100: fusion,
    state,
    material_ready: availability.filter(Boolean).length,
    material_total: availability.length,
    indicator_scored: indicatorScored,
    indicator_total: indicatorTotal,
  };
}

const STATE_META: Record<
  EssenceHeadline['state'],
  { label: string; desc: string; badge: string; ring: string }
> = {
  synergy: {
    label: '情智共融',
    desc: '情感体验与思维发展同时立住了，学生「愿意想」也「想得动」。',
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    ring: 'from-emerald-50/80',
  },
  parallel: {
    label: '情智同步起步',
    desc: '情感与思维大体同步，但两侧都还在中段，尚未形成相互推高的循环。',
    badge: 'bg-sky-100 text-sky-700 border-sky-200',
    ring: 'from-sky-50/80',
  },
  cognition_leading: {
    label: '智强情弱',
    desc: '思维任务铺得开，但学生的情感投入没有跟上，容易出现「会做但不想做」。',
    badge: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    ring: 'from-indigo-50/80',
  },
  affect_leading: {
    label: '情浓智浅',
    desc: '课堂氛围活跃、学生愿意参与，但思维挑战与认知深度相对不足。',
    badge: 'bg-rose-100 text-rose-700 border-rose-200',
    ring: 'from-rose-50/80',
  },
  both_weak: {
    label: '情智待启',
    desc: '情感与思维两侧都偏弱，优先从「一个能让学生想说话的开放问题」重启。',
    badge: 'bg-amber-100 text-amber-700 border-amber-200',
    ring: 'from-amber-50/80',
  },
  insufficient: {
    label: '材料不足',
    desc: '缺少课堂转写或观察点材料，情智两侧无法判读；补齐后可重新生成。',
    badge: 'bg-muted text-muted-foreground border-border',
    ring: 'from-muted/60',
  },
};

function fmt(n: number | null, digits = 1): string {
  return n === null || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

export default function EssenceOnePager({ report }: { report: AnalysisReport }) {
  const headline = deriveEssenceHeadline(report);
  const meta = STATE_META[headline.state];
  const commentary = report.ai_commentary;

  const couplingText =
    commentary?.essence_coupling?.trim() ||
    (commentary?.summary ? commentary.summary.split(/[。；]/)[0] + '。' : null);
  const highlights = (commentary?.highlights ?? []).slice(0, 2);
  const actions = (commentary?.action_items?.length ? commentary.action_items : (commentary?.suggestions ?? [])).slice(0, 3);
  const materialShort = headline.material_ready < headline.material_total;

  return (
    <Card className={`break-inside-avoid overflow-hidden border-primary/25 bg-gradient-to-br ${meta.ring} to-transparent shadow-card`}>
      <CardContent className="space-y-3.5 p-4 print:p-3">
        {/* 标题 + 情智状态 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            情智相长 · 一页速读
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${meta.badge}`}>
              {meta.label}
            </span>
            <span className="text-[11px] text-muted-foreground">
              材料 {headline.material_ready}/{headline.material_total} 路 · 指标覆盖{' '}
              {headline.indicator_scored}/{headline.indicator_total}
            </span>
          </div>
        </div>

        {/* 三个数：情 / 智 / 融合落地 */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Brain className="h-3 w-3" /> 认知侧
            </div>
            <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
              {fmt(headline.cognitive_100)}
              <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">/100</span>
            </div>
            <div className="text-[10px] text-muted-foreground">高阶思维 11 指标</div>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Heart className="h-3 w-3" /> 情感侧
            </div>
            <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
              {fmt(headline.affective_100)}
              <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">/100</span>
            </div>
            <div className="text-[10px] text-muted-foreground">
              情智落差 {headline.gap === null ? '—' : headline.gap.toFixed(1)}
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/70 px-3 py-2">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Gauge className="h-3 w-3" /> 融合落地
            </div>
            <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">
              {fmt(headline.fusion_100)}
              <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">/10</span>
            </div>
            <div className="text-[10px] text-muted-foreground">设计 + 实施均值</div>
          </div>
        </div>

        {/* 一句判读 */}
        <p className="text-[13px] leading-relaxed text-foreground/90">{meta.desc}</p>
        {couplingText && (
          <p className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-xs leading-relaxed text-foreground/85">
            <span className="font-medium text-primary">情智怎么互相作用：</span>
            {couplingText}
          </p>
        )}

        {/* 亮点 2 条 + 下一步动作 3 条 */}
        {(highlights.length > 0 || actions.length > 0) && (
          <div className="grid gap-2.5 md:grid-cols-2">
            {highlights.length > 0 && (
              <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/50 p-2.5">
                <div className="mb-1 text-[11px] font-medium text-emerald-800">本课立住了什么</div>
                <ul className="space-y-1">
                  {highlights.map((h, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-foreground/85">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                      <span>{h}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {actions.length > 0 && (
              <div className="rounded-lg border border-amber-200/70 bg-amber-50/50 p-2.5">
                <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-amber-800">
                  <Target className="h-3 w-3" /> 下一节课就能改
                </div>
                <ol className="space-y-1">
                  {actions.map((a, i) => (
                    <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed text-foreground/85">
                      <span className="shrink-0 font-medium text-amber-700">{i + 1}.</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* 底部：口径提示 + 跳全量 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
          <div className="flex items-start gap-1 text-[10px] leading-snug text-muted-foreground">
            {materialShort ? (
              <>
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                <span>材料未齐（{headline.material_ready}/{headline.material_total} 路），缺材料项不计分、不进均分，补齐后重新分析可获得完整情智判读。</span>
              </>
            ) : (
              <span>认知侧取「数学高阶思维」观察点聚合，情感侧取「数学情感素养」观察点聚合；两侧不同口径，只看趋势不看绝对高低。</span>
            )}
          </div>
          <a
            href="#full-evidence"
            className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline print:hidden"
          >
            查看全量证据链 <ChevronDown className="h-3 w-3" />
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
