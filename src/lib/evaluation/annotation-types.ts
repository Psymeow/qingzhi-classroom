// ============================================================
// 人工标注工作台 · 数据模型（AI 数据与人工数据分开存储，可独立调用、可融合）
// ============================================================

/** 座位布局模板 */
export type SeatLayoutType = "rows" | "groups" | "u_shape";
export const SEAT_LAYOUT_LABEL: Record<SeatLayoutType, string> = {
  rows: "秧田式",
  groups: "小组围坐式",
  u_shape: "U型",
};

/** 学生课堂角色（对应观察表符号） */
export type StudentRole = "leader" | "participant" | "observer";
export const STUDENT_ROLE_META: Record<
  StudentRole,
  { symbol: string; name: string; description: string }
> = {
  leader: { symbol: "▲", name: "组织引领型", description: "小组内发挥组织、示范、带动作用" },
  participant: { symbol: "■", name: "协同参与型", description: "积极参与讨论、配合合作、跟进思考" },
  observer: { symbol: "●", name: "观察记录型", description: "以倾听、记录为主，参与度较低" },
};

/** 座位上的学生 */
export interface SeatStudent {
  seat_id: string;
  student_no?: string;
  name?: string;
  group?: string | null;
  /** 网格坐标（0 起），用于可视化排布 */
  row: number;
  col: number;
  /** 当前角色，可空（未标注） */
  role?: StudentRole | null;
}

/** 角色随时间的动态变化（如某环节从观望转为参与） */
export interface RoleTimelinePoint {
  seat_id: string;
  /** 秒 */
  time_sec: number;
  role: StudentRole;
  note?: string;
}

/** 互动类型 */
export type InteractionType =
  | "ask_help" // 提问求助
  | "share" // 观点分享
  | "supplement" // 补充修正
  | "collaborate"; // 协作解题
export const INTERACTION_TYPE_LABEL: Record<InteractionType, string> = {
  ask_help: "提问求助",
  share: "观点分享",
  supplement: "补充修正",
  collaborate: "协作解题",
};

/** 互动箭头（连接两个座位） */
export interface InteractionEdge {
  id: string;
  from_seat_id: string;
  to_seat_id: string;
  /** true 双向，false 单向 */
  bidirectional: boolean;
  type: InteractionType;
  /** 所属教学环节，可空表示全程 */
  phase?: string | null;
  /** 秒，可空 */
  time_sec?: number | null;
  note?: string;
}

/** 典型事件打点分类 */
export type EventCategory =
  | "thinking_highlight" // 思维高光
  | "emotion_event" // 情感典型
  | "qz_integration" // 情智融合
  | "to_improve"; // 待改进
export const EVENT_CATEGORY_LABEL: Record<EventCategory, string> = {
  thinking_highlight: "思维高光时刻",
  emotion_event: "情感典型事件",
  qz_integration: "情智融合节点",
  to_improve: "待改进节点",
};

/** 事件打点 → 关联到的评价维度（用于证据联动） */
export const EVENT_CATEGORY_DIMENSION: Record<EventCategory, string[]> = {
  thinking_highlight: ["D2"],
  emotion_event: ["D3"],
  qz_integration: ["D1", "D4"],
  to_improve: ["D4"],
};

export interface TimelineEvent {
  id: string;
  /** 秒，自动记录时间戳 */
  time_sec: number;
  category: EventCategory;
  note: string;
  /** 关联维度，默认按分类映射，可手动改 */
  dimension_codes?: string[];
  /** 关联学生座位，可空 */
  seat_ids?: string[];
}

/** 座位排布整体 */
export interface SeatingPlan {
  layout_type: SeatLayoutType;
  rows: number;
  cols: number;
  group_count?: number;
  /** 小组围坐式：每组人数；旧数据缺省按 6 处理 */
  group_size?: number;
  /** U 型：每边座位数（rows/cols 存的是几何行列，调节回显需用本字段）；旧数据缺省回退 rows */
  per_side?: number;
  /** U 型：底边座位数；旧数据缺省回退 cols */
  bottom_width?: number;
  students: SeatStudent[];
}

/** 人工分项评分（对应五维，0-10） */
export interface ManualDimensionScore {
  dimension_code: string;
  /** 0-10，null 表示未评分 */
  score: number | null;
  comment?: string;
}

/** 观察表 20 分分项（表2 一~九项，供参考性记录，可空） */
export interface ObserverSheetScore {
  item_code: string;
  item_name: string;
  score: number | null;
  max_score: number;
  comment?: string;
}

/** 教学环节（用于分段标注） */
export interface TeachingPhase {
  code: string;
  name: string;
  start_sec?: number | null;
  end_sec?: number | null;
}

/** 一整节课的人工标注聚合（AI/人工分离存储） */
export interface LessonAnnotation {
  lesson_id: string;
  seating: SeatingPlan;
  role_timeline: RoleTimelinePoint[];
  interactions: InteractionEdge[];
  events: TimelineEvent[];
  phases: TeachingPhase[];
  dimension_scores: ManualDimensionScore[];
  observer_sheet: ObserverSheetScore[];
  updated_at: string;
}
