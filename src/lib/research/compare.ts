// ============================================================
// 教研中心 · 对比计算（纯函数，客户端与服务端共用）
// 设计：把「一节课的分析结果」压缩成 LessonDigest，所有分组、差异、最优/最弱
// 判定都在这里做，页面只负责渲染。不引入 server-only 依赖，方便前端直接算。
// ============================================================

import { fallbackStandard } from '@/lib/evaluation/standard-registry';
import { lessonTypeLabel, lessonTypeShort } from '@/lib/lesson/constants';

/** 一节课在对比视图里的最小信息集 */
export interface LessonDigest {
  lesson_id: string;
  title: string;
  teacher_name: string | null;
  grade_class: string | null;
  school: string | null;
  /** 课型展示名 */
  lesson_type: string | null;
  /** 课型简称（标签位用） */
  lesson_type_short: string | null;
  lesson_date: string | null;
  updated_at: string | null;
  total_score: number;
  total_level: string;
  /** 五维分数（按标准维度顺序，缺失维度补齐为 null） */
  dimensions: DigestDimension[];
  /** 表一认知/情感内涵百分制（无内涵评价时 null） */
  cognitive: number | null;
  affective: number | null;
  /** 有分观察点 / 观察点总数（无内涵评价时为 0/0） */
  scored_points: number;
  total_points: number;
  /** 来源是否齐备 */
  sources: { av: boolean; observer: boolean; task_sheet: boolean };
  /** AI 是否实际参与评分 */
  ai_used: boolean;
  generated_at: string | null;
  /** 二级指标分（用于指标级差异） */
  indicators: DigestIndicator[];
}

export interface DigestDimension {
  code: string;
  name: string;
  score: number | null;
  level: string | null;
}

export interface DigestIndicator {
  code: string;
  name: string;
  dimension_code: string;
  dimension_name: string;
  score: number | null;
}

const STANDARD = fallbackStandard();

/** 五维名称按标准 order 排序：D1..D5 */
export const DIMENSION_META: { code: string; name: string }[] = [...STANDARD.dimensions]
  .sort((a, b) => a.order - b.order)
  .map((d) => ({ code: d.code, name: d.name }));

const INDICATOR_DIM = new Map(STANDARD.indicators.map((i) => [i.code, i.dimension_code]));

export function dimensionName(code: string): string {
  return DIMENSION_META.find((d) => d.code === code)?.name ?? code;
}

export function indicatorDimension(code: string): string {
  return INDICATOR_DIM.get(code) ?? '';
}

export function lessonTypeText(value?: string | null): { label: string; short: string } {
  if (!value) return { label: '未设置', short: '未设置' };
  return { label: lessonTypeLabel(value), short: lessonTypeShort(value) };
}

// ------------------------------------------------------------
// 课题归一化与自动分组（同课异构 / 同一教师多轮 / 同课型结构）
// ------------------------------------------------------------

const NOISE_WORDS =
  /(试教|试讲|试上|试课|第[一二三四五六七八九十\d]+次|正式课|正式|公开课|展示课|研讨课|录像课|录播课|重复课|第一课时|第二课时|第三课时|课时[一二三四五六七八九十\d]*)/g;

/**
 * 把课题标题归一化成「同一课题」的键：
 * 去掉书名号、括号备注（试教/正式/第几课时）、常见修饰词与空白。
 * 目的：让「七年级《因式分解》复习课（试教）」与「…复习课（正式）」落到同一组。
 */
export function normalizeTopic(title?: string | null): string {
  return (title ?? '')
    .replace(/[（(][^）)]{0,30}[）)]/g, '')
    .replace(/[《》〈〉“”'']/g, '')
    .replace(NOISE_WORDS, '')
    .replace(/[\s·、,，。.:：;；\-—_/|]/g, '')
    .toLowerCase();
}

export type GroupKind = 'multi_round' | 'same_topic' | 'same_structure';

export interface ResearchGroup {
  key: string;
  kind: GroupKind;
  label: string;
  hint: string;
  lessonIds: string[];
}

