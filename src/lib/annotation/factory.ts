// 人工标注工作台的纯函数工具：id、默认标注、三种座位布局生成。
import type {
  LessonAnnotation,
  SeatingPlan,
  SeatLayoutType,
  SeatStudent,
} from '@/lib/evaluation/annotation-types';

let seq = 0;
export function uid(prefix = 'id'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 简单稳定的座位 id（便于切换布局时可读） */
function seatId(row: number, col: number): string {
  return `s_${row}_${col}`;
}

/** 座位布局的可调参数集合 */
export type SeatParams = {
  rows: number;
  cols: number;
  groupCount?: number;
  groupSize?: number;
  /** 小组围坐式：每行摆几个组；缺省沿用旧几何 min(groupCount, 2) */
  gColsPerRow?: number;
  /** 小组围坐式：组内每行座位数；缺省 3（与历史数据一致） */
  seatsPerRow?: number;
};

/**
 * seating 结构的扩展：小组围坐式的几何参数随标注 payload 一起持久化。
 * 历史课例的 seating 里没有这两个字段（均可选），读取方按缺省行为回落，
 * 不会改变已有学生的坐标，也不会让历史数据报错。
 */
export type SeatingPlanEx = SeatingPlan & {
  g_cols_per_row?: number;
  seats_per_row?: number;
};

/** 各布局的默认参数（默认总人数均落在 20-50 人的常见班额区间） */
export const SEAT_DEFAULTS: Record<SeatLayoutType, SeatParams> = {
  rows: { rows: 6, cols: 7 }, // 42 人
  groups: { rows: 0, cols: 0, groupCount: 5, groupSize: 8, gColsPerRow: 2, seatsPerRow: 3 }, // 5 组 x 8 人 = 40 人
  u_shape: { rows: 8, cols: 10 }, // 每边 8 + 底边 8 = 24 人
};

/** 切换布局时给出该布局的默认座位参数 */
export function defaultSeatParams(layoutType: SeatLayoutType): SeatParams {
  const d = SEAT_DEFAULTS[layoutType];
  return layoutType === 'groups'
    ? {
        rows: 0,
        cols: 0,
        groupCount: d.groupCount ?? 5,
        groupSize: d.groupSize ?? 8,
        gColsPerRow: d.gColsPerRow ?? 2,
        seatsPerRow: d.seatsPerRow ?? 3,
      }
    : { rows: d.rows, cols: d.cols };
}

/** 参数夹取：undefined/NaN 等非法值回落默认值，再夹到 [min, max]，避免 0/负数造成错位或死循环 */
function clampInt(v: number | undefined, dft: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dft;
  return Math.max(min, Math.min(max, n));
}

/**
 * 生成三种布局的学生座位（不含讲台，讲台由视图固定绘制）。
 * rows：秧田式行列（总人数 = rows x cols）；
 * groups：组数 x 每组人数，几何由 gColsPerRow（每行组数）与 seatsPerRow（组内每行座位数）驱动，
 *   缺省分别是 min(groupCount, 2) 与 3（与历史数据完全一致），可调出 3x3 等任意组合；
 * u_shape：rows = 每边座位数、cols = 底边座位数（总人数 = rows*2 + cols-2）。
 */
export function buildSeating(
  layoutType: SeatLayoutType,
  rows: number,
  cols: number,
  groupCount = 4,
  groupSize = 6,
  gColsPerRow?: number,
  seatsPerRow?: number,
): SeatingPlanEx {
  const students: SeatStudent[] = [];

  if (layoutType === 'rows') {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        students.push({ seat_id: seatId(r, c), row: r, col: c, role: null, group: null });
      }
    }
    return { layout_type: layoutType, rows, cols, students };
  }

  if (layoutType === 'groups') {
    // 每组人数可配（默认 6）：组内每行 seatsPerRow 席，行数按每组人数上取整；组间留白 2 列 / 1 行。
    const perGroup = Math.max(1, Math.round(groupSize));
    const gCount = Math.max(1, Math.round(groupCount));
    // 每行组数：缺省沿用旧几何 min(组数, 2)；夹到 [1, min(组数, 6)]，组数不足时不越界。
    const gCols = clampInt(gColsPerRow, Math.min(gCount, 2), 1, Math.min(gCount, 6));
    // 组内每行座位数：缺省 3（与历史数据一致）；夹到 [1, 8]，避免 0/负数造成除零或错位。
    const inRow = clampInt(seatsPerRow, 3, 1, 8);
    const rowsPerGroup = Math.ceil(perGroup / inRow);
    const groupW = inRow + 2; // 组宽 = 座位数 + 2 列组间留白（inRow=3 时为 5，与旧几何一致）
    const groupH = rowsPerGroup + 1; // 组高（含与下一组的 1 行间隔）
    for (let g = 0; g < gCount; g += 1) {
      const gRow = Math.floor(g / gCols);
      const gCol = g % gCols;
      for (let k = 0; k < perGroup; k += 1) {
        const r = gRow * groupH + Math.floor(k / inRow);
        const c = gCol * groupW + (k % inRow);
        students.push({
          seat_id: seatId(r, c),
          row: r,
          col: c,
          role: null,
          group: `第${g + 1}组`,
        });
      }
    }
    return {
      layout_type: layoutType,
      rows: Math.ceil(gCount / gCols) * groupH,
      cols: gCols * groupW,
      group_count: gCount,
      group_size: perGroup,
      g_cols_per_row: gCols,
      seats_per_row: inRow,
      students,
    };
  }

  // u_shape：沿 U 型三边布点。底边开口朝讲台（讲台在上方时，U 开口向上）。
  // rows = 每边座位数，cols = 底边宽度（总人数 = rows*2 + cols-2），两者均可调。
  const nPerSide = Math.max(2, Math.round(rows));
  const width = Math.max(4, Math.round(cols));
  let r = 0;
  for (let i = 0; i < nPerSide; i += 1) {
    students.push({ seat_id: seatId(r, 0), row: r, col: 0, role: null, group: null });
    students.push({ seat_id: seatId(r, width - 1), row: r, col: width - 1, role: null, group: null });
    r += 1;
  }
  // 底边（封闭的一侧）补一排
  const bottomRow = nPerSide;
  for (let c = 0; c < width; c += 1) {
    if (c === 0 || c === width - 1) continue;
    students.push({ seat_id: seatId(bottomRow, c), row: bottomRow, col: c, role: null, group: null });
  }
  // rows/cols 存几何行列（画布据此算尺寸），用户调的每边/底边另存 per_side/bottom_width 供回显
  return {
    layout_type: layoutType,
    rows: bottomRow + 1,
    cols: width,
    per_side: nPerSide,
    bottom_width: width,
    students,
  };
}

/** 维度评分的初始结构（五维，未评分 null）。 */
export function defaultDimensionScores(dimensions: { code: string }[]) {
  return dimensions.map((d) => ({ dimension_code: d.code, score: null as number | null, comment: '' }));
}

/** 构造一份空白标注。 */
export function emptyAnnotation(dimensionCodes: string[] = []): LessonAnnotation {
  return {
    lesson_id: '',
    seating: buildSeating('rows', 6, 7),
    role_timeline: [],
    interactions: [],
    events: [],
    phases: [],
    dimension_scores: defaultDimensionScores(dimensionCodes.map((c) => ({ code: c }))),
    observer_sheet: [],
    updated_at: new Date().toISOString(),
  };
}
