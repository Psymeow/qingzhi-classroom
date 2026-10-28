'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, Grid3x3, MousePointerClick, Flag, SlidersHorizontal, Info } from 'lucide-react';
import { annotationApi, ApiError } from '@/lib/api/client';
import type {
  InteractionEdge,
  LessonAnnotation,
  SeatLayoutType,
  SeatStudent,
  StudentRole,
  TimelineEvent,
} from '@/lib/evaluation/annotation-types';
import { buildSeating, emptyAnnotation, uid, type SeatingPlanEx } from '@/lib/annotation/factory';
import { formatRelativeTime } from '@/lib/lesson/constants';
import SeatingCanvas, { type InteractionDraft } from '@/components/annotation/SeatingCanvas';
import EventLog from '@/components/annotation/EventLog';
import DimensionScores, { type DimMeta } from '@/components/annotation/DimensionScores';

type TabKey = 'seating' | 'events' | 'scores';

/**
 * 只删「完全一模一样」的重复连线（起点、终点、类型、是否双向全相同）。
 * 历史数据里同一对座位之间会叠好几条箭头，按坐标完全重叠、肉眼看不出来，用户会以为「没点上」再点一次。
 *
 * 注意这里故意**不**按「同座位对」粗暴合并：同一对之间可能既有「观点分享」又有「提问求助」，
 * 那是两个不同的标注，自动合并会丢掉用户的真实数据。要按座位对合并由用户点「合并重复」显式决定。
 */
function dedupExactEdges(edges: InteractionEdge[]): InteractionEdge[] {
  const seen = new Set<string>();
  const kept: InteractionEdge[] = [];
  for (let i = edges.length - 1; i >= 0; i -= 1) {
    const e = edges[i];
    if (!e) continue;
    const k = `${e.from_seat_id}>${e.to_seat_id}|${e.type}|${e.bidirectional ? 1 : 0}`;
    if (seen.has(k)) continue;
    seen.add(k);
    kept.unshift(e);
  }
  return kept;
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'seating', label: '座位·角色·互动', icon: <Grid3x3 className="h-4 w-4" /> },
  { key: 'events', label: '事件打点', icon: <Flag className="h-4 w-4" /> },
  { key: 'scores', label: '分项评分', icon: <SlidersHorizontal className="h-4 w-4" /> },
];

