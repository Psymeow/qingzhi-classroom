import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { getLatestReport } from '@/lib/analysis/runner';
import { buildReportDocx, type ExportVariant } from '@/lib/report/export-docx';
import { generateDimensionInterpretations } from '@/lib/llm/dimension-commentary';
import { generateEssenceInterpretations } from '@/lib/llm/essence-commentary';
import { isLlmEnabled, LlmError } from '@/lib/llm/deepseek';
import { resolveStandard } from '@/lib/evaluation/standard-registry';
import type { AnalysisReport, ScoreBand } from '@/lib/evaluation/types';
import type { DimMeta } from '@/components/annotation/DimensionScores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 完整版导出可能先补齐缺失解读（两路并行，最长约 100s）再生成 Word，留足余量。
export const maxDuration = 120;

/** 标准内容里每个二级指标的 code → name，报告侧用于补旧快照缺失的指标名 */
interface RawDimension {
  indicators?: Array<{ code?: string; name?: string }>;
}

/** 导出版本：缺省 full（兼容旧调用：不带 variant 仍导出完整版） */
function parseVariant(raw: string | null): ExportVariant {
  return raw === 'brief' ? 'brief' : 'full';
}

/** 仅在确实缺失时补齐解读；已有内容一律不覆盖。失败不阻断导出，转为文内提示。 */
async function autoFillInterpretations(
  db: Awaited<ReturnType<typeof authenticate>>['db'],
  lessonId: string,
  userId: string,
  report: AnalysisReport,
  standard: Awaited<ReturnType<typeof resolveStandard>>,
): Promise<{ report: AnalysisReport; notes: string[] }> {
  const notes: string[] = [];
  let filled: AnalysisReport = report;
  let wroteBack = false;

  const needDimensions = !report.dimension_interpretations?.length;
  const needEssence = !!report.essence_eval?.llm_used && !report.essence_interpretations;

  if (!needDimensions && !needEssence) return { report: filled, notes };

  const [dimRes, essRes] = await Promise.allSettled([
    needDimensions ? generateDimensionInterpretations(filled, standard) : Promise.resolve(null),
    needEssence ? generateEssenceInterpretations(filled, standard) : Promise.resolve(null),
  ]);

  if (dimRes.status === 'fulfilled' && dimRes.value) {
    filled = { ...filled, dimension_interpretations: dimRes.value };
    wroteBack = true;
    notes.push(`已自动补齐 ${dimRes.value.length} 个维度的 AI 维度解读（看什么/判几分及原因/证据在哪/怎么改），已保存。`);
  } else if (dimRes.status === 'rejected') {
    const msg = dimRes.reason instanceof LlmError ? dimRes.reason.message : '维度解读生成失败';
    notes.push(`AI 维度解读未补齐（${msg}），本次导出沿用现有内容，未保存。`);
    console.warn('[export-docx] 维度解读补齐失败：', dimRes.reason);
  }

  if (essRes.status === 'fulfilled' && essRes.value) {
    filled = { ...filled, essence_interpretations: essRes.value };
    wroteBack = true;
    notes.push('已自动补齐 2 个域（认知、情感）的内涵解读，已保存。');
  } else if (essRes.status === 'rejected') {
    const msg = essRes.reason instanceof LlmError ? essRes.reason.message : '内涵解读生成失败';
    notes.push(`认知/情感内涵解读未补齐（${msg}），本次导出沿用现有内容，未保存。`);
    console.warn('[export-docx] 内涵解读补齐失败：', essRes.reason);
  }

  // 只写回新补的字段，不覆盖报告其它内容
  if (wroteBack) {
    const { error: upErr } = await db
      .from('reports')
      .update({ result: filled, updated_at: new Date().toISOString() })
      .eq('lesson_id', lessonId)
      .eq('user_id', userId);
    if (upErr) {
      console.warn('[export-docx] 解读写回失败（导出继续）：', upErr);
      notes.push('补齐的解读未能保存，下次导出会重新生成。');
    }
  }

  return { report: filled, notes };
}