const GROUP_KIND_ORDER: Record<GroupKind, number> = {
  multi_round: 0,
  same_topic: 1,
  same_structure: 2,
};

/**
 * 从课例池里自动识别可对比的「教研组」：
 * 1) multi_round：同一教师 + 同一课题的多轮授课（试教→正式→再上）；
 * 2) same_topic：同一课题、不同教师（同课异构）；
 * 3) same_structure：同一课型下的多节课（教学结构相似，可横向对照）。
 * 只做「建议」，最终对比哪几节由用户在页面上勾选。
 */
export function suggestGroups(digests: LessonDigest[]): ResearchGroup[] {
  const groups: ResearchGroup[] = [];
  if (digests.length < 2) return groups;

  // 按归一化课题聚类
  const byTopic = new Map<string, LessonDigest[]>();
  for (const d of digests) {
    const key = normalizeTopic(d.title) || d.lesson_id;
    const arr = byTopic.get(key) ?? [];
    arr.push(d);
    byTopic.set(key, arr);
  }

  for (const [key, list] of byTopic) {
    if (list.length < 2) continue;
    const teachers = new Set(list.map((l) => (l.teacher_name ?? '').trim()).filter(Boolean));
    const topicName = list[0].title.replace(/[（(][^）)]{0,30}[）)]/g, '').trim() || list[0].title;

    if (teachers.size <= 1) {
      groups.push({
        key: `multi:${key}`,
        kind: 'multi_round',
        label: `同一教师多轮授课 · ${topicName}`,
        hint: `${list[0].teacher_name || '同一教师'}对同一课题上了 ${list.length} 次，可看改进轨迹`,
        lessonIds: list.map((l) => l.lesson_id),
      });
    }
    if (teachers.size >= 2) {
      groups.push({
        key: `topic:${key}`,
        kind: 'same_topic',
        label: `同课异构 · ${topicName}`,
        hint: `${teachers.size} 位教师上同一课题，可看设计差异`,
        lessonIds: list.map((l) => l.lesson_id),
      });
    }
  }

  // 同课型结构对照
  const byType = new Map<string, LessonDigest[]>();
  for (const d of digests) {
    const t = (d.lesson_type ?? '').trim();
    if (!t) continue;
    const arr = byType.get(t) ?? [];
    arr.push(d);
    byType.set(t, arr);
  }
  for (const [type, list] of byType) {
    if (list.length < 2) continue;
    // 若该课型的课全部已落在同一个课题组里，就不再重复建议
    const dup = groups.some(
      (g) =>
        (g.kind === 'same_topic' || g.kind === 'multi_round') &&
        g.lessonIds.length === list.length &&
        g.lessonIds.every((id) => list.some((l) => l.lesson_id === id)),
    );
    if (dup) continue;
    groups.push({
      key: `type:${type}`,
      kind: 'same_structure',
      label: `同课型结构对照 · ${lessonTypeLabel(type)}`,
      hint: `${list.length} 节课同为「${lessonTypeShort(type)}」，可横向看同结构的执行差异`,
      lessonIds: list.map((l) => l.lesson_id),
    });
  }

  return groups.sort(
    (a, b) =>
      GROUP_KIND_ORDER[a.kind] - GROUP_KIND_ORDER[b.kind] || b.lessonIds.length - a.lessonIds.length,
  );
}

/** 跨课例 AI 教研洞察（服务端生成，前端只读展示） */
export interface ResearchInsight {
  /** 一句话总述（2-3 句） */
  overview: string;
  /** 共同亮点 */
  commonalities: string[];
  /** 关键差异：定位到具体维度/指标 + 教学解读 */
  differences: { title: string; detail: string }[];
  /** 可迁移做法 */
  transferables: string[];
  /** 下一步教研建议 */
  next_steps: string[];
  /** 是否由规则引擎降级生成 */
  degraded?: boolean;
  model?: string;
}

export const GROUP_KIND_LABEL: Record<GroupKind, string> = {
  multi_round: '多轮授课',
  same_topic: '同课异构',
  same_structure: '同课型结构',
};

// ------------------------------------------------------------
// 数值对比
// ------------------------------------------------------------

