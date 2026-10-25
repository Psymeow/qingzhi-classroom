'use client';

// V1.3 表一内涵评价：认知（3 类 11 指标）+ 情感（4 类 8 指标），每指标下细化观察点评分明细。
import { useState } from 'react';
import { Brain, Heart, ChevronDown, Quote, FileQuestion } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import type {
  EssenceEvaluation,
  EssenceDomainResult,
  EssenceIndicatorResult,
  EssencePointResult,
} from '@/lib/evaluation/types';
import { POINT_SOURCE_LABEL } from '@/lib/evaluation/essence-points';

function scoreColor(v: number | null | undefined): string {
  if (v == null) return 'bg-muted-foreground/30';
  if (v >= 8.1) return 'bg-emerald-500';
  if (v >= 6.1) return 'bg-lime-500';
  if (v >= 4.1) return 'bg-amber-500';
  if (v >= 2.1) return 'bg-orange-500';
  return 'bg-red-500';
}

function scoreBadge(v: number | null | undefined): string {
  if (v == null) return '未评分';
  if (v >= 8.1) return '优秀';
  if (v >= 6.1) return '良好';
  if (v >= 4.1) return '中等';
  if (v >= 2.1) return '待提升';
  return '需重点改进';
}

/** V1.9d：缺材料观察点需要补的材料名称，如「学生任务单」「人工观察表」 */
function missingSourceNames(p: EssencePointResult): string {
  return p.sources.map((s) => POINT_SOURCE_LABEL[s] ?? s).join('、');
}

/** 缺材料的点排到折叠区末尾；其余保持原顺序 */
function sortPoints(points: EssencePointResult[]): EssencePointResult[] {
  return [...points].sort((a, b) => Number(!!a.missing_material) - Number(!!b.missing_material));
}

