'use client';

import { useState } from 'react';
import { BookOpenCheck, ChevronDown, Quote, Sparkles, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { LessonTypeEvaluation } from '@/lib/evaluation/types';

function pointColor(score: number | null): string {
  if (score === null) return 'bg-muted';
  if (score >= 8.1) return 'bg-emerald-500';
  if (score >= 6.1) return 'bg-lime-500';
  if (score >= 4.1) return 'bg-amber-400';
  if (score >= 2.1) return 'bg-orange-400';
  return 'bg-red-400';
}

function levelClass(label: string | null): string {
  // 旧报告落库的仍是「待提升」「需重点改进」，新旧词一并匹配，避免旧数据渲染退化
  if (!label) return 'border-border text-muted-foreground';
  if (label === '优秀') return 'border-emerald-300 text-emerald-700';
  if (label === '良好') return 'border-lime-300 text-lime-700';
  if (label === '中等') return 'border-amber-300 text-amber-700';
  if (label === '可精进' || label === '待提升') return 'border-orange-300 text-orange-700';
  if (label === '起步阶段' || label === '需重点改进') return 'border-red-300 text-red-700';
  return 'border-border text-muted-foreground';
}

export default function LessonTypeEvalView({
  eval: ev,
  defaultOpenAll = false,
}: {
  eval: LessonTypeEvaluation;
  defaultOpenAll?: boolean;
}) {
  // openAll 为 null 时按每个视角独立控制；true/false 时全局展开/收起
  const [openAll, setOpenAll] = useState<boolean | null>(defaultOpenAll ? true : false);
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());

  const toggleOne = (code: string) => {
    setOpenAll(null);
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const isOpen = (code: string) => (openAll === null ? openSet.has(code) : openAll);

  return (
    <Card className="border-primary/20 shadow-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              课型专属分析 · {ev.lesson_type_name}
            </span>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              手册 {ev.manual_section}
            </Badge>
            {ev.source === 'auto' && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Sparkles className="h-3 w-3 text-primary" />
                AI 识别
                {ev.confidence !== null && ev.confidence !== undefined
                  ? ` ${(ev.confidence * 100).toFixed(0)}%`
                  : ''}
              </Badge>
            )}
          </div>
          {ev.total_score !== null && (
            <div className="flex items-baseline gap-1">
              <span className="text-xs text-muted-foreground">
                要点均分 {ev.scored_points}/{ev.total_points}：
              </span>
              <span className="bg-brand-gradient bg-clip-text text-2xl font-bold tabular-nums text-transparent">
                {ev.total_score_100?.toFixed(0)}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          )}
        </div>

        <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {ev.summary}
        </p>

        {!ev.llm_used && (
          <div className="flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {ev.llm_enabled
                ? '本次课型要点 AI 评分未产出结果（可能调用失败或材料中缺少相关依据），未编造分数。请开启「AI 深度分析」并确保已导入转写文稿/观察记录后重新运行。'
                : '课型要点评价由 AI 对照课型手册逐条评分。开启「AI 深度分析」后重新运行即可生成。'}
            </span>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setOpenSet(new Set());
              setOpenAll(openAll === true ? false : true);
            }}
            className="flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            {openAll === true ? '全部收起' : '展开全部要点定义'}
            <ChevronDown
              className={`h-3 w-3 transition-transform ${openAll === true ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        <div className="space-y-2">
          {ev.viewpoints.map((vp) => {
            const open = isOpen(vp.code);
            return (
              <div key={vp.code} className="rounded-xl border border-border/70 bg-muted/10">
                <button
                  type="button"
                  onClick={() => toggleOne(vp.code)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <ChevronDown
                      className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                    {vp.name}
                    <span className="text-[11px] font-normal text-muted-foreground">
                      {vp.points.filter((p) => p.score !== null).length}/{vp.points.length} 有评分
                    </span>
                  </span>
                  {vp.score !== null && (
                    <span className="flex items-center gap-2">
                      <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <span
                          className={`absolute inset-y-0 left-0 rounded-full ${pointColor(vp.score)}`}
                          style={{ width: `${(vp.score / 10) * 100}%` }}
                        />
                      </span>
                      <span className="w-9 text-right text-xs font-semibold tabular-nums">
                        {vp.score?.toFixed(1)}
                      </span>
                    </span>
                  )}
                </button>

                {open && (
                  <div className="space-y-2 px-3 pb-3">
                    {vp.points.map((pt) => (
                      <div key={pt.code} className="rounded-lg border border-border/60 bg-background/60 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-[10px] text-muted-foreground">{pt.code}</span>
                            <span className="text-xs font-medium text-foreground">{pt.name}</span>
                            {pt.level_label && (
                              <Badge
                                variant="outline"
                                className={`h-4 px-1 text-[10px] ${levelClass(pt.level_label)}`}
                              >
                                {pt.level_label}
                              </Badge>
                            )}
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            {pt.score === null ? (
                              <span className="text-muted-foreground/50">—</span>
                            ) : (
                              pt.score.toFixed(1)
                            )}
                          </span>
                        </div>

                        {pt.score !== null && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${pointColor(pt.score)}`}
                              style={{ width: `${(pt.score / 10) * 100}%` }}
                            />
                          </div>
                        )}

                        {pt.reason && (
                          <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80">
                            {pt.reason}
                          </p>
                        )}
                        {pt.evidences && pt.evidences.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {pt.evidences.map((evText, i) => (
                              <li
                                key={i}
                                className="flex gap-1 text-[11px] leading-relaxed text-muted-foreground"
                              >
                                <Quote className="mt-0.5 h-2.5 w-2.5 shrink-0 opacity-60" />
                                <span>{evText}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="text-[10px] text-muted-foreground/70">
          AI 严格依据《AIC 课型手册 1.0》{ev.manual_section} 逐条判定，材料中无表现依据的要点不予编造分数
        </div>
      </CardContent>
    </Card>
  );
}