export default function AnnotationWorkbench({
  lessonId,
  dimensions,
  onUnauthorized,
}: {
  lessonId: string;
  dimensions: DimMeta[];
  onUnauthorized: () => void;
}) {
  const [data, setData] = useState<LessonAnnotation | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('seating');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [version, setVersion] = useState(0);
  // 最近一次成功保存的时间（展示「N 分钟前自动保存」用；version 是保存计数，只放 title 供排障）
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstLoad = useRef(true);

  // 每分钟刷新一次，让「N 分钟前」这类相对时间保持准确
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(timer);
  }, []);

  const persist = useCallback(
    async (snapshot: LessonAnnotation) => {
      setSaveState('saving');
      try {
        const saved = await annotationApi.save(lessonId, {
          seating: snapshot.seating as unknown as Record<string, unknown>,
          role_timeline: snapshot.role_timeline,
          interactions: snapshot.interactions,
          events: snapshot.events,
          phases: snapshot.phases,
          dimension_scores: snapshot.dimension_scores,
          observer_sheet: snapshot.observer_sheet,
        });
        setVersion(saved.version);
        setSavedAt(saved.updated_at ?? null);
        setSaveState('saved');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onUnauthorized();
        setSaveState('error');
      }
    },
    [lessonId, onUnauthorized],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await annotationApi.get(lessonId);
        if (cancelled) return;
        if (res?.annotation?.payload) {
          const p = res.annotation.payload as unknown as Partial<LessonAnnotation>;
          const base = emptyAnnotation(dimensions.map((d) => d.code));
          const rawEdges = p.interactions ?? [];
          // 历史数据里完全重复的连线自动收敛，用户不必手动点「合并重复」。
          // 幂等：没有重复时 keptEdges 与 rawEdges 一致，不触发额外保存。
          const keptEdges = dedupExactEdges(rawEdges);
          const dropped = rawEdges.length - keptEdges.length;
          const next: LessonAnnotation = {
            ...base,
            ...p,
            lesson_id: lessonId,
            // 保证数组字段存在
            role_timeline: p.role_timeline ?? [],
            interactions: keptEdges,
            events: p.events ?? [],
            phases: p.phases ?? [],
            observer_sheet: p.observer_sheet ?? [],
            dimension_scores: p.dimension_scores?.length
              ? p.dimension_scores
              : base.dimension_scores,
          };
          setData(next);
          setVersion(res.annotation.version);
          if (dropped > 0) {
            // 收敛结果立即回存，避免下次进来又看到重复
            void persist(next);
          }
        } else {
          setData({ ...emptyAnnotation(dimensions.map((d) => d.code)), lesson_id: lessonId });
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) onUnauthorized();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  // 变更后防抖自动保存（首次加载不触发）
  const mutate = useCallback(
    (updater: (prev: LessonAnnotation) => LessonAnnotation) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        if (firstLoad.current) return next;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => persist(next), 1200);
        return next;
      });
    },
    [persist],
  );

  useEffect(() => {
    if (!loading && firstLoad.current) firstLoad.current = false;
  }, [loading]);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  // 座位参数可配置：未传的参数沿用当前值，避免调「每组人数」时把「小组数」重置。
  // U 型的 rows/cols 在 SeatingPlan 里是几何行列，语义值另存 per_side/bottom_width，回退要用后者。
  // 小组围坐式的每行组数/组内每行座位数随 seating 持久化（历史数据无此字段时回落缺省几何）。
  const changeLayout = useCallback(
    (
      t: SeatLayoutType,
      p: {
        rows?: number;
        cols?: number;
        groupCount?: number;
        groupSize?: number;
        gColsPerRow?: number;
        seatsPerRow?: number;
      } = {},
    ) => {
      mutate((prev) => {
        const cur = prev.seating as SeatingPlanEx;
        const isU = t === 'u_shape';
        const rows = p.rows ?? (isU ? (cur.per_side ?? cur.rows) : cur.rows);
        const cols = p.cols ?? (isU ? (cur.bottom_width ?? cur.cols) : cur.cols);
        return {
          ...prev,
          seating: buildSeating(
            t,
            rows,
            cols,
            p.groupCount ?? cur.group_count ?? 4,
            p.groupSize ?? cur.group_size ?? 6,
            p.gColsPerRow ?? cur.g_cols_per_row,
            p.seatsPerRow ?? cur.seats_per_row,
          ),
        };
      });
    },
    [mutate],
  );

  const setRole = useCallback(
    (seatId: string, role: StudentRole | null) => {
      mutate((prev) => ({
        ...prev,
        seating: {
          ...prev.seating,
          students: prev.seating.students.map((s) => (s.seat_id === seatId ? { ...s, role } : s)),
        },
      }));
    },
    [mutate],
  );

  const renameSeat = useCallback(
    (seatId: string, patch: { student_no?: string; name?: string }) => {
      mutate((prev) => ({
        ...prev,
        seating: {
          ...prev.seating,
          students: prev.seating.students.map((s) => (s.seat_id === seatId ? { ...s, ...patch } : s)),
        },
      }));
    },
    [mutate],
  );

  const addInteraction = useCallback(
    (draft: InteractionDraft) => {
      const edge: InteractionEdge = {
        id: uid('edge'),
        from_seat_id: draft.from_seat_id,
        to_seat_id: draft.to_seat_id,
        bidirectional: draft.bidirectional,
        type: draft.type,
        phase: null,
        time_sec: null,
      };
      mutate((prev) => {
        // 去重：同一对座位（方向相同）只留一条。画布上箭头是按坐标叠在一起的，
        // 重复连线完全看不出来，用户会以为「没点上」再点一次，结果越积越多。
        // 所以第二次连线不新增，而是把已有那条的类型/双向改成这次选的值。
        const idx = prev.interactions.findIndex(
          (e) => e.from_seat_id === edge.from_seat_id && e.to_seat_id === edge.to_seat_id,
        );
        if (idx >= 0) {
          const next = [...prev.interactions];
          next[idx] = { ...next[idx], type: edge.type, bidirectional: edge.bidirectional };
          return { ...prev, interactions: next };
        }
        return { ...prev, interactions: [...prev.interactions, edge] };
      });
    },
    [mutate],
  );

  const removeInteraction = useCallback(
    (id: string) => mutate((prev) => ({ ...prev, interactions: prev.interactions.filter((e) => e.id !== id) })),
    [mutate],
  );

  // 一键清空：标注往往要反复试，只能一条条删（且画布上重叠的还删不准）时几乎没法重来。
  // 角色与连线分开清，座位姓名是花名册信息，不跟着清。
  const clearInteractions = useCallback(() => mutate((prev) => ({ ...prev, interactions: [] })), [mutate]);
  // 历史遗留的重复连线：同向同座位对只留最后一条（最后一条最接近用户当前意图）
  const dedupInteractions = useCallback(
    () =>
      mutate((prev) => {
        const seen = new Set<string>();
        const kept: InteractionEdge[] = [];
        for (let i = prev.interactions.length - 1; i >= 0; i -= 1) {
          const e = prev.interactions[i];
          const k = `${e.from_seat_id}>${e.to_seat_id}`;
          if (seen.has(k)) continue;
          seen.add(k);
          kept.unshift(e);
        }
        return kept.length === prev.interactions.length ? prev : { ...prev, interactions: kept };
      }),
    [mutate],
  );
  const clearRoles = useCallback(
    () =>
      mutate((prev) => ({
        ...prev,
        seating: {
          ...prev.seating,
          students: (prev.seating.students as SeatStudent[]).map((s) => ({ ...s, role: null })),
        },
      })),
    [mutate],
  );

  const setEvents = useCallback(
    (events: TimelineEvent[]) => mutate((prev) => ({ ...prev, events })),
    [mutate],
  );

  // seating 里可能带有新增的小组几何字段（g_cols_per_row / seats_per_row），类型放宽以便透传给画布
  const seating = (data?.seating ?? null) as SeatingPlanEx | null;
  const stats = useMemo(() => {
    if (!data) return null;
    const byRole: Record<StudentRole, number> = { leader: 0, participant: 0, observer: 0 };
    (data.seating.students as SeatStudent[]).forEach((s) => {
      if (s.role) byRole[s.role] += 1;
    });
    return {
      roles: byRole,
      interactions: data.interactions.length,
      events: data.events.length,
      scored: data.dimension_scores.filter((x) => typeof x.score === 'number').length,
    };
  }, [data]);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-primary" /> 加载标注工作台…
      </div>
    );
  }
  if (!data || !seating) return null;

  // 老师视角的状态条：标注状态 + 最近保存的相对时间；version 只是保存计数，降到 title 里供排障
  const annotated = version > 0;
  const relText = formatRelativeTime(savedAt);
  const statusText =
    saveState === 'saving'
      ? annotated
        ? '已标注 · 正在保存…'
        : '正在保存…'
      : annotated
        ? `已标注${relText ? ` · ${relText}自动保存` : ''}`
        : '未开始标注';

  return (
    <div id="annotation-workbench" className="scroll-mt-4 space-y-4">
      {/* 状态条 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge
          variant="outline"
          className="font-normal text-muted-foreground"
          title={annotated ? `标注保存计数 v${version}（内部乐观锁递增，仅供排障）` : undefined}
        >
          {statusText}
        </Badge>
        <Badge variant="outline" className="font-normal text-muted-foreground">
          <MousePointerClick className="mr-1 h-3 w-3" />
          互动 {stats?.interactions} · 事件 {stats?.events} · 评分 {stats?.scored}/5
        </Badge>
        <span className="ml-auto text-muted-foreground">
          {saveState === 'saving'
            ? '正在保存…'
            : saveState === 'saved'
              ? '✓ 已自动保存'
              : saveState === 'error'
                ? '保存失败，将在下次修改时重试'
                : '修改后自动保存'}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={saveState === 'saving'}
          onClick={() => persist(data)}
        >
          {saveState === 'saving' ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
          立即保存
        </Button>
      </div>

      {/* 标注说明：人工标注为选做项，不标注也能基于课堂材料生成 AI 分析报告 */}
      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-800">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          人工标注为<strong>选做</strong>：可补充座位角色、关键事件和您对五个维度的打分，作为 AI
          融合分析的一路证据（权重 15%）。即使不做任何标注，只要在「数据接入」中提供了转写文稿、任务单或观察记录，仍可正常生成分析报告。
        </span>
      </div>

      {/* Tab */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm transition ${
              tab === t.key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'seating' && (
        <SeatingCanvas
          layoutType={seating.layout_type}
          rows={seating.rows}
          cols={seating.cols}
          groupCount={seating.group_count}
          groupSize={seating.group_size}
          gColsPerRow={seating.g_cols_per_row}
          seatsPerRow={seating.seats_per_row}
          perSide={seating.per_side}
          bottomWidth={seating.bottom_width}
          students={seating.students}
          interactions={data.interactions}
          onLayoutChange={changeLayout}
          onSetRole={setRole}
          onRenameSeat={renameSeat}
          onAddInteraction={addInteraction}
          onRemoveInteraction={removeInteraction}
          onClearInteractions={clearInteractions}
          onClearRoles={clearRoles}
          onDedupInteractions={dedupInteractions}
        />
      )}

      {tab === 'events' && <EventLog events={data.events} onChange={setEvents} />}

      {tab === 'scores' && (
        <DimensionScores
          dimensions={dimensions}
          scores={data.dimension_scores}
          onChange={(next) => mutate((prev) => ({ ...prev, dimension_scores: next }))}
        />
      )}
    </div>
  );
}
