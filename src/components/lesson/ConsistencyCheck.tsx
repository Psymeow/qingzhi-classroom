'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck, AlertTriangle, FlaskConical, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ApiError,
  consistencyApi,
  type ConsistencyItem,
  type ConsistencyReport,
} from '@/lib/api/client';

interface Props {
  lessonId: string;
  onUnauthorized: () => void;
}

function levelTone(level: string): string {
  if (level === '稳定') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
  if (level === '基本稳定') return 'border-amber-300 bg-amber-50 text-amber-700';
  if (level === '波动较大') return 'border-red-300 bg-red-50 text-red-700';
  return 'border-border bg-muted text-muted-foreground';
}

function gapTone(gap: number | null): string {
  if (gap === null) return 'text-muted-foreground/50';
  if (gap <= 1) return 'text-emerald-600';
  if (gap <= 2) return 'text-amber-600';
  return 'text-red-600';
}

function ItemRow({ item }: { item: ConsistencyItem }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-1.5 pr-2 text-xs text-foreground/90">{item.label}</td>
      <td className="py-1.5 pr-2 text-center text-[11px] tabular-nums text-muted-foreground">
        {item.scores.map((s, i) => (
          <span key={i} className="mr-1.5">
            {s === null ? '—' : s.toFixed(1)}
          </span>
        ))}
      </td>
      <td className="py-1.5 pr-2 text-center text-xs font-medium tabular-nums">
        {item.mean === null ? '—' : item.mean.toFixed(1)}
      </td>
      <td className={`py-1.5 pr-2 text-center text-xs font-semibold tabular-nums ${gapTone(item.gap)}`}>
        {item.gap === null ? '—' : `差异 ${item.gap.toFixed(1)} 分`}
      </td>
      <td className="py-1.5 text-center">
        {item.stable ? (
          <Badge variant="outline" className="border-emerald-300 text-[10px] text-emerald-700">
            稳定
          </Badge>
        ) : (
          <Badge variant="outline" className="border-red-300 text-[10px] text-red-700">
            波动
          </Badge>
        )}
      </td>
    </tr>
  );
}

export default function ConsistencyCheck({ lessonId, onUnauthorized }: Props) {
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState('3');
  const [kind, setKind] = useState<'transcript' | 'observer'>('transcript');
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // P1-12：自检属于教研/管理员的可复现性验证，默认折叠，普通教师日常不出报告流程不被打扰。
  const [expanded, setExpanded] = useState(false);

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const r = await consistencyApi.run(lessonId, { runs: Number(runs), kind });
      setReport(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      setError(e instanceof Error ? e.message : '自检失败');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="border-border/70 shadow-card">
      <CardContent className="space-y-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        >
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" /> 评分稳定性自检（选做）
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>

        {!expanded && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            供教研员在试用前抽查 AI 评分的一致性：对同一份材料重复评分并比较结果差异。日常使用无需操作。
          </p>
        )}

        {expanded && (
          <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger size="sm" className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="transcript">转写文稿</SelectItem>
                <SelectItem value="observer">观察记录</SelectItem>
              </SelectContent>
            </Select>
            <Select value={runs} onValueChange={setRuns}>
              <SelectTrigger size="sm" className="h-8 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">跑 2 次</SelectItem>
                <SelectItem value="3">跑 3 次</SelectItem>
                <SelectItem value="5">跑 5 次</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={run} disabled={running}>
              {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="mr-1.5 h-3.5 w-3.5" />}
              开始自检
            </Button>
          </div>
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          对同一份材料重复调用 AI 评分，比较每次分数的差异：各次分差 ≤ 1 分视为稳定。自检只读取文本、不修改已生成的报告。
        </p>

          {error && (
            <div className="flex items-start gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

        {report && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className={`border ${levelTone(report.summary.level)}`} variant="outline">
                总体：{report.summary.level}
              </Badge>
              <span className="text-muted-foreground">
                对比 {report.summary.compared} 项 · 稳定 {report.summary.stable} · 波动{' '}
                {report.summary.unstable}
              </span>
              {report.summary.avg_gap !== null && (
                <span className="text-muted-foreground">平均差异 {report.summary.avg_gap.toFixed(1)}</span>
              )}
              {report.summary.max_gap !== null && (
                <span className="text-muted-foreground">最大差异 {report.summary.max_gap.toFixed(1)}</span>
              )}
            </div>

            <div className="max-h-72 overflow-auto rounded-lg border border-border/60">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-muted/80 text-[10px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">指标/要点</th>
                    <th scope="col" className="px-2 py-1.5 text-center font-medium">各轮分</th>
                    <th scope="col" className="px-2 py-1.5 text-center font-medium">均值</th>
                    <th scope="col" className="px-2 py-1.5 text-center font-medium">波动</th>
                    <th scope="col" className="px-2 py-1.5 text-center font-medium">结论</th>
                  </tr>
                </thead>
                <tbody className="px-2">
                  {report.lesson_type_points.length > 0 && (
                    <tr>
                      <td colSpan={5} className="bg-primary/[0.04] px-2 py-1 text-[10px] font-semibold text-primary">
                        课型专属要点{report.lesson_type_name ? `（${report.lesson_type_name}）` : ''}
                      </td>
                    </tr>
                  )}
                  {report.lesson_type_points.map((it) => (
                    <ItemRow key={it.code} item={it} />
                  ))}
                  {report.indicators.length > 0 && (
                    <tr>
                      <td colSpan={5} className="bg-primary/[0.04] px-2 py-1 text-[10px] font-semibold text-primary">
                        通用五维指标
                      </td>
                    </tr>
                  )}
                  {report.indicators.map((it) => (
                    <ItemRow key={it.code} item={it} />
                  ))}
                </tbody>
              </table>
            </div>

            {report.errors.length > 0 && (
              <ul className="space-y-0.5 text-[11px] text-amber-700">
                {report.errors.map((e2, i) => (
                  <li key={i}>· {e2}</li>
                ))}
              </ul>
            )}
          </div>
        )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