/**
 * 导出课堂分析报告为 Word（.docx），支持精简版 / 完整版。
 *
 * variant=brief 精简版：摘要 + 五维评分 + 证据精选 + 课堂现场要点，供日常教研快读。
 * variant=full  完整版：全量内容（缺省值，兼容不带 variant 的旧调用）。
 *
 * 走服务端而非页面 DOM 的原因：页面「下载报告」克隆 DOM 时，所有折叠区
 * （课型要点、内涵观察点、维度解读）因条件渲染/Radix unmount 并不在 DOM 里，
 * 导出件只剩空卡片边框。这里直接吃分析结果数据，结构永远完整。
 *
 * PDF：Word 可直接「另存为 PDF」；页面另存 PDF 的 HTML 路径仍保留。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await authenticate(req);
    const { id } = await ctx.params;

    // 非所有者不可导出：与读报告同一守卫，不因导出放松
    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const variant = parseVariant(req.nextUrl.searchParams.get('variant'));
    const isFull = variant === 'full';

    const stored = await getLatestReport(db, id, user.id);
    if (!stored?.result) {
      return NextResponse.json({ error: '本课例还没有分析报告，请先运行分析' }, { status: 404 });
    }

    let report = stored.result;

    const { data: lesson } = await db
      .from('lessons')
      .select('title, teacher_name, school, grade_class, standard_set_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    // 与分析/解读同口径：按课例绑定的标准集解析评价标准（为空时回落内置种子）
    const standard = await resolveStandard(db, lesson?.standard_set_id ?? null);

    let autoFillNotes: string[] = [];
    if (isFull) {
      // 仅完整版含解读章节，才做补齐；模型未配置时直接跳过，导出继续
      if (isLlmEnabled()) {
        const filled = await autoFillInterpretations(db, id, user.id, report, standard);
        report = filled.report;
        autoFillNotes = filled.notes;
      } else {
        autoFillNotes = ['AI 服务未配置，本次未补齐任何域的解读（0 个域），未生成也未保存。'];
      }
    }

    // 五维元信息与指标名：取课例绑定标准的 content.dimensions（与分析页同口径）
    let dimensions: DimMeta[] = [];
    const indicatorNames: Record<string, string> = {};
    {
      const raw = (standard as unknown as { dimensions?: unknown }).dimensions;
      if (Array.isArray(raw)) {
        dimensions = (raw as DimMeta[])
          .filter((d) => d && d.code)
          .map((d) => ({
            code: d.code,
            order: d.order ?? 0,
            name: d.name ?? d.code,
            weight: d.weight ?? 0,
            observation_focus: d.observation_focus ?? '',
          }))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        for (const dim of raw as RawDimension[]) {
          for (const ind of dim.indicators ?? []) {
            if (ind.code && ind.name) indicatorNames[ind.code] = ind.name;
          }
        }
      }
    }

    // 座位 / 互动 / 关键事件：取完整标注 payload（导出需要坐标与连线，不止统计数）
    const { data: ann } = await db
      .from('annotations')
      .select('payload')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    const payload = (ann?.payload ?? {}) as {
      events?: Array<{ id: string; time_sec?: number | null; category: string; note?: string | null }>;
      seating?: Record<string, unknown> | null;
      interactions?: unknown[];
    };

    // 材料原文：供旧报告证据补时间码与说话人
    const { data: inp } = await db
      .from('ai_analysis_inputs')
      .select('transcript, observer_text, task_sheet_text, lesson_plan_text')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    // 绑定标准的档位数据：档位挂在 dimensions[].bands（各维度命名不同，如「未融合/较融合」与「基本显现/表现良好」），
    // 顶层并不存在 bands 字段；分维度档位缺失时由 docx 模块整体回退系统通用五档并注明。
    const dimensionBands: Array<{ code: string; name: string; bands: ScoreBand[] }> = (
      standard.dimensions ?? []
    )
      .filter((d) => Array.isArray(d.bands) && d.bands.length > 0)
      .map((d) => ({ code: d.code, name: d.name, bands: d.bands }));
    const standardName = standard.name ?? '情智相长数学课堂评价标准';
    const standardVersion = standard.version ?? '';

    const title = (lesson?.title || '课堂分析报告').replace(/[\\/:*?"<>|]/g, '_');
    const generatedAt = new Date(report.generated_at);
    const date = generatedAt.toISOString().slice(0, 10);
    const stamp = generatedAt.toTimeString().slice(0, 8).replace(/:/g, '');

    const buffer = await buildReportDocx({
      variant,
      report,
      totalScore: stored.total_score,
      totalLevel: stored.total_level,
      isCalibrated: stored.is_calibrated,
      lessonTitle: lesson?.title ?? '课堂分析报告',
      lessonMeta: {
        teacher_name: lesson?.teacher_name ?? null,
        school: lesson?.school ?? null,
        grade_class: lesson?.grade_class ?? null,
      },
      dimensions,
      indicatorNames,
      events: (payload.events ?? []) as never,
      seating: (payload.seating ?? null) as never,
      interactions: (payload.interactions ?? []) as never,
      dimensionBands,
      bandSourceNote: dimensionBands.length ? `档位数据来源：${standardName}${standardVersion ? ` v${standardVersion}` : ''}` : null,
      bandsMissing: !dimensionBands.length,
      autoFillNotes,
      materials: {
        transcript: inp?.transcript ?? null,
        observer: inp?.observer_text ?? null,
        taskSheet: inp?.task_sheet_text ?? null,
        lessonPlan: inp?.lesson_plan_text ?? null,
      },
      exporterName: user.displayName ?? null,
    });

    // 文件名：日期_学校_班级_教师_课例_课堂分析报告_完整版或精简版_v版本_时刻.docx（§3.4）
    const versionTag = standardVersion ? `_v${standardVersion}` : '';
    const variantTag = isFull ? '完整版' : '精简版';
    const field = (v?: string | null): string => (v ? String(v).replace(/[\\/:*?"<>|]/g, '_') : '');
    const chinese = [
      date,
      field(lesson?.school),
      field(lesson?.grade_class),
      field(lesson?.teacher_name),
      title,
      `课堂分析报告_${variantTag}${versionTag}_${stamp}`,
    ]
      .filter(Boolean)
      .join('_');
    const fileName = `${chinese}.docx`;
    const asciiName = `classroom-analysis-report_${isFull ? 'full' : 'brief'}_${stamp}.docx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // 中文文件名：RFC 5987 编码，Chrome/Firefox/Safari/微信内置浏览器都能正确显示
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof LlmError) {
      // 解读补齐的模型错误已在内部降级为提示；这里兜底其余 LLM 失败
      return NextResponse.json({ error: `AI 服务异常：${e.message}` }, { status: 502 });
    }
    // 原始错误必须留痕：此前只回给前端一句「生成 Word 报告失败」，
    // 堆栈与原始 message 全部丢失，线上排查只能靠猜（V1.36 的 client 边界问题即因此迟迟未能定位）。
    // message 与 stack 显式打印，方便按日志检索。
    console.error(
      '[export-docx] 生成失败：',
      e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
    );
    return NextResponse.json({ error: '生成 Word 报告失败，请稍后重试' }, { status: 500 });
  }
}
