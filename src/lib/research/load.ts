import 'server-only';
import type { DbClient } from '@/lib/auth/server';
import type { AnalysisReport } from '@/lib/evaluation/types';
import {
  DIMENSION_META,
  dimensionName,
  indicatorDimension,
  lessonTypeText,
  type DigestDimension,
  type DigestIndicator,
  type LessonDigest,
} from './compare';

/**
 * 课例池读取：只取「已生成报告」的课例，压成 LessonDigest 供对比/分组使用。
 * 报告体量大（含证据与解读），因此只取必要字段并即时压缩，绝不把原始 result 传给前端。
 */
const LESSON_COLS = 'id,title,teacher_name,school,grade_class,lesson_type,lesson_date,updated_at';
const REPORT_COLS = 'lesson_id,total_score,total_level,result,updated_at';

interface LessonRow {
  id: string;
  title?: string | null;
  teacher_name?: string | null;
  school?: string | null;
  grade_class?: string | null;
  lesson_type?: string | null;
  lesson_date?: string | null;
  updated_at?: string | null;
}

interface ReportRow {
  lesson_id: string;
  total_score?: number | null;
  total_level?: string | null;
  result?: unknown;
  updated_at?: string | null;
}

function toDigest(lesson: LessonRow, report: ReportRow): LessonDigest | null {
  const result = report.result as AnalysisReport | null;
  if (!result) return null;
  const type = lessonTypeText(lesson.lesson_type);

  const dimsByCode = new Map((result.dimension_results ?? []).map((d) => [d.dimension_code, d]));
  const dimensions: DigestDimension[] = DIMENSION_META.map((meta) => {
    const d = dimsByCode.get(meta.code);
    return {
      code: meta.code,
      name: meta.name,
      score: d?.score ?? null,
      level: d?.level_label ?? null,
    };
  });

  const indicators: DigestIndicator[] = [];
  for (const d of result.dimension_results ?? []) {
    for (const ind of d.indicators ?? []) {
      indicators.push({
        code: ind.indicator_code,
        name: ind.name || ind.indicator_code,
        dimension_code: d.dimension_code || indicatorDimension(ind.indicator_code),
        dimension_name: dimensionName(d.dimension_code || indicatorDimension(ind.indicator_code)),
        score: ind.score ?? null,
      });
    }
  }

  const essence = result.essence_eval;

  return {
    lesson_id: lesson.id,
    title: lesson.title || '未命名课例',
    teacher_name: lesson.teacher_name ?? null,
    grade_class: lesson.grade_class ?? null,
    school: lesson.school ?? null,
    lesson_type: type.label,
    lesson_type_short: type.short,
    lesson_date: lesson.lesson_date ?? null,
    updated_at: lesson.updated_at ?? null,
    total_score: Number(report.total_score ?? result.total_score ?? 0),
    total_level: report.total_level || result.total_level || '—',
    dimensions,
    cognitive: essence?.cognitive?.score_100 ?? null,
    affective: essence?.affective?.score_100 ?? null,
    scored_points: essence?.scored_points ?? 0,
    total_points: essence?.total_points ?? 0,
    sources: {
      av: result.source_availability?.av_transcript === true,
      observer: result.source_availability?.observer_note === true,
      task_sheet: result.source_availability?.task_sheet === true,
    },
    ai_used: result.ai_meta?.used === true,
    generated_at: result.generated_at ?? null,
    indicators,
  };
}

/** 读取课例池（默认全部已分析课例；传 lessonIds 时只取这些） */
export async function loadDigests(
  db: DbClient,
  userId: string,
  lessonIds?: string[],
): Promise<LessonDigest[]> {
  let lq = db
    .from('lessons')
    .select(LESSON_COLS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (lessonIds?.length) lq = lq.in('id', lessonIds);
  const { data: lessonRows, error: lErr } = await lq;
  if (lErr) throw lErr;
  const lessons = (lessonRows ?? []) as unknown as LessonRow[];
  if (lessons.length === 0) return [];

  let rq = db.from('reports').select(REPORT_COLS).eq('user_id', userId);
  rq = rq.in(
    'lesson_id',
    lessons.map((l) => l.id),
  );
  const { data: reportRows, error: rErr } = await rq;
  if (rErr) throw rErr;

  const byLesson = new Map(
    ((reportRows ?? []) as unknown as ReportRow[]).map((r) => [r.lesson_id, r]),
  );

  const digests: LessonDigest[] = [];
  for (const lesson of lessons) {
    const report = byLesson.get(lesson.id);
    if (!report) continue;
    const d = toDigest(lesson, report);
    if (d) digests.push(d);
  }
  // 保持传入顺序（对比页第一列即基准列）
  if (lessonIds?.length) {
    digests.sort((a, b) => lessonIds.indexOf(a.lesson_id) - lessonIds.indexOf(b.lesson_id));
  }
  return digests;
}
