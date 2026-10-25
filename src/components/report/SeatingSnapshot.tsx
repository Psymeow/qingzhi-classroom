'use client';

import { useMemo } from 'react';
import type {
  InteractionEdge,
  SeatLayoutType,
  SeatStudent,
  StudentRole,
  InteractionType,
} from '@/lib/evaluation/annotation-types';
import { SEAT_LAYOUT_LABEL, STUDENT_ROLE_META, INTERACTION_TYPE_LABEL } from '@/lib/evaluation/annotation-types';

// 只读座位 + 互动关系快照（用于报告，无任何编辑回调）。
const CELL = 56;
const PAD_X = 28;
const PAD_TOP = 44;
const NODE = 40;

const ROLE_FILL: Record<StudentRole, string> = {
  leader: '#f43f5e',
  participant: '#0ea5e9',
  observer: '#8b8fa3',
};

const EDGE_COLOR: Record<InteractionType, string> = {
  ask_help: '#f59e0b',
  share: '#5b54e6',
  supplement: '#10b981',
  collaborate: "#ec4899",
};

interface Props {
  layoutType: SeatLayoutType;
  rows: number;
  cols: number;
  students: SeatStudent[];
  interactions: InteractionEdge[];
}

export default function SeatingSnapshot({ layoutType, rows, cols, students, interactions }: Props) {
  const width = PAD_X * 2 + Math.max(1, cols - 1) * CELL + NODE;
  const height = PAD_TOP + 40 + Math.max(1, rows - 1) * CELL + NODE;

  const bySeat = useMemo(() => {
    const m = new Map<string, SeatStudent>();
    students.forEach((s) => m.set(s.seat_id, s));
    return m;
  }, [students]);

  const center = (s: SeatStudent) => ({
    x: PAD_X + s.col * CELL + NODE / 2,
    y: PAD_TOP + s.row * CELL + NODE / 2,
  });

  const edgeTypes = Array.from(new Set(interactions.map((e) => e.type)));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">布局：{SEAT_LAYOUT_LABEL[layoutType] ?? layoutType}</span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full" style={{ background: ROLE_FILL.leader }} />
          {STUDENT_ROLE_META.leader.symbol} 组织引领
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full" style={{ background: ROLE_FILL.participant }} />
          {STUDENT_ROLE_META.participant.symbol} 协同参与
        </span>
        <span className="inline-flex items-center gap-1">
          <i className="h-2 w-2 rounded-full" style={{ background: ROLE_FILL.observer }} />
          {STUDENT_ROLE_META.observer.symbol} 观察记录
        </span>
        {edgeTypes.map((t) => (
          <span key={t} className="inline-flex items-center gap-1">
            <i className="h-0.5 w-4" style={{ background: EDGE_COLOR[t] }} />
            {INTERACTION_TYPE_LABEL[t]}
          </span>
        ))}
      </div>

      {students.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
          未标注座位
        </div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-3xl rounded-xl border border-border/70 bg-muted/30">
          <defs>
            {(Object.keys(EDGE_COLOR) as InteractionType[]).map((t) => (
              <marker
                key={t}
                id={`rep-arrow-${t}`}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_COLOR[t]} />
              </marker>
            ))}
          </defs>

          {interactions.map((e) => {
            const a = bySeat.get(e.from_seat_id);
            const b = bySeat.get(e.to_seat_id);
            if (!a || !b) return null;
            const pa = center(a);
            const pb = center(b);
            return (
              <g key={e.id} opacity={0.75}>
                <line
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  stroke={EDGE_COLOR[e.type]}
                  strokeWidth={1.8}
                  markerEnd={`url(#rep-arrow-${e.type})`}
                />
                {e.bidirectional && (
                  <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={EDGE_COLOR[e.type]} strokeWidth={1.2} opacity={0.4} />
                )}
              </g>
            );
          })}

          {students.map((s) => {
            const { x, y } = center(s);
            const fill = s.role ? ROLE_FILL[s.role] : '#d7d9e0';
            const meta = s.role ? STUDENT_ROLE_META[s.role] : null;
            return (
              <g key={s.seat_id}>
                <circle cx={x} cy={y} r={NODE / 2} fill={fill} opacity={s.role ? 0.92 : 1} />
                <text x={x} y={y - 1} textAnchor="middle" fontSize="11" fill={s.role ? '#fff' : '#9aa0b0'} fontWeight="bold">
                  {meta?.symbol ?? '·'}
                </text>
                <text x={x} y={y + 11} textAnchor="middle" fontSize="7.5" fill={s.role ? '#fff' : '#9aa0b0'}>
                  {s.name || s.student_no || ''}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="text-[11px] text-muted-foreground/80">
        共 {students.filter((s) => s.role).length} 个角色标注 · {interactions.length} 条互动关系
      </div>
    </div>
  );
}
