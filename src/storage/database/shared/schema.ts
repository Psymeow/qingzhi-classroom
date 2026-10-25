import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { pgPolicy } from "drizzle-orm/pg-core/policies";

// RLS 判定表达式：auth.uid() 与业务列 user_id 比较
const ownUser = sql`(auth.uid()::text = user_id)`;
const ownId = sql`(auth.uid() = id)`;

// ============================================================
// 情智相长课堂分析工作台 · 数据库 Schema
// 分层：标准配置 / 课例 / 多源数据(AI 与人工分离) / 标注 / 报告
// 约定：snake_case；时间带时区；外键必带 references + 索引；jsonb 高频列建 GIN。
// ============================================================

// ---------- 系统表（禁止删除，迁移权限依赖） ----------
export const healthCheck = pgTable("health_check", {
  id: serial("id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow(),
});

// ---------- 评价标准集（配置化、版本管理、校本替换） ----------
export const standardSets = pgTable(
  "standard_sets",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    code: varchar("code", { length: 64 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    version: varchar("version", { length: 32 }).notNull().default("1.0"),
    subject: varchar("subject", { length: 32 }).notNull().default("math"),
    scope: varchar("scope", { length: 16 }).notNull().default("builtin"), // builtin / school / personal
    description: text("description"),
    // 完整标准 JSON：dimensions / indicators / lesson_types
    content: jsonb("content").notNull(),
    is_active: boolean("is_active").notNull().default(true),
    owner_id: varchar("owner_id", { length: 64 }), // null=系统内置
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("standard_sets_owner_idx").on(t.owner_id),
    index("standard_sets_code_idx").on(t.code, t.version),
    pgPolicy("standard_sets_read", {
      as: "permissive",
      for: "select",
      using: sql`(is_active = true or auth.uid()::text = owner_id)`,
    }),
    pgPolicy("standard_sets_insert_own", {
      as: "permissive",
      for: "insert",
      withCheck: sql`(auth.uid()::text = owner_id)`,
    }),
    pgPolicy("standard_sets_update_own", {
      as: "permissive",
      for: "update",
      using: sql`(auth.uid()::text = owner_id)`,
      withCheck: sql`(auth.uid()::text = owner_id)`,
    }),
    pgPolicy("standard_sets_delete_own", {
      as: "permissive",
      for: "delete",
      using: sql`(auth.uid()::text = owner_id)`,
    }),
  ],
);

// ---------- 用户资料（与 auth.users 关联，存姓名/单位等业务字段） ----------
export const profiles = pgTable(
  "profiles",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // = auth.users.id
    display_name: varchar("display_name", { length: 128 }),
    role_title: varchar("role_title", { length: 64 }), // 教研员/教师/研究者
    organization: varchar("organization", { length: 255 }), // 学校/单位
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    pgPolicy("profiles_select_own", { as: "permissive", for: "select", using: ownId }),
    pgPolicy("profiles_insert_own", { as: "permissive", for: "insert", withCheck: ownId }),
    pgPolicy("profiles_update_own", { as: "permissive", for: "update", using: ownId, withCheck: ownId }),
  ],
);

// ---------- 课例（一节课的顶层对象，归属用户） ----------
export const lessons = pgTable(
  "lessons",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 36 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    teacher_name: varchar("teacher_name", { length: 128 }),
    school: varchar("school", { length: 255 }),
    grade_class: varchar("grade_class", { length: 128 }),
    lesson_type: varchar("lesson_type", { length: 32 }), // new/review/comment/practice/topic（手册课型；旧值 exercise→review、inquiry→practice）
    subject: varchar("subject", { length: 32 }).notNull().default("math"),
    lesson_date: timestamp("lesson_date", { withTimezone: true, mode: "string"}),
    duration_sec: integer("duration_sec"),
    standard_set_id: varchar("standard_set_id", { length: 36 }).references(() => standardSets.id),
    status: varchar("status", { length: 24 }).notNull().default("draft"), // draft/analyzed/reviewed
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lessons_user_id_idx").on(t.user_id),
    index("lessons_status_idx").on(t.status),
    index("lessons_updated_idx").on(t.updated_at),
    pgPolicy("lessons_select_own", { as: "permissive", for: "select", using: ownUser }),
    pgPolicy("lessons_insert_own", { as: "permissive", for: "insert", withCheck: ownUser }),
    pgPolicy("lessons_update_own", { as: "permissive", for: "update", using: ownUser, withCheck: ownUser }),
    pgPolicy("lessons_delete_own", { as: "permissive", for: "delete", using: ownUser }),
  ],
);

// ---------- 数据接入：上传的素材（音视频/教案/任务单/观察记录） ----------
export interface AssetMeta {
  kind: "av_video" | "av_audio" | "lesson_plan" | "task_sheet" | "observer_record" | "transcript";
  file_name: string;
  file_url?: string;
  mime_type?: string;
  size_bytes?: number;
  note?: string;
  // 任务单/观察记录的附加元信息
  sheet_count?: number;
}

