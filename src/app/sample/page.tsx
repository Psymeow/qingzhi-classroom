'use client';

// P0-4 内置离线样例报告：无需登录、无任何业务数据请求即可浏览完整报告。
// 会场断网或新用户空态时，用它展示「完整分析报告长什么样」。

import Link from 'next/link';
import { ArrowLeft, Sparkles, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReportView from '@/components/report/ReportView';
import type { DimMeta } from '@/components/annotation/DimensionScores';
import {
  SAMPLE_REPORT,
  SAMPLE_LESSON_TITLE,
  SAMPLE_DIMENSIONS,
  SAMPLE_STUDENTS,
  SAMPLE_INTERACTIONS,
  SAMPLE_EVENTS,
} from '@/lib/sample/sample-report';

const DIMENSIONS: DimMeta[] = SAMPLE_DIMENSIONS.map((d, i) => ({
  code: d.code,
  order: i + 1,
  name: d.name,
  weight: [0.2, 0.25, 0.25, 0.2, 0.1][i] ?? 0,
  observation_focus: '',
}));

const SAMPLE_ANNOTATION = {
  seating: {
    layout_type: 'groups' as const,
    rows: 4,
    cols: 6,
    students: SAMPLE_STUDENTS,
  },
  interactions: SAMPLE_INTERACTIONS,
  events: SAMPLE_EVENTS,
};

export default function SampleReportPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      {/* 顶部样例说明（打印时隐藏） */}
      <div className="mb-4 print:hidden">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回工作台
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold text-foreground">完整样例分析报告</h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-[11px] text-primary">
            <Sparkles className="h-3 w-3" /> 内置样例 · 无需登录
          </span>
        </div>
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
          <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            这是一节虚构的七年级《有理数的乘方》新授课样例，全部数据已内置，可在无网络环境下浏览，用于了解报告的完整结构（综合分、五维雷达、AI 评语、课型要点、内涵观察点、证据、座位互动与事件打点）。
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-background p-4 shadow-card sm:p-6">
        <ReportView
          report={SAMPLE_REPORT}
          lessonId="sample-lesson"
          dimensions={DIMENSIONS}
          lessonTitle={SAMPLE_LESSON_TITLE}
          onUnauthorized={() => {}}
          initialAnnotation={SAMPLE_ANNOTATION}
        />
      </div>

      <div className="mt-5 flex justify-center print:hidden">
        <Link href="/">
          <Button variant="outline" size="sm">
            我也想分析一节课 · 返回新建课例
          </Button>
        </Link>
      </div>
    </main>
  );
}
