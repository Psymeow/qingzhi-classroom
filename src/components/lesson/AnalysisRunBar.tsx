'use client';

import { Button } from '@/components/ui/button';
import { Loader2, Play, AlertTriangle, Sparkles } from 'lucide-react';
import type { AnalysisRunner } from '@/components/lesson/useAnalysisRunner';

/**
 * 全局分析控制条（V1.20）：运行/取消分析 + AI 深度分析开关 + 阶段进度与错误提示。
 * 渲染在课例详情页左列「课堂实录」视频上方——分析操作的是整节课的全部数据，
 * 不属于任何单一板块，放全局位置避免用户以为只重跑「多源融合分析」。
 */
export default function AnalysisRunBar({ runner, compact = false }: { runner: AnalysisRunner; compact?: boolean }) {
  const { running, phase, error, useLlm, report, run, cancelRun } = runner;
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-card p-2.5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <Button onClick={() => run()} size="sm" className="flex-1">
            <Play className="mr-2 h-4 w-4" />
            {report ? '重新运行分析' : '运行课堂分析'}
          </Button>
        ) : (
          <Button variant="destructive" size="sm" onClick={cancelRun} className="flex-1">
            <span className="mr-2 h-2 w-2 rounded-sm bg-destructive-foreground" />
            取消本次分析
          </Button>
        )}
        <Button
          variant={useLlm ? 'default' : 'outline'}
          size="sm"
          onClick={() => runner.setUseLlm(!useLlm)}
          disabled={running}
          title="开启后由 AI 对转写文稿、学生任务单与观察记录做指标级语义评分，并生成教学评语；AI 不可用或超时时自动使用内置规则完成评分，不影响出报告"
        >
          <Sparkles className="mr-2 h-4 w-4" /> AI 深度分析：{useLlm ? '开' : '关'}
        </Button>
      </div>
      {!compact && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          基于课堂转写、任务单、观察记录与人工标注重新生成整份分析报告；改动数据后重新运行才会生效
        </p>
      )}
      {running && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.05] px-2.5 py-1.5 text-xs text-primary">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          <span>{phase ?? '正在分析…'}</span>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
