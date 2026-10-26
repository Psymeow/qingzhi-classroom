'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { History, Loader2, RefreshCw, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { lessonsApi, ApiError, type RunRecordItem } from '@/lib/api/client';
import { diffRuns } from '@/lib/analysis/run-summary';

/**
 * 分析运行历史（V1.22）
 * - 每次「运行分析 / 重新运行分析」追加一条记录（分数 + 覆盖 + 标准/模型版本 + 耗时）；
 * - 与上一次运行对比，直接看出「改了标注或材料之后，这节课变好还是变差」；
 * - 目标库未创建 report_runs 表时优雅降级为一行提示，不影响报告本身。
 */
export function RunHistory({
  lessonId,
  refreshKey,
  onUnauthorized,
}: {
  lessonId: string;
  /** 报告更新（重新运行完成）后变化，用于刷新历史 */
  refreshKey?: string | number | null;
  onUnauthorized: () => void;
}) {
  const [enabled, setEnabled] = useState(true);
  const [runs, setRuns] = useState<RunRecordItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lessonsApi.runs(lessonId);
      setEnabled(r.enabled);
      setRuns(r.runs);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      // 历史是辅助信息，读取失败静默处理，不打断报告阅读
      setEnabled(false);
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [lessonId, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // 列表新→旧；对比时用「上一次（更早）」作基准
  const rows = useMemo(() => {
    return runs.map((run, i) => {
      const prev = runs[i + 1];
      return { run, delta: prev ? diffRuns(prev.summary, run.summary) : null };
    });
  }, [runs]);

  const maxScore = useMemo(
    () => Math.max(1, ...runs.map((r) => Number(r.total_score) || 0)),
    [runs],
  );

  if (loading) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex items-center gap-2 py-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在读取运行历史…
        </CardContent>
      </Card>
    );
  }

  if (!enabled) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">运行历史未启用。</span>
        目标库还没有 <code className="rounded bg-muted px-1">report_runs</code> 表，需要执行一次
        <code className="mx-1 rounded bg-muted px-1">migrations/0007_report_runs.sql</code>
        后自动生效；在此之前分析与报告不受影响。
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">还没有运行记录。</span>
        在这里点「运行分析」或「重新运行分析」后，每次运行都会留下一条分数与版本快照，便于对比改前改后。
      </div>
    );
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            运行历史
            <span className="text-xs font-normal text-muted-foreground">
              共 {runs.length} 次 · 最近在左
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => void load()} className="h-7 px-2">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 分数轨迹：柱高按总分，最近一次高亮 */}
        <div className="flex items-end gap-1.5">
          {runs
            .slice()
            .reverse()
            .map((r, i, arr) => {
              const isLast = i === arr.length - 1;
              const h = Math.max(8, Math.round((Number(r.total_score) / maxScore) * 56));
              return (
                <div key={r.id} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">{Number(r.total_score).toFixed(1)}</span>
                  <div
                    className={`w-full rounded-t ${isLast ? 'bg-primary' : 'bg-primary/25'}`}
                    style={{ height: `${h}px` }}
                    title={`第 ${r.run_no} 次 · ${new Date(r.created_at).toLocaleString('zh-CN')}`}
                  />
                  <span className={`text-[10px] ${isLast ? 'font-semibold text-foreground' : 'text-muted-foreground/70'}`}>
                    {r.run_no}
                  </span>
                </div>
              );
            })}
        </div>

        <ul className="space-y-1.5">
          {rows.map(({ run, delta }, i) => (
            <li
              key={run.id}
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-xs ${
                i === 0 ? 'bg-primary/[0.05]' : 'bg-muted/30'
              }`}
            >
              <span className="font-semibold text-foreground">第 {run.run_no} 次</span>
              <span className="text-muted-foreground">
                {new Date(run.created_at).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="font-semibold text-foreground">{Number(run.total_score).toFixed(1)} 分</span>
              {delta && (
                <span
                  className={`inline-flex items-center gap-0.5 font-medium ${
                    delta.total > 0 ? 'text-emerald-700' : delta.total < 0 ? 'text-amber-700' : 'text-muted-foreground'
                  }`}
                >
                  {delta.total > 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : delta.total < 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : (
                    <Minus className="h-3 w-3" />
                  )}
                  {delta.total > 0 ? '+' : ''}
                  {delta.total.toFixed(1)}
                </span>
              )}
              <Badge className={run.ai_used ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                {run.ai_used ? 'AI 评分' : '规则引擎'}
              </Badge>
              {run.trigger === 'rerun' && <span className="text-[11px] text-muted-foreground">重新运行</span>}
              {run.duration_ms != null && (
                <span className="text-[11px] text-muted-foreground">
                  耗时 {Math.round(run.duration_ms / 1000)}s
                </span>
              )}
              {run.prompt_version && (
                <span className="text-[11px] text-muted-foreground/60">prompt {run.prompt_version}</span>
              )}
              {run.summary && (
                <span className="text-[11px] text-muted-foreground/70">
                  观察点 {run.summary.scored_points}/{run.summary.total_points}
                </span>
              )}
            </li>
          ))}
        </ul>

        {rows[0]?.delta && rows[0].delta.indicators.length > 0 && (
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <p className="mb-1 text-[11px] font-medium text-foreground">
              最近一次与上一次相比，变化最大的指标
            </p>
            <div className="flex flex-wrap gap-1.5">
              {rows[0].delta.indicators.slice(0, 6).map((ind) => (
                <span
                  key={ind.code}
                  className={`rounded-md px-1.5 py-0.5 text-[11px] ${
                    ind.delta > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {ind.code} {ind.from} → {ind.to}
                  （{ind.delta > 0 ? '+' : ''}
                  {ind.delta.toFixed(1)}）
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground/70">
          每次运行都会记录标准版本、prompt 版本与所用模型，用来解释「同一份材料两次运行分数为什么不同」。
          历史只追加，不会覆盖当前报告。
        </p>
      </CardContent>
    </Card>
  );
}
