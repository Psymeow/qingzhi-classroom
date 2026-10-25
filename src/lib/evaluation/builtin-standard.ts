// ============================================================
// 内置评价标准入库（V1.3）
// 把内置常量构建为可版本化的数据库快照：五维 33 指标 + 5 课型 91 条手册要点定义。
// 引擎运行期仍以代码常量为准；数据库记录用于标准列表/详情查看与后续校本替换。
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { QZXC_MATH_STANDARD } from '@/lib/evaluation/standard-math';
import {
  essencePointsOf,
  ESSENCE_INDICATOR_CODES,
} from '@/lib/evaluation/essence-points';
import {
  LESSON_TYPE_MODELS,
  LESSON_TYPE_ORDER,
  LESSON_TYPE_STATS,
} from '@/lib/evaluation/lesson-type-models';

export interface BuiltinStandardRow {
  code: string;
  name: string;
  version: string;
  subject: string;
  scope: 'builtin';
  description: string;
  content: Record<string, unknown>;
  is_active: boolean;
  /** 系统内置单例为 null；本人/校本标准为对应用户 id */
  owner_id: string | null;
  updated_at: string;
}

/** content 快照版本：快照可完整还原运行期标准（含内涵域与课型模型）时递增 */
export const BUILTIN_CONTENT_SCHEMA = 'qzxc-v5-lt3';

export interface BuiltinStandardSummary {
  id: string;
  code: string;
  version: string;
}

/**
 * 构建内置标准的完整 JSON 快照。
 * content 包含：五维/33 指标（含观测点）+ 5 课型的全部 91 条手册要点定义。
 */
export function buildBuiltinStandardContent(): Record<string, unknown> {
  const lessonTypeModels = LESSON_TYPE_ORDER.map((code) => {
    const m = LESSON_TYPE_MODELS[code];
    return {
      code: m.code,
      name: m.name,
      manual_section: m.manual_section,
      summary: m.summary,
      activities: m.activities,
      viewpoints: m.viewpoints.map((v) => ({
        code: v.code,
        name: v.name,
        points: v.points.map((p) => ({
          code: p.code,
          no: p.no,
          name: p.name,
          definition: p.definition,
        })),
      })),
    };
  });

  return {
    schema: BUILTIN_CONTENT_SCHEMA,
    code: QZXC_MATH_STANDARD.code,
    version: QZXC_MATH_STANDARD.version,
    dimensions: QZXC_MATH_STANDARD.dimensions,
    indicators: QZXC_MATH_STANDARD.indicators,
    lesson_types: QZXC_MATH_STANDARD.lesson_types,
    lesson_type_models: lessonTypeModels,
    // 内涵分析域：换课题时改这里指向的维度即可（引擎按此装配认知/情感区块）
    essence_domains: QZXC_MATH_STANDARD.essence_domains ?? null,
    essence_points: ESSENCE_INDICATOR_CODES.map((code) => ({
      indicator_code: code,
      points: essencePointsOf(code).map((p) => ({
        code: p.code,
        name: p.name,
        definition: p.description,
        sources: p.sources,
      })),
    })),
    stats: {
      dimensions: QZXC_MATH_STANDARD.dimensions.length,
      indicators: QZXC_MATH_STANDARD.indicators.length,
      observation_points: QZXC_MATH_STANDARD.indicators.reduce(
        (n, ind) => n + ind.observation_points.length,
        0,
      ),
      essence_indicators: ESSENCE_INDICATOR_CODES.length,
      essence_points: ESSENCE_INDICATOR_CODES.reduce(
        (n, c) => n + essencePointsOf(c).length,
        0,
      ),
      lesson_types: LESSON_TYPE_ORDER.length,
      viewpoints: LESSON_TYPE_STATS.reduce((n, s) => n + s.viewpoints, 0),
      lesson_type_points: LESSON_TYPE_STATS.reduce((n, s) => n + s.points, 0),
    },
  };
}

/**
 * 生成内置标准行：owner_id 为空 = 系统内置单例，不绑定任何账号。
 * 单例由 migrations/0002_builtin_standard_singleton.sql 建立并加唯一索引兜底；
 * 这里只负责「缺失则补建、版本落后则升级」。
 */
export function buildBuiltinStandardRow(): BuiltinStandardRow {
  const s = QZXC_MATH_STANDARD;
  return {
    code: s.code,
    name: s.name,
    version: s.version,
    subject: s.subject,
    scope: 'builtin',
    description: s.description,
    content: buildBuiltinStandardContent(),
    is_active: true,
    owner_id: null,
    updated_at: new Date().toISOString(),
  };
}

const SINGLETON_COLS = 'id, code, version, name, content';

async function selectSingleton(db: SupabaseClient, code: string) {
  // 注：content.schema 中 schema 为 SQL 保留字，不能用 content->>schema 走 PostgREST，直接取 content
  const { data, error } = await db
    .from('standard_sets')
    .select(SINGLETON_COLS)
    .eq('code', code)
    .eq('scope', 'builtin')
    .is('owner_id', null)
    .maybeSingle();
  if (error) return null;
  return data as { id: string; code: string; version: string; name: string; content: unknown } | null;
}

/**
 * 确保内置标准以「系统单例」存在：缺失则插入（owner 为空），版本/快照落后则就地升级。
 * 幂等；并发播种时由唯一索引 standard_sets_builtin_singleton_uk 兜底，冲突后重读。
 * 返回内置标准摘要；查询或写入失败时返回 null（不阻断主流程）。
 */
export async function ensureBuiltinStandard(
  db: SupabaseClient,
): Promise<BuiltinStandardSummary | null> {
  const row = buildBuiltinStandardRow();
  let existing = await selectSingleton(db, row.code);

  if (!existing) {
    const { error: insErr } = await db.from('standard_sets').insert(row);
    // 23505 = 唯一冲突（并发请求抢先建好了），重读即可，不算失败
    if (insErr && insErr.code !== '23505') return null;
    existing = await selectSingleton(db, row.code);
    if (!existing) return null;
    return { id: existing.id, code: existing.code, version: existing.version };
  }

  const content = (existing.content as { schema?: string } | null) ?? null;
  const stale =
    existing.version !== row.version ||
    (content?.schema ?? null) !== BUILTIN_CONTENT_SCHEMA ||
    existing.name !== row.name;
  if (stale) {
    const { error: updErr } = await db
      .from('standard_sets')
      .update({
        name: row.name,
        version: row.version,
        subject: row.subject,
        scope: 'builtin',
        description: row.description,
        content: row.content,
        is_active: true,
        updated_at: row.updated_at,
      })
      .eq('id', existing.id)
      .is('owner_id', null);
    if (updErr) return null;
    existing = { ...existing, version: row.version, name: row.name };
  }
  return { id: existing.id, code: existing.code, version: existing.version };
}