export interface CompareRow {
  key: string;
  name: string;
  /** 与 digest 顺序一一对应的值（0-10 或 0-100，按 kind 决定口径） */
  values: (number | null)[];
  /** 最高分与最低分之差（参与比较的项） */
  spread: number | null;
  /** 最高分所在课例下标 */
  best: number | null;
  /** 最低分所在课例下标 */
  worst: number | null;
}

function makeRow(key: string, name: string, values: (number | null)[]): CompareRow {
  let best: number | null = null;
  let worst: number | null = null;
  values.forEach((v, i) => {
    if (v == null) return;
    if (best == null || v > (values[best] as number)) best = i;
    if (worst == null || v < (values[worst] as number)) worst = i;
  });
  const spread =
    best != null && worst != null ? (values[best] as number) - (values[worst] as number) : null;
  return { key, name, values, spread, best, worst };
}

export interface CompareResult {
  /** 综合分（百分制） */
  total: CompareRow;
  /** 五维（10 分制） */
  dims: CompareRow[];
  /** 表一认知/情感内涵（百分制） */
  essence: CompareRow[];
  /** 二级指标（10 分制），按 |spread| 从大到小，只保留有分且跨课例可比的项 */
  indicators: CompareRow[];
  /** 材料覆盖（观察点已评/总数，0-1） */
  coverage: CompareRow;
  /** 综合分最高 / 最低的课例下标 */
  topIndex: number;
  bottomIndex: number;
  /** 综合分极差 */
  totalSpread: number;
}

/** 依据若干 digest 计算对比表；digests 顺序即展示顺序（第一列作为基准） */
export function buildCompare(digests: LessonDigest[]): CompareResult {
  const total = makeRow('total', '综合得分', digests.map((d) => d.total_score));

  const dims = DIMENSION_META.map((meta) =>
    makeRow(
      meta.code,
      meta.name,
      digests.map((d) => d.dimensions.find((x) => x.code === meta.code)?.score ?? null),
    ),
  );

  const essence = [
    makeRow(
      'cognitive',
      '认知 · 高阶思维',
      digests.map((d) => d.cognitive),
    ),
    makeRow(
      'affective',
      '情感 · 学习情感素养',
      digests.map((d) => d.affective),
    ),
  ];

  // 指标级：只比较「至少两节课都有分」的指标，按极差从大到小
  const indicatorCodes = new Map<
    string,
    { name: string; dimension_code: string; dimension_name: string }
  >();
  for (const d of digests) {
    for (const ind of d.indicators) {
      if (!indicatorCodes.has(ind.code)) {
        indicatorCodes.set(ind.code, {
          name: ind.name,
          dimension_code: ind.dimension_code,
          dimension_name: ind.dimension_name,
        });
      }
    }
  }
  const indicators: CompareRow[] = [];
  for (const [code, meta] of indicatorCodes) {
    const values = digests.map((d) => d.indicators.find((i) => i.code === code)?.score ?? null);
    const scored = values.filter((v) => v != null).length;
    if (scored < 2) continue;
    const row = makeRow(code, meta.name, values);
    row.key = `${meta.dimension_code}|${code}`;
    indicators.push(row);
  }
  indicators.sort((a, b) => (b.spread ?? 0) - (a.spread ?? 0));

  const coverage = makeRow(
    'coverage',
    '材料覆盖（观察点）',
    digests.map((d) => (d.total_points > 0 ? d.scored_points / d.total_points : null)),
  );

  const topIndex = total.best ?? 0;
  const bottomIndex = total.worst ?? 0;

  return {
    total,
    dims,
    essence,
    indicators,
    coverage,
    topIndex,
    bottomIndex,
    totalSpread: total.spread ?? 0,
  };
}

/** 把 0-10 分数差格式化成带符号的字符串 */
export function formatDelta(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return '—';
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

/** 材料齐备度文案：几路材料齐了 */
export function sourceSummary(d: LessonDigest): string {
  const on = [d.sources.av, d.sources.observer, d.sources.task_sheet].filter(Boolean).length;
  return `${on}/3 路材料`;
}
