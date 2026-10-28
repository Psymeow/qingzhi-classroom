'use client';

import { useMemo, useRef, useState } from 'react';
import type {
  InteractionEdge,
  InteractionType,
  SeatLayoutType,
  SeatStudent,
  StudentRole,
} from '@/lib/evaluation/annotation-types';
import { SEAT_LAYOUT_LABEL, STUDENT_ROLE_META, INTERACTION_TYPE_LABEL } from '@/lib/evaluation/annotation-types';
import { defaultSeatParams } from '@/lib/annotation/factory';

// 画布几何（与座位单元尺寸绑定，箭头按此换算）
const CELL = 56; // 每个网格步长
const PAD_X = 28;
const PAD_TOP = 64; // 顶部留讲台
const PAD_BOTTOM = 28;
const NODE = 40; // 座位方块尺寸

const ROLE_STYLE: Record<StudentRole, { bg: string; ring: string; text: string }> = {
  leader: { bg: 'bg-rose-100', ring: 'ring-rose-400', text: 'text-rose-700' },
  participant: { bg: 'bg-sky-100', ring: 'ring-sky-400', text: 'text-sky-700' },
  observer: { bg: 'bg-muted', ring: 'ring-muted-foreground/50', text: 'text-muted-foreground' },
};

const EDGE_COLOR: Record<InteractionType, string> = {
  ask_help: '#f59e0b',
  share: '#5b54e6',
  supplement: '#10b981',
  collaborate: '#ec4899',
};

export type InteractionDraft = {
  from_seat_id: string;
  to_seat_id: string;
  bidirectional: boolean;
  type: InteractionType;
};

type Mode = 'role' | 'link';

interface Props {
  layoutType: SeatLayoutType;
  rows: number;
  cols: number;
  /** 小组围坐式：组数与每组人数（旧数据缺省按 4 组 x 6 人） */
  groupCount?: number;
  groupSize?: number;
  /** 小组围坐式：每行组数、组内每行座位数（旧数据缺省按 min(组数,2) / 每行 3 席） */
  gColsPerRow?: number;
  seatsPerRow?: number;
  /** U 型：每边/底边座位数（rows/cols 对 U 型是几何行列，不能用来回显调节值） */
  perSide?: number;
  bottomWidth?: number;
  students: SeatStudent[];
  interactions: InteractionEdge[];
  onLayoutChange: (
    t: SeatLayoutType,
    p: {
      rows?: number;
      cols?: number;
      groupCount?: number;
      groupSize?: number;
      gColsPerRow?: number;
      seatsPerRow?: number;
    },
  ) => void;
  onSetRole: (seatId: string, role: StudentRole | null) => void;
  onRenameSeat: (seatId: string, patch: { student_no?: string; name?: string }) => void;
  onAddInteraction: (draft: InteractionDraft) => void;
  onRemoveInteraction: (id: string) => void;
  /** 一键清空全部互动连线（带确认） */
  onClearInteractions: () => void;
  /** 一键清空全部角色标记，座位姓名/编号保留 */
  onClearRoles: () => void;
  /** 合并已存在的重复连线（同向同座位对只留最后一条），用于清理历史遗留数据 */
  onDedupInteractions: () => void;
}

function seatCenter(s: SeatStudent) {
  return {
    x: PAD_X + s.col * CELL + NODE / 2,
    y: PAD_TOP + s.row * CELL + NODE / 2,
  };
}

/** 数值步进器：座位参数用 +/- 调整，比键盘输入更适合触屏 */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      {label}
      <span className="flex items-center rounded-md border border-border bg-card">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={value <= min}
          aria-label={`减少${label}`}
          className="px-2 py-1 text-sm leading-none text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          -
        </button>
        <span className="min-w-[2.5rem] text-center font-medium tabular-nums text-foreground">{value}</span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={value >= max}
          aria-label={`增加${label}`}
          className="px-2 py-1 text-sm leading-none text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          +
        </button>
      </span>
    </span>
  );
}

