'use client';

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeft,
  BrainCircuit,
  Lightbulb,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Radar as RadarIcon,
  Table2,
  Target,
  Download,
} from 'lucide-react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { researchApi, ApiError, type LessonDigest, type ResearchInsight } from '@/lib/api/client';
import {
  buildCompare,
  DIMENSION_META,
  dimensionName,
  formatDelta,
  sourceSummary,
  type CompareRow,
} from '@/lib/research/compare';
import { formatDate } from '@/lib/lesson/constants';
import { ErrorPanel, friendlyError } from '@/components/feedback/StateBlocks';

const SERIES_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

function seriesName(d: LessonDigest, i: number): string {
  const letter = String.fromCharCode(65 + i);
  const who = d.teacher_name?.trim() || d.title.slice(0, 8);
  return `${letter}·${who}`;
}

export default function ResearchComparePage() {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [digests, setDigests] = useState<LessonDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [insight, setInsight] = useState<ResearchInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightNote, setInsightNote] = useState<string | null>(null);

  // 用 window.location 解析 ?ids=，避免 useSearchParams 需要 Suspense 边界
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('ids') ?? '';
    const list = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    setIds(list);
    setReady(true);
  }, []);

  const load = useCallback(
    async (lessonIds: string[]) => {
      setLoading(true);
      try {
        const lessons = await researchApi.lessons(lessonIds);
        setDigests(lessons);
        setLoadError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return;
        }
        setLoadError(friendlyError(e, '对比数据加载失败，请稍后重试。'));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!ready) return;
    if (ids.length < 2) {
      setLoading(false);
      return;
    }
    void load(ids);
  }, [ready, ids, load]);

  const cmp = useMemo(() => (digests.length >= 2 ? buildCompare(digests) : null), [digests]);

  const radarData = useMemo(() => {
    if (!cmp) return [];
    return DIMENSION_META.map((meta, i) => {
      const row: Record<string, string | number> = { dim: `D${i + 1}` };
      const r = cmp.dims[i];
      digests.forEach((d, idx) => {
        row[seriesName(d, idx)] = r?.values[idx] ?? 0;
      });
      return row;
    });
  }, [cmp, digests]);

  const genInsight = useCallback(async () => {
    if (digests.length < 2) return;
    setInsightLoading(true);
    setInsightNote(null);
    try {
      const r = await researchApi.insight(digests.map((d) => d.lesson_id));
      setInsight(r.insight);
      if (r.degraded) setInsightNote(r.reason ?? '已用规则引擎生成');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
      setInsightNote(friendlyError(e, '生成教研洞察失败，请稍后重试。'));
    } finally {
      setInsightLoading(false);
    }
  }, [digests, router]);

  if (!ready || loading) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          正在读取对比数据…
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return <ErrorPanel title="对比数据加载失败" reason={loadError} onRetry={() => void load(ids)} />;
  }

  if (!cmp || digests.length < 2) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <RadarIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">至少需要 2 节已分析课例才能对比。</p>
          <Button asChild size="sm" className="mt-1">
            <Link href="/research">
              返回教研中心
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const top = digests[cmp.topIndex];
  const bottom = digests[cmp.bottomIndex];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/research"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回教研中心
          </Link>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <RadarIcon className="h-6 w-6 text-primary" />
            {digests.length} 节课对比
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            综合分极差{' '}
            <span className="font-semibold text-foreground">{cmp.totalSpread.toFixed(1)}</span> 分 ·
            最高「{top.title}」{top.total_score} 分 · 最低「{bottom.title}」{bottom.total_score} 分
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Download className="h-4 w-4" />
            打印 / 存 PDF
          </Button>
          <Button size="sm" onClick={() => void genInsight()} disabled={insightLoading}>
            {insightLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {insight ? '重新生成教研洞察' : '生成教研洞察'}
          </Button>
        </div>
      </div>

      {/* 课例概览 */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {digests.map((d, i) => (
          <Card key={d.lesson_id} className="shadow-card">
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                  >
                    {String.fromCharCode(65 + i)}
                  </span>
                  {i === cmp.topIndex
                    ? '综合最高'
                    : i === cmp.bottomIndex
                      ? '综合最低'
                      : '参与对比'}
                </span>
                <Badge className="bg-primary/10 text-primary">{d.total_level}</Badge>
              </div>
              <p className="line-clamp-1 text-sm font-semibold text-foreground">{d.title}</p>
              <p className="text-xs text-muted-foreground">
                {d.teacher_name || '—'} · {d.grade_class || '—'} · {d.lesson_type || '—'}
              </p>
              <div className="flex items-end gap-3 pt-1">
                <span className="text-2xl font-bold text-foreground">
                  {d.total_score}
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">分</span>
                </span>
                <span className="pb-1 text-[11px] text-muted-foreground">
                  认知 {d.cognitive ?? '—'} / 情感 {d.affective ?? '—'}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                {sourceSummary(d)} · 观察点 {d.scored_points}/{d.total_points} · 更新于{' '}
                {formatDate(d.updated_at)}
                {d.ai_used ? ' · AI 参与评分' : ' · 规则引擎评分'}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 综合分 + 五维雷达 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              综合得分
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {digests.map((d, i) => (
              <div key={d.lesson_id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate text-muted-foreground">
                    {String.fromCharCode(65 + i)} · {d.teacher_name || d.title}
                  </span>
                  <span className="shrink-0 font-semibold text-foreground">
                    {d.total_score}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      {formatDelta(d.total_score - digests[cmp.topIndex].total_score)}
                    </span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(4, Math.min(100, d.total_score))}%`,
                      backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
                    }}
                  />
                </div>
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              差值以最高分课例为基准；10 分制维度差 0.5 分以内视为基本持平。
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <RadarIcon className="h-4 w-4 text-primary" />
              五维雷达对照（10 分制）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis
                    dataKey="dim"
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  />
                  <PolarRadiusAxis
                    domain={[0, 10]}
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  />
                  {digests.map((d, i) => (
                    <Radar
                      key={d.lesson_id}
                      name={seriesName(d, i)}
                      dataKey={seriesName(d, i)}
                      stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                      fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                      fillOpacity={0.12}
                    />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              D1 {DIMENSION_META[0]?.name} · D2 {DIMENSION_META[1]?.name} · D3{' '}
              {DIMENSION_META[2]?.name} · D4 {DIMENSION_META[3]?.name} · D5{' '}
              {DIMENSION_META[4]?.name}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 维度对比表 */}
      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Table2 className="h-4 w-4 text-primary" />
            五维 · 内涵 · 材料覆盖对比
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 text-xs text-muted-foreground">
                <th className="py-2 pr-3 text-left font-medium">维度 / 指标</th>
                {digests.map((d, i) => (
                  <th key={d.lesson_id} className="px-2 py-2 text-center font-medium">
                    <span
                      className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    {d.teacher_name || `课例 ${i + 1}`}
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-medium">极差</th>
              </tr>
            </thead>
            <tbody>
              {cmp.dims.map((row) => (
                <MetricRow key={row.key} row={row} digits={1} />
              ))}
              <tr>
                <td
                  colSpan={digests.length + 2}
                  className="pt-3 pb-1 text-[11px] font-semibold text-muted-foreground"
                >
                  表一内涵（百分制）
                </td>
              </tr>
              {cmp.essence.map((row) => (
                <MetricRow key={row.key} row={row} digits={1} />
              ))}
              <tr>
                <td
                  colSpan={digests.length + 2}
                  className="pt-3 pb-1 text-[11px] font-semibold text-muted-foreground"
                >
                  材料齐备度
                </td>
              </tr>
              <tr className="border-b border-border/40">
                <td className="py-2 pr-3 text-muted-foreground">观察点已评 / 总数</td>
                {digests.map((d) => (
                  <td key={d.lesson_id} className="px-2 py-2 text-center text-foreground">
                    {d.scored_points}/{d.total_points}
                  </td>
                ))}
                <td className="px-2 py-2 text-center text-muted-foreground">
                  {Math.max(...digests.map((d) => d.scored_points)) -
                    Math.min(...digests.map((d) => d.scored_points))}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            注：材料覆盖不同会直接影响可比性。若某节课缺任务单或观察记录，其指标分只能来自转写文本，对比时应把这一列一起看。
          </p>
        </CardContent>
      </Card>

      {/* 指标级差异 */}
      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-4 w-4 text-primary" />
            指标级差异（按差距排序）
            <span className="text-xs font-normal text-muted-foreground">
              只列出差距 ≥ 0.5 分的指标
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {cmp.indicators.filter((r) => (r.spread ?? 0) >= 0.5).length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
              各指标在所选课例间差距都在 0.5 分以内，说明教学执行高度一致。
            </p>
          ) : (
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/70 text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">二级指标</th>
                  {digests.map((d, i) => (
                    <th key={d.lesson_id} className="px-2 py-2 text-center font-medium">
                      {String.fromCharCode(65 + i)}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center font-medium">极差</th>
                </tr>
              </thead>
              <tbody>
                {cmp.indicators
                  .filter((r) => (r.spread ?? 0) >= 0.5)
                  .slice(0, 20)
                  .map((row) => (
                    <MetricRow key={row.key} row={row} digits={1} showDim />
                  ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* AI 教研洞察 */}
      <Card className="shadow-card">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BrainCircuit className="h-4 w-4 text-primary" />
            教研洞察
            {insight?.degraded && <Badge className="bg-amber-100 text-amber-700">规则引擎生成</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!insight && !insightLoading && (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-5">
              <p className="text-sm text-muted-foreground">
                点「生成教研洞察」，系统会把这些课例的维度差异、指标差异放在一起分析，输出共同亮点、关键差异、可迁移做法与下一步教研建议。
              </p>
              <Button size="sm" variant="outline" onClick={() => void genInsight()}>
                <Sparkles className="h-4 w-4" />
                生成教研洞察
              </Button>
            </div>
          )}
          {insightLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              正在分析这 {digests.length} 节课的差异…
            </div>
          )}
          {insightNote && (
            <p className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-900/80">
              {insightNote}
            </p>
          )}
          {insight && (
            <div className="space-y-4">
              <p className="rounded-xl bg-primary/[0.04] px-4 py-3 text-sm leading-relaxed text-foreground">
                {insight.overview}
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                <InsightList
                  icon={TrendingUp}
                  title="共同亮点"
                  items={insight.commonalities}
                  tone="emerald"
                />
                <InsightList
                  icon={Lightbulb}
                  title="可迁移做法"
                  items={insight.transferables}
                  tone="primary"
                />
              </div>
              {insight.differences.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <TrendingDown className="h-4 w-4 text-amber-600" />
                    关键差异
                  </h4>
                  <div className="space-y-2">
                    {insight.differences.map((d, i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-amber-200/70 bg-amber-50/40 px-3 py-2.5"
                      >
                        <p className="text-sm font-medium text-amber-900">{d.title}</p>
                        <p className="mt-1 text-xs leading-relaxed text-amber-900/80">{d.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <InsightList
                icon={Target}
                title="下一步教研建议"
                items={insight.next_steps}
                tone="primary"
              />
              {insight.model && (
                <p className="text-[11px] text-muted-foreground/70">
                  洞察由 {insight.model} 生成，仅基于已评分数据，不修改任何分数。
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricRow({
  row,
  digits,
  showDim = false,
}: {
  row: CompareRow;
  digits: number;
  showDim?: boolean;
}) {
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2 pr-3 text-muted-foreground">
        {showDim && row.key.includes('|') ? (
          <span className="mr-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground/80">
            {dimensionName(row.key.split('|')[0])}
          </span>
        ) : null}
        {row.name}
      </td>
      {row.values.map((v, i) => {
        const isBest = row.best === i && row.spread != null && row.spread > 0;
        const isWorst = row.worst === i && row.spread != null && row.spread > 0;
        return (
          <td
            key={i}
            className={`px-2 py-2 text-center ${
              isBest
                ? 'font-semibold text-emerald-700'
                : isWorst
                  ? 'text-amber-700'
                  : 'text-foreground'
            }`}
          >
            {v == null ? '—' : v.toFixed(digits)}
            {isBest && row.spread != null && row.spread >= 0.5 ? ' ↑' : ''}
          </td>
        );
      })}
      <td className="px-2 py-2 text-center text-xs text-muted-foreground">
        {row.spread == null ? '—' : row.spread.toFixed(digits)}
      </td>
    </tr>
  );
}

function InsightList({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  items: string[];
  tone: 'emerald' | 'primary';
}) {
  if (items.length === 0) return null;
  const color = tone === 'emerald' ? 'text-emerald-600' : 'text-primary';
  return (
    <div>
      <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Icon className={`h-4 w-4 ${color}`} />
        {title}
      </h4>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <span className={`mt-1 h-1 w-1 shrink-0 rounded-full bg-current ${color}`} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
