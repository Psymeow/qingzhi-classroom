// ============================================================
// 评价标准运行期解析（V1.4 · 平台化）
// 引擎与 LLM 层不再直接依赖内置常量：按 lesson.standard_set_id 解析出
// RubricStandard（来自 standard_sets.content 快照），为空/不可用时回落内置种子。
// 效果：「插一份新标准 → 换学科 / 换课题」不需要改代码、不需要重新部署。
//
// 注：resolveStandard 需要 Supabase 客户端，只应在服务端调用；
// 其余（fallbackStandard / subjectLabel / parseStandardContent）是纯函数。
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { QZXC_MATH_STANDARD } from './standard-math';
import type { LessonTypeModel } from './lesson-type-models';
import type {
  Dimension,
  Indicator,
  LessonTypeTemplate,
  RubricStandard,
} from './types';

/** 默认（内置）标准 code：standard_set_id 缺失或不可解析时的兜底 */
export const DEFAULT_STANDARD_CODE = QZXC_MATH_STANDARD.code;

/** 内置标准种子注册表：code -> 标准。代码常量是内置标准在运行期的唯一真源。 */
export const BUILTIN_STANDARDS: Record<string, RubricStandard> = {
  [QZXC_MATH_STANDARD.code]: QZXC_MATH_STANDARD,
};

/** 兜底标准：永远可用，保证分析不因标准解析问题中断。 */
export function fallbackStandard(): RubricStandard {
  return BUILTIN_STANDARDS[DEFAULT_STANDARD_CODE] ?? QZXC_MATH_STANDARD;
}

/** 学科 code → 中文名（提示语与 UI 用）；未知学科原样返回。 */
const SUBJECT_LABEL: Record<string, string> = {
  math: '数学',
  chinese: '语文',
  english: '英语',
  physics: '物理',
  chemistry: '化学',
  biology: '生物',
  science: '科学',
  history: '历史',
  geography: '地理',
  politics: '政治',
  morality: '道德与法治',
  it: '信息技术',
  art: '美术',
  music: '音乐',
  pe: '体育',
};

export function subjectLabel(subject?: string | null): string {
  if (!subject || !subject.trim()) return '学科';
  const raw = subject.trim();
  return SUBJECT_LABEL[raw.toLowerCase()] ?? raw;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** standard_sets 行中与标准身份相关的字段（content 之外的元信息） */
export interface StandardRowMeta {
  code: string;
  name: string;
  version: string;
  subject: string;
  description?: string | null;
}

/**
 * 把 standard_sets.content 快照还原为可运行的 RubricStandard。
 * 只做结构校验（缺关键字段即视为不可用，由调用方回落种子），不做业务修补。
 */
export function parseStandardContent(
  row: StandardRowMeta,
  content: unknown,
): RubricStandard | null {
  if (!isObj(content)) return null;

  const dims = content.dimensions;
  const inds = content.indicators;
  if (!Array.isArray(dims) || dims.length === 0) return null;
  if (!Array.isArray(inds) || inds.length === 0) return null;

  const okDim = dims.every(
    (d) =>
      isObj(d) &&
      typeof d.code === 'string' &&
      typeof d.name === 'string' &&
      typeof d.weight === 'number' &&
      Array.isArray(d.bands),
  );
  const okInd = inds.every(
    (i) =>
      isObj(i) &&
      typeof i.code === 'string' &&
      typeof i.name === 'string' &&
      typeof i.dimension_code === 'string' &&
      Array.isArray(i.observation_points),
  );
  if (!okDim || !okInd) return null;

  const lessonTypes = Array.isArray(content.lesson_types) ? content.lesson_types : [];
  const models = Array.isArray(content.lesson_type_models) ? content.lesson_type_models : [];
  const domains = isObj(content.essence_domains) ? content.essence_domains : null;

  return {
    code: row.code,
    name: row.name,
    version: row.version,
    subject: row.subject,
    description: typeof row.description === 'string' ? row.description : '',
    dimensions: dims as Dimension[],
    indicators: inds as Indicator[],
    lesson_types: lessonTypes as LessonTypeTemplate[],
    ...(models.length > 0
      ? { lesson_type_models: models as RubricStandard['lesson_type_models'] }
      : {}),
    ...(domains && isObj(domains.cognitive) && isObj(domains.affective)
      ? { essence_domains: domains as RubricStandard['essence_domains'] }
      : {}),
  };
}

/**
 * 解析某课例应使用的评价标准。
 * 优先按 standard_set_id 读 standard_sets 快照；为空 / 查不到 / 结构不合法时回落内置种子。
 * 任何失败都不阻断分析流程。
 */
export async function resolveStandard(
  db: SupabaseClient,
  standardSetId?: string | null,
): Promise<RubricStandard> {
  if (!standardSetId) return fallbackStandard();
  try {
    const { data, error } = await db
      .from('standard_sets')
      .select('id, code, name, version, subject, description, content')
      .eq('id', standardSetId)
      .maybeSingle();
    if (error || !data) return fallbackStandard();

    const parsed = parseStandardContent(
      {
        code: String(data.code ?? ''),
        name: String(data.name ?? ''),
        version: String(data.version ?? ''),
        subject: String(data.subject ?? ''),
        description: (data.description as string | null) ?? '',
      },
      data.content,
    );
    if (!parsed || !parsed.code || !parsed.name) return fallbackStandard();
    return parsed;
  } catch {
    return fallbackStandard();
  }
}

/** 取某维度下启用的二级指标（不依赖任何内置常量）。 */
export function indicatorsOf(std: RubricStandard, dimensionCode: string): Indicator[] {
  return std.indicators.filter(
    (i) => i.dimension_code === dimensionCode && i.enabled !== false,
  );
}

/** 取内涵域（认知 / 情感）下的二级指标；标准未定义内涵域时返回空数组。 */
export function essenceIndicatorsOf(
  std: RubricStandard,
  domain: 'cognitive' | 'affective',
): Indicator[] {
  const spec = std.essence_domains?.[domain];
  if (!spec) return [];
  return indicatorsOf(std, spec.dimension_code);
}

/** 按课型 code 取课型分析模型；标准未定义课型模型或课型不匹配时返回 null。 */
export function lessonTypeModelOf(
  std: RubricStandard,
  lessonType?: string | null,
): LessonTypeModel | null {
  if (!lessonType) return null;
  const models = std.lesson_type_models ?? [];
  return models.find((m) => m.code === lessonType.trim()) ?? null;
}
