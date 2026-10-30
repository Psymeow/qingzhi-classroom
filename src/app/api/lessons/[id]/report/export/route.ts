import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureLessonOwned } from '@/lib/auth/lesson';
import { getLatestReport } from '@/lib/analysis/runner';
import { buildReportDocx } from '@/lib/report/export-docx';
import type { DimMeta } from '@/components/annotation/DimensionScores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 生成 Word 是纯 CPU（无 AI 调用），正常几秒内完成；留足余量避免大报告超时。
export const maxDuration = 60;

/** 标准内容里每个二级指标的 code → name，报告侧用于补旧快照缺失的指标名 */
interface RawDimension {
  indicators?: Array<{ code?: string; name?: string }>;
}

/**
 * 导出课堂分析报告为 Word（.docx）。
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

    if (!(await ensureLessonOwned(db, user.id, id))) {
      return NextResponse.json({ error: '课例不存在或无权访问' }, { status: 404 });
    }

    const stored = await getLatestReport(db, id, user.id);
    if (!stored?.result) {
      return NextResponse.json({ error: '本课例还没有分析报告，请先运行分析' }, { status: 404 });
    }

    const { data: lesson } = await db
      .from('lessons')
      .select('title, teacher_name, school, grade_class, standard_set_id')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle();

    // 五维元信息与指标名：取课例绑定标准的 content.dimensions（与分析页同口径）
    let dimensions: DimMeta[] = [];
    const indicatorNames: Record<string, string> = {};
    if (lesson?.standard_set_id) {
      const { data: std } = await db
        .from('standard_sets')
        .select('content')
        .eq('id', lesson.standard_set_id)
        .maybeSingle();
      const raw = (std?.content as { dimensions?: unknown } | null)?.dimensions;
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

    // 座位标注：只取导出需要的统计与关键事件
    const { data: ann } = await db
      .from('annotations')
      .select('payload')
      .eq('lesson_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    const payload = (ann?.payload ?? {}) as {
      events?: Array<{ id: string; time_sec?: number | null; category: string; note?: string | null }>;
      seating?: { students?: unknown[] };
      interactions?: unknown[];
    };

    const title = (lesson?.title || '课堂分析报告').replace(/[\\/:*?"<>|]/g, '_');
    const date = new Date(stored.result.generated_at).toISOString().slice(0, 10);

    const buffer = await buildReportDocx({
      report: stored.result,
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
      seatingStudentCount: Array.isArray(payload.seating?.students) ? payload.seating.students.length : 0,
      interactionCount: Array.isArray(payload.interactions) ? payload.interactions.length : 0,
      exporterName: user.displayName ?? null,
    });

    const fileName = `${title}_课堂分析报告_${date}.docx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // 中文文件名：RFC 5987 编码，Chrome/Firefox/Safari/微信内置浏览器都能正确显示
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
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
