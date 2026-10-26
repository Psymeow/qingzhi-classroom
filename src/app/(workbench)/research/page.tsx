'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowRight,
  FlaskConical,
  GitCompareArrows,
  Layers,
  Loader2,
  RefreshCw,
  Users,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { researchApi, ApiError, type LessonDigest, type ResearchGroup } from '@/lib/api/client';
import { suggestGroups, GROUP_KIND_LABEL, sourceSummary } from '@/lib/research/compare';
import { formatDate } from '@/lib/lesson/constants';
import { ErrorPanel, friendlyError } from '@/components/feedback/StateBlocks';

const MAX_SELECT = 6;
const MIN_SELECT = 2;

const KIND_ICON = {
  multi_round: RefreshCw,
  same_topic: GitCompareArrows,
  same_structure: Layers,
} as const;

export default function ResearchPage() {
  const router = useRouter();
  const [pool, setPool] = useState<LessonDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const lessons = await researchApi.lessons();
        setPool(lessons);
        setLoadError(null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return;
        }
        setLoadError(friendlyError(e, '课例池加载失败，请稍后重试。'));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => suggestGroups(pool), [pool]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECT) {
        toast.warning(`最多同时对比 ${MAX_SELECT} 节课`);
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  const goCompare = useCallback(
    (ids: string[]) => {
      if (ids.length < MIN_SELECT) {
        toast.warning(`至少选择 ${MIN_SELECT} 节课才能对比`);
        return;
      }
      router.push(`/research/compare?ids=${ids.slice(0, MAX_SELECT).join(',')}`);
    },
    [router],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
            <FlaskConical className="h-6 w-6 text-primary" />
            教研中心
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            把多节课放到一起看：同课异构、同一教师多轮授课、同课型结构对照，都能直接比出差异并生成教研洞察。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新课例池
        </Button>
      </div>

      {loadError ? (
        <ErrorPanel title="课例池加载失败" reason={loadError} onRetry={() => void load()} />
      ) : loading ? (
        <Card className="shadow-card">
          <CardContent className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在读取课例池…
          </CardContent>
        </Card>
      ) : pool.length < MIN_SELECT ? (
        <Card className="shadow-card">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <FlaskConical className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              教研中心需要至少 {MIN_SELECT} 节「已生成分析报告」的课例。
              <br />
              当前可对比课例 {pool.length} 节。
            </p>
            <Button asChild size="sm" className="mt-1">
              <Link href="/">
                去我的课例
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 自动识别的教研组 */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-primary" />
                自动识别的教研组
                <span className="text-xs font-normal text-muted-foreground">
                  基于课题、教师与课型自动归组，可直接点开对比
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {groups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
                  暂未识别到明显的对比组（课题/教师/课型都各不相同）。可以在下方课例池里手动勾选任意 2
                  节课对比。
                </p>
              ) : (
                groups.map((g) => (
                  <GroupCard
                    key={g.key}
                    group={g}
                    pool={pool}
                    onCompare={() => goCompare(g.lessonIds)}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {/* 手动选择 */}
          <Card className="shadow-card">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <GitCompareArrows className="h-4 w-4 text-primary" />
                课例池 · 手动选择
                <span className="text-xs font-normal text-muted-foreground">
                  选 2-{MAX_SELECT} 节已分析课例，任意组合
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {pool.map((d) => {
                  const on = selected.includes(d.lesson_id);
                  return (
                    <button
                      key={d.lesson_id}
                      type="button"
                      onClick={() => toggle(d.lesson_id)}
                      className={`flex flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-all ${
                        on
                          ? 'border-primary/60 bg-primary/[0.05] shadow-sm'
                          : 'border-border/80 bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm'
                      }`}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">
                          {d.title}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {on && <CheckCircle2 className="h-4 w-4 text-primary" />}
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                            {d.total_score}
                          </span>
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {d.teacher_name || '—'} · {d.grade_class || '—'} · {d.lesson_type || '—'}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {sourceSummary(d)} · 观察点 {d.scored_points}/{d.total_points} · 更新于{' '}
                        {formatDate(d.updated_at)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* 底部操作条 */}
          <div className="sticky bottom-4 z-10">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/90 px-4 py-3 shadow-card backdrop-blur">
              <span className="text-sm text-muted-foreground">
                已选 <span className="font-semibold text-foreground">{selected.length}</span> 节
                {selected.length > 0 && selected.length < MIN_SELECT && ` · 还差 ${MIN_SELECT - selected.length} 节`}
              </span>
              <div className="flex items-center gap-2">
                {selected.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                    清空
                  </Button>
                )}
                <Button size="sm" disabled={selected.length < MIN_SELECT} onClick={() => goCompare(selected)}>
                  开始对比
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function GroupCard({
  group,
  pool,
  onCompare,
}: {
  group: ResearchGroup;
  pool: LessonDigest[];
  onCompare: () => void;
}) {
  const Icon = KIND_ICON[group.kind];
  const lessons = group.lessonIds
    .map((id) => pool.find((p) => p.lesson_id === id))
    .filter((x): x is LessonDigest => Boolean(x));
  const scores = lessons.map((l) => l.total_score);
  const spread = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;

  return (
    <div className="rounded-xl border border-border/80 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-primary/10 text-primary">
            <Icon className="mr-1 h-3 w-3" />
            {GROUP_KIND_LABEL[group.kind]}
          </Badge>
          <span className="text-sm font-medium text-foreground">{group.label}</span>
        </div>
        <Button size="sm" variant="outline" onClick={onCompare}>
          对比这 {lessons.length} 节
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {group.hint} · 综合分 {Math.min(...scores)}–{Math.max(...scores)}（极差 {spread.toFixed(1)}）
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {lessons.map((l) => (
          <span
            key={l.lesson_id}
            className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-inset ring-border/60"
          >
            {l.teacher_name || '—'} · {l.grade_class || '—'} · {l.total_score} 分
          </span>
        ))}
      </div>
    </div>
  );
}