export default function SeatingCanvas({
  layoutType,
  rows,
  cols,
  groupCount = 4,
  groupSize = 6,
  gColsPerRow,
  seatsPerRow,
  perSide = 8,
  bottomWidth = 10,
  students,
  interactions,
  onLayoutChange,
  onSetRole,
  onRenameSeat,
  onAddInteraction,
  onRemoveInteraction,
  onClearInteractions,
  onClearRoles,
  onDedupInteractions,
}: Props) {
  const [mode, setMode] = useState<Mode>('role');
  // 小组围坐几何的回显值（夹取口径与 factory 一致）：历史数据没有这两个字段，回落旧行为
  // （每行 min(组数,2) 组、组内每行 3 席），保证渲染旧课例不报错、坐标不变。
  const groupCountClamped = Math.max(1, Math.round(groupCount) || 1);
  const groupColsMax = Math.min(groupCountClamped, 6);
  const groupColsRaw =
    typeof gColsPerRow === 'number' && Number.isFinite(gColsPerRow)
      ? Math.round(gColsPerRow)
      : Math.min(groupCountClamped, 2);
  const effGroupCols = Math.max(1, Math.min(groupColsRaw, groupColsMax));
  const seatsPerRowRaw =
    typeof seatsPerRow === 'number' && Number.isFinite(seatsPerRow) ? Math.round(seatsPerRow) : 3;
  const effSeatsPerRow = Math.max(1, Math.min(seatsPerRowRaw, 8));
  // 默认不预选角色笔刷：避免「点座位就自动标成组织引领型」的误操作，
  // 用户必须先在工具条显式选择一个角色，或先给座位命名。
  const [roleBrush, setRoleBrush] = useState<StudentRole | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  // 正在命名/编号的座位（替代双击 + window.prompt；后者在手机上无法触发且 Via 不弹原生框）
  const [renameTarget, setRenameTarget] = useState<SeatStudent | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [edgeType, setEdgeType] = useState<InteractionType>('share');
  const [bidirectional, setBidirectional] = useState(false);
  // 清空是不可逆动作，但标注工作台里没有弹窗组件、window.confirm 在部分安卓 WebView（如 Via）不弹，
  // 所以改成工具条下方的就地二次确认：先点「清空…」再点「确认清空」。
  const [confirmClear, setConfirmClear] = useState<'interactions' | 'roles' | null>(null);
  // 刚连过线的提示：用来说明「重复连线会覆盖而不是叠加」，消掉「没点上？再点一次」的错觉
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 同向同座位对出现多次即为重复连线（历史数据里会有一模一样的两条箭头叠在一起看不出来）
  const duplicateCount = useMemo(() => {
    const seen = new Map<string, number>();
    interactions.forEach((e) => {
      const k = `${e.from_seat_id}>${e.to_seat_id}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    });
    let extra = 0;
    seen.forEach((n) => {
      if (n > 1) extra += n - 1;
    });
    return extra;
  }, [interactions]);

  function openRename(s: SeatStudent) {
    setRenameTarget(s);
    setRenameValue(s.name ?? s.student_no ?? '');
  }

  function confirmRename() {
    if (!renameTarget) return;
    const v = renameValue.trim();
    onRenameSeat(renameTarget.seat_id, v ? { student_no: v, name: v } : { student_no: '', name: '' });
    setRenameTarget(null);
    setRenameValue('');
  }

  // 常见班额区间 20-50 人；超出只提示不拦截（合班课、公开课确实会超过 50 人）
  const outOfRange = students.length > 0 && (students.length < 20 || students.length > 50);

  const width = PAD_X * 2 + (cols - 1) * CELL + NODE;
  const height = PAD_TOP + PAD_BOTTOM + (rows - 1) * CELL + NODE;

  const bySeat = useMemo(() => {
    const m = new Map<string, SeatStudent>();
    students.forEach((s) => m.set(s.seat_id, s));
    return m;
  }, [students]);

  function handleSeatClick(s: SeatStudent) {
    if (mode === 'role') {
      // 未选角色笔刷时，点座位进入命名（与桌面端双击等价的移动端可达路径）；
      // 已选笔刷时：点同角色清除，点其他角色上色。
      if (roleBrush === null) {
        openRename(s);
        return;
      }
      onSetRole(s.seat_id, s.role === roleBrush ? null : roleBrush);
    } else {
      if (!linkFrom) {
        setLinkFrom(s.seat_id);
        setLinkNotice(null);
      } else if (linkFrom === s.seat_id) {
        setLinkFrom(null);
      } else {
        const dup = interactions.some((e) => e.from_seat_id === linkFrom && e.to_seat_id === s.seat_id);
        onAddInteraction({ from_seat_id: linkFrom, to_seat_id: s.seat_id, bidirectional, type: edgeType });
        // 重复连线不会叠成两条：已把那条改成当前类型，明确告知，避免用户以为没连上又点一次
        setLinkNotice(dup ? '这一对之间已有连线，已按当前类型更新，不会重复叠加。' : null);
        setLinkFrom(null);
      }
    }
  }

  const layoutOptions: SeatLayoutType[] = ['rows', 'groups', 'u_shape'];

  return (
    <div className="space-y-3">
      {/* P1-7：明确标注为选做，消除「不标会不会影响出报告」的顾虑 */}
      <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.04] px-3 py-1.5 text-[11px] leading-relaxed text-primary/90">
        座位与互动标注为选做：不标注也能正常生成分析报告；标注后可额外呈现课堂互动关系图，让评价更立体。
      </div>
      {/* 工具条 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-muted/40 p-2">
        <div className="flex rounded-lg border border-border bg-card p-0.5 shadow-sm">
          {(['role', 'link'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setLinkFrom(null);
              }}
              className={`rounded px-3 py-1 text-xs font-medium ${
                mode === m ? 'bg-brand-gradient text-white shadow-sm' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {m === 'role' ? '角色标注' : '互动连线'}
            </button>
          ))}
        </div>

        {mode === 'role' && (
          <div className="flex items-center gap-1">
            {(Object.keys(STUDENT_ROLE_META) as StudentRole[]).map((r) => {
              const meta = STUDENT_ROLE_META[r];
              const active = roleBrush === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRoleBrush(r)}
                  title={`${meta.name}：${meta.description}`}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                    active ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  <span className="text-sm leading-none">{meta.symbol}</span> {meta.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setRoleBrush(null)}
              title="橡皮擦：只取消笔刷，不改动已经标好的角色。要清空全部角色请用右侧「清空角色」"
              className={`rounded-md border px-2 py-1 text-xs ${
                roleBrush === null ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
              }`}
            >
              橡皮擦
            </button>
          </div>
        )}

        {mode === 'link' && (
          <div className="flex flex-wrap items-center gap-1">
            <select
              value={edgeType}
              onChange={(e) => setEdgeType(e.target.value as InteractionType)}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground"
            >
              {(Object.keys(INTERACTION_TYPE_LABEL) as InteractionType[]).map((t) => (
                <option key={t} value={t}>
                  {INTERACTION_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={bidirectional} onChange={(e) => setBidirectional(e.target.checked)} /> 双向
            </label>
            <span className="text-xs text-muted-foreground/80">
              {linkFrom ? '请点击目标座位（再点起点取消）' : '依次点击两个座位连线'}
            </span>
            {linkNotice && <span className="text-xs text-amber-600">{linkNotice}</span>}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {mode === 'link' && interactions.length > 0 && (
            <button
              type="button"
              onClick={() => onRemoveInteraction(interactions[interactions.length - 1].id)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              title="撤销最近一条连线"
            >
              撤销上一条
            </button>
          )}
          {/* 历史数据里叠在一起、肉眼分不清的重复连线，一键合并。不锁模式：任何模式下都该能清理 */}
          {duplicateCount > 0 && (
            <button
              type="button"
              onClick={onDedupInteractions}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100"
              title={`有 ${duplicateCount} 条连线重复叠在一起，合并后每对座位只保留一条`}
            >
              合并重复 {duplicateCount} 条
            </button>
          )}
          {/* 清空是破坏性操作，按钮常驻但需要二次确认 */}
          {interactions.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClear(confirmClear === 'interactions' ? null : 'interactions')}
              className={`rounded-md border px-2 py-1 text-xs ${
                confirmClear === 'interactions'
                  ? 'border-destructive bg-destructive/10 text-destructive'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              清空连线
            </button>
          )}
          {students.some((s) => s.role) && (
            <button
              type="button"
              onClick={() => setConfirmClear(confirmClear === 'roles' ? null : 'roles')}
              className={`rounded-md border px-2 py-1 text-xs ${
                confirmClear === 'roles'
                  ? 'border-destructive bg-destructive/10 text-destructive'
                  : 'border-border bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              清空角色
            </button>
          )}
          {layoutOptions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onLayoutChange(t, defaultSeatParams(t))}
              className={`rounded-md border px-2 py-1 text-xs ${
                layoutType === t ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
              }`}
            >
              {SEAT_LAYOUT_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {/* 就地二次确认：不弹窗，避免安卓 WebView（Via 等）不弹原生 confirm 而卡死 */}
      {confirmClear && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs">
          <span className="text-destructive">
            {confirmClear === 'interactions'
              ? `确认清空全部 ${interactions.length} 条互动连线？清空后需重新标注。`
              : `确认清空全部 ${students.filter((s) => s.role).length} 个座位的角色标记？座位姓名/编号会保留。`}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (confirmClear === 'interactions') onClearInteractions();
                else onClearRoles();
                setConfirmClear(null);
              }}
              className="rounded-md border border-destructive bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground"
            >
              确认清空
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(null)}
              className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
            >
              再想想
            </button>
          </span>
        </div>
      )}

      {/* 座位数配置：三种布局都能按实际教室调，人数不再被布局写死 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border/80 bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium text-foreground">座位配置</span>
        {layoutType === 'rows' && (
          <>
            <Stepper label="行数" value={rows} min={3} max={12} onChange={(v) => onLayoutChange('rows', { rows: v, cols })} />
            <Stepper label="列数" value={cols} min={3} max={10} onChange={(v) => onLayoutChange('rows', { rows, cols: v })} />
          </>
        )}
        {layoutType === 'groups' && (
          <>
            <Stepper label="小组数" value={groupCount} min={2} max={12} onChange={(v) => onLayoutChange('groups', { groupCount: v, groupSize })} />
            <Stepper label="每组人数" value={groupSize} min={3} max={10} onChange={(v) => onLayoutChange('groups', { groupCount, groupSize: v })} />
            {/* 几何参数：与小组数/每组人数同时提交，避免覆盖丢失其他参数（如 3x3 摆位需每行 3 组） */}
            <Stepper
              label="每行组数"
              value={effGroupCols}
              min={1}
              max={groupColsMax}
              onChange={(v) =>
                onLayoutChange('groups', { groupCount, groupSize, gColsPerRow: v, seatsPerRow: effSeatsPerRow })
              }
            />
            <Stepper
              label="每组每行人数"
              value={effSeatsPerRow}
              min={1}
              max={8}
              onChange={(v) =>
                onLayoutChange('groups', { groupCount, groupSize, gColsPerRow: effGroupCols, seatsPerRow: v })
              }
            />
          </>
        )}
        {layoutType === 'u_shape' && (
          <>
            <Stepper label="每边座位" value={perSide} min={3} max={14} onChange={(v) => onLayoutChange('u_shape', { rows: v, cols: bottomWidth })} />
            <Stepper label="底边座位" value={bottomWidth} min={4} max={16} onChange={(v) => onLayoutChange('u_shape', { rows: perSide, cols: v })} />
          </>
        )}
        <span className="ml-auto tabular-nums text-muted-foreground">
          共 <b className={outOfRange ? 'text-amber-700' : 'text-foreground'}>{students.length}</b> 人
          {outOfRange && <span className="text-amber-600">（超出常见班额 20-50 人，请确认参数）</span>}
        </span>
      </div>

      {/* 操作提示 + 命名条 */}
      {mode === 'role' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {roleBrush === null ? (
            <span>
              点击任意座位可填写学生姓名/编号；选择上方角色后，再点座位即可标记角色（再次点击取消）。
            </span>
          ) : (
            <span>
              当前笔刷：<span className="font-medium text-foreground">{STUDENT_ROLE_META[roleBrush].name}</span>
              ，点击座位标记，再点同一座位取消；点「清除」后恢复命名模式。
            </span>
          )}
        </div>
      )}
      {renameTarget && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <span className="text-xs text-muted-foreground">
            {renameTarget.seat_id} 姓名/编号（可留空）：
          </span>
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename();
              if (e.key === 'Escape') {
                setRenameTarget(null);
                setRenameValue('');
              }
            }}
            placeholder="如：3号 / 小明"
            className="h-8 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
          />
          <button
            type="button"
            onClick={confirmRename}
            className="h-8 rounded-md bg-brand-gradient px-3 text-xs font-medium text-white"
          >
            确定
          </button>
          <button
            type="button"
            onClick={() => {
              setRenameTarget(null);
              setRenameValue('');
            }}
            className="h-8 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground"
          >
            取消
          </button>
        </div>
      )}

      {/* 画布 */}
      <div ref={wrapRef} className="overflow-auto rounded-xl border border-border/80 bg-card bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]">
        <div className="relative" style={{ width, height }}>
          {/* 讲台 */}
          <div className="absolute left-1/2 -translate-x-1/2 rounded-md bg-foreground px-8 py-1.5 text-xs text-background" style={{ top: 20 }}>
            讲台
          </div>

          {/* 互动箭头层 */}
          <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
            <defs>
              {(Object.keys(EDGE_COLOR) as InteractionType[]).map((t) => (
                <marker
                  key={t}
                  id={`arrow_${t}`}
                  markerWidth="8"
                  markerHeight="8"
                  refX="6"
                  refY="3"
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d="M0,0 L6,3 L0,6 Z" fill={EDGE_COLOR[t]} />
                </marker>
              ))}
            </defs>
            {interactions.map((e) => {
              const a = bySeat.get(e.from_seat_id);
              const b = bySeat.get(e.to_seat_id);
              if (!a || !b) return null;
              const p1 = seatCenter(a);
              const p2 = seatCenter(b);
              const color = EDGE_COLOR[e.type];
              return (
                <g key={e.id} className="pointer-events-auto">
                  <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={2} markerEnd={`url(#arrow_${e.type})`} />
                  {e.bidirectional && (
                    <line
                      x1={p2.x}
                      y1={p2.y}
                      x2={p1.x}
                      y2={p1.y}
                      stroke={color}
                      strokeWidth={2}
                      strokeOpacity={0.55}
                      markerEnd={`url(#arrow_${e.type})`}
                    />
                  )}
                </g>
              );
            })}
          </svg>

          {/* 座位层 */}
          {students.map((s) => {
            const center = seatCenter(s);
            const rs = s.role ? ROLE_STYLE[s.role] : null;
            const isLinkStart = linkFrom === s.seat_id;
            return (
              <div
                key={s.seat_id}
                className="absolute"
                style={{ left: center.x - NODE / 2, top: center.y - NODE / 2, width: NODE, height: NODE }}
              >
                <button
                  type="button"
                  onClick={() => handleSeatClick(s)}
                  onDoubleClick={() => openRename(s)}
                  title={
                    mode === 'role' && roleBrush === null
                      ? `${s.seat_id}：点击命名/编号`
                      : `${s.seat_id}${s.name ? ' · ' + s.name : ''}（点击应用当前角色）`
                  }
                  className={`flex h-11 w-11 touch-manipulation items-center justify-center rounded-md border text-sm font-semibold transition ${
                    rs
                      ? `${rs.bg} ${rs.text} ring-2 ${rs.ring} border-transparent`
                      : 'border-border bg-card text-muted-foreground/60 hover:border-primary/40'
                  } ${isLinkStart ? 'ring-2 ring-amber-400' : ''} ${
                    mode === 'role' && roleBrush === null ? 'cursor-text' : ''
                  }`}
                >
                  {s.role ? STUDENT_ROLE_META[s.role].symbol : (s.name ?? s.student_no ?? '')}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 互动清单 */}
      {interactions.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {interactions.map((e) => {
            const a = bySeat.get(e.from_seat_id);
            const b = bySeat.get(e.to_seat_id);
            return (
              <li key={e.id} className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-xs text-foreground/80 shadow-sm">
                <span className="h-2 w-2 rounded-full" style={{ background: EDGE_COLOR[e.type] }} />
                {a?.name || a?.student_no || e.from_seat_id}
                <span className="text-muted-foreground/40">{e.bidirectional ? '⇄' : '→'}</span>
                {b?.name || b?.student_no || e.to_seat_id}
                <span className="text-muted-foreground/70">· {INTERACTION_TYPE_LABEL[e.type]}</span>
                <button
                  type="button"
                  onClick={() => onRemoveInteraction(e.id)}
                  className="ml-1 rounded-full px-1.5 text-muted-foreground/40 hover:bg-red-50 hover:text-red-600"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