export const lessonAssets = pgTable(
  "lesson_assets",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    lesson_id: varchar("lesson_id", { length: 36 }).notNull().references(() => lessons.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    file_name: varchar("file_name", { length: 512 }).notNull(),
    file_url: text("file_url"),
    mime_type: varchar("mime_type", { length: 128 }),
    size_bytes: integer("size_bytes"),
    note: text("note"),
    meta: jsonb("meta"),
    parse_status: varchar("parse_status", { length: 24 }).notNull().default("pending"), // pending/parsed/failed/skipped
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("lesson_assets_lesson_idx").on(t.lesson_id),
    index("lesson_assets_user_idx").on(t.user_id),
    index("lesson_assets_kind_idx").on(t.kind),
    pgPolicy("assets_select_own", { as: "permissive", for: "select", using: ownUser }),
    pgPolicy("assets_insert_own", { as: "permissive", for: "insert", withCheck: ownUser }),
    pgPolicy("assets_update_own", { as: "permissive", for: "update", using: ownUser, withCheck: ownUser }),
    pgPolicy("assets_delete_own", { as: "permissive", for: "delete", using: ownUser }),
  ],
);

// ---------- AI/文档解析数据（与人工分离）：转写文稿、语义结构、任务单/观察解析 ----------
export const aiAnalysisInputs = pgTable(
  "ai_analysis_inputs",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    lesson_id: varchar("lesson_id", { length: 36 }).notNull().references(() => lessons.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).notNull(),
    // 导入的音视频转写原文（V1.1 手动导入；V1.2 ASR 自动）
    transcript: text("transcript"),
    transcript_source: varchar("transcript_source", { length: 24 }).notNull().default("manual"), // manual/asr
    // 观察员自由文本记录
    observer_text: text("observer_text"),
    // 学生任务单解析出的纯文本（V1.4 接入：上传 → 文档解析 → 参与 AI 语义评分）
    task_sheet_text: text("task_sheet_text"),
    // 教学设计（教案）解析出的纯文本（V1.9 接入：作为"设计"类指标的分析素材，只进通用指标评分链）
    lesson_plan_text: text("lesson_plan_text"),
    // V1.2 预留：任务单 OCR / 观察记录结构化解析（指标级分数、样本等）
    task_sheet_result: jsonb("task_sheet_result"),
    observer_result: jsonb("observer_result"),
    // 语义规则命中（可观测，便于复核）
    signal_hits: jsonb("signal_hits"),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ai_inputs_lesson_idx").on(t.lesson_id),
    pgPolicy("ai_inputs_select_own", { as: "permissive", for: "select", using: ownUser }),
    pgPolicy("ai_inputs_insert_own", { as: "permissive", for: "insert", withCheck: ownUser }),
    pgPolicy("ai_inputs_update_own", { as: "permissive", for: "update", using: ownUser, withCheck: ownUser }),
    pgPolicy("ai_inputs_delete_own", { as: "permissive", for: "delete", using: ownUser }),
  ],
);

// ---------- 人工标注（整体 JSON：座位/角色/互动/打点/环节/人工评分） ----------
export const annotations = pgTable(
  "annotations",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    lesson_id: varchar("lesson_id", { length: 36 }).notNull().references(() => lessons.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).notNull(),
    // 完整 LessonAnnotation JSON
    payload: jsonb("payload").notNull(),
    version: integer("version").notNull().default(1),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("annotations_lesson_idx").on(t.lesson_id),
    pgPolicy("annotations_select_own", { as: "permissive", for: "select", using: ownUser }),
    pgPolicy("annotations_insert_own", { as: "permissive", for: "insert", withCheck: ownUser }),
    pgPolicy("annotations_update_own", { as: "permissive", for: "update", using: ownUser, withCheck: ownUser }),
    pgPolicy("annotations_delete_own", { as: "permissive", for: "delete", using: ownUser }),
  ],
);

// ---------- 分析报告（融合结果 + 权重 + 来源齐备性 + 人工校准） ----------
export const reports = pgTable(
  "reports",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    lesson_id: varchar("lesson_id", { length: 36 }).notNull().references(() => lessons.id, { onDelete: "cascade" }),
    user_id: varchar("user_id", { length: 36 }).notNull(),
    standard_code: varchar("standard_code", { length: 64 }).notNull(),
    standard_version: varchar("standard_version", { length: 32 }).notNull(),
    total_score: numeric("total_score", { precision: 5, scale: 1 }).notNull().default("0"),
    total_level: varchar("total_level", { length: 32 }),
    // 完整 AnalysisReport JSON
    result: jsonb("result").notNull(),
    // 权重调节快照
    source_weights: jsonb("source_weights"),
    need_review_count: integer("need_review_count").notNull().default(0),
    is_calibrated: boolean("is_calibrated").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("reports_lesson_idx").on(t.lesson_id),
    index("reports_user_idx").on(t.user_id),
    pgPolicy("reports_select_own", { as: "permissive", for: "select", using: ownUser }),
    pgPolicy("reports_insert_own", { as: "permissive", for: "insert", withCheck: ownUser }),
    pgPolicy("reports_update_own", { as: "permissive", for: "update", using: ownUser, withCheck: ownUser }),
    pgPolicy("reports_delete_own", { as: "permissive", for: "delete", using: ownUser }),
  ],
);