function IndicatorRow({ ind }: { ind: EssenceIndicatorResult }) {
  const [open, setOpen] = useState(false);
  const scored = ind.points.filter((p) => p.score != null).length;
  const pending = ind.points.filter((p) => p.missing_material).length;
  const orderedPoints = sortPoints(ind.points);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{ind.code}</span>
              <span className="truncate text-sm font-medium">{ind.name}</span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
                {ind.category}
              </Badge>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <Progress
                value={ind.score == null ? 0 : ind.score * 10}
                className={`h-1.5 w-28 ${scoreColor(ind.score)}`}
              />
              <span className="text-xs tabular-nums text-muted-foreground">
                {ind.score == null ? '—' : ind.score.toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground">
                {scored}/{ind.points.length} 个观察点
              </span>
              {pending > 0 && (
                <span className="flex items-center gap-0.5 text-[11px] text-amber-700">
                  <FileQuestion className="h-3 w-3" />
                  {pending} 点待补材料
                </span>
              )}
            </div>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-2 border-t bg-muted/20 px-4 py-3">
            {orderedPoints.map((p) =>
              p.missing_material ? (
                <div key={p.code} className="rounded-md border border-dashed bg-muted/30 p-3 opacity-80">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                        <span className="text-sm font-medium text-muted-foreground">{p.name}</span>
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground">
                          {missingSourceNames(p)}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.definition}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-semibold tabular-nums text-muted-foreground">—</span>
                      <Badge variant="secondary" className="h-4 gap-0.5 px-1.5 text-[10px] font-normal text-amber-700">
                        <FileQuestion className="h-3 w-3" />
                        待补材料
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-700/90">
                    本观察点需依据{missingSourceNames(p)}评估，本次未提交该材料，暂不评分（不影响均分）；补充材料后重新分析即可出分。
                  </p>
                </div>
              ) : (
              <div key={p.code} className="rounded-md border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                      <span className="text-sm font-medium">{p.name}</span>
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                        {p.sources.map((src) => POINT_SOURCE_LABEL[src] ?? src).join(' / ')}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.definition}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">
                      {p.score == null ? '—' : p.score.toFixed(1)}
                    </span>
                    <Badge
                      variant={p.score == null ? 'secondary' : 'outline'}
                      className="h-4 px-1.5 text-[10px] font-normal"
                    >
                      {scoreBadge(p.score)}
                    </Badge>
                  </div>
                </div>
                {p.score != null && (
                  <Progress value={p.score * 10} className={`mt-2 h-1 ${scoreColor(p.score)}`} />
                )}
                {p.reason && (
                  <p className="mt-2 text-xs leading-relaxed text-foreground/80">{p.reason}</p>
                )}
                {p.evidences && p.evidences.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {p.evidences.map((q, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                        <Quote className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="line-clamp-2">{q}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              ),
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function DomainBlock({
  title,
  icon,
  accent,
  domain,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  domain: EssenceDomainResult;
}) {
  // 按一级类别（策略型/批判型/…）保持出现顺序分组
  const groups: { category: string; items: EssenceIndicatorResult[] }[] = [];
  for (const ind of domain.indicators) {
    let g = groups.find((x) => x.category === ind.category);
    if (!g) {
      g = { category: ind.category, items: [] };
      groups.push(g);
    }
    g.items.push(ind);
  }

  const pendingPoints = domain.indicators.reduce(
    (n, ind) => n + ind.points.filter((p) => p.missing_material).length,
    0,
  );
  // 已评分点占「可评点」（排除待补材料点）比例过低时提示
  const evaluable = domain.total_points - pendingPoints;
  const coverLow = evaluable > 0 && domain.scored_points / evaluable < 0.5;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className={accent}>{icon}</span>
        {title}
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          已评 {domain.scored_points}/{evaluable}
          {pendingPoints > 0 ? ` · ${pendingPoints} 点待补材料` : ''} · 均分{' '}
          {domain.score == null ? '—' : domain.score.toFixed(1)}
        </span>
      </div>
      {(pendingPoints > 0 || coverLow) && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 print:border-amber-300 print:bg-transparent">
          <FileQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {pendingPoints > 0
            ? `${pendingPoints} 个观察点需补充学生任务单或人工观察记录后才能评估，本次不计入均分；`
            : ''}
          {coverLow ? '已提交材料中可找到证据的观察点偏少，结论仅供参考，建议补充材料后重新分析。' : ''}
        </p>
      )}
      {domain.chain_gap_avg != null && (domain.chain_compared ?? 0) > 0 && (
        <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          两条评分链对账：{domain.chain_compared} 个指标两侧都有分，本域与五维指标直评的平均差异{' '}
          <span className="font-medium text-foreground">{domain.chain_gap_avg.toFixed(1)}</span> 分
          {domain.chain_gap_avg <= 1 ? '（口径一致）' : '（两套尺子松紧仍有差距，建议复核）'}。
        </p>
      )}
      {groups.map((g) => (
        <div key={g.category} className="space-y-1.5">
          <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {g.category}
          </div>
          {g.items.map((ind) => (
            <IndicatorRow key={ind.code} ind={ind} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function EssenceEvalView({ eval: ev }: { eval: EssenceEvaluation }) {
  if (!ev.llm_used) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          表一内涵观察点（认知 11 项 / 情感 8 项）本次未产出 AI 评分：未启用 AI 或缺少可分析材料。
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">表一 · 认知与情感内涵观察点分析</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {(() => {
            const pending =
              ev.cognitive.indicators.reduce(
                (n, ind) => n + ind.points.filter((p) => p.missing_material).length,
                0,
              ) +
              ev.affective.indicators.reduce(
                (n, ind) => n + ind.points.filter((p) => p.missing_material).length,
                0,
              );
            const evaluable = ev.total_points - pending;
            return (
              <span>
                已评 {ev.scored_points}/{evaluable} 个观察点
                {pending > 0 && <span className="text-amber-700"> · {pending} 点待补材料</span>}
              </span>
            );
          })()}
          <span className="flex items-center gap-1">
            <Brain className="h-3.5 w-3.5" />
            认知 {ev.cognitive.score == null ? '—' : ev.cognitive.score.toFixed(1)}
          </span>
          <span className="flex items-center gap-1">
            <Heart className="h-3.5 w-3.5" />
            情感 {ev.affective.score == null ? '—' : ev.affective.score.toFixed(1)}
          </span>
        </div>
      </div>

      <DomainBlock
        title="认知 · 高阶思维（11 个二级指标）"
        icon={<Brain className="h-4 w-4" />}
        accent="text-blue-600"
        domain={ev.cognitive}
      />
      <DomainBlock
        title="情感 · 学习情感素养（8 个二级指标）"
        icon={<Heart className="h-4 w-4" />}
        accent="text-rose-600"
        domain={ev.affective}
      />
    </section>
  );
}
