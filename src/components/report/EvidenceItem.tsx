'use client';

import { cn } from '@/lib/utils';
import { dispatchLocate, type LocateSource } from '@/lib/report/locate';

interface Props {
  /** 证据原文（AI 可能有轻微改写） */
  quote: string;
  source: LocateSource;
  /** 打印/导出件上的时间戳由调用方传入（ReportView 按缓存文本计算） */
  timestamp?: string | null;
  /** 离线样例等没有原文可跳转的场景 */
  disabled?: boolean;
}

const SOURCE_TAG: Record<LocateSource, string> = {
  av_transcript: '转写',
  observer_note: '观察',
  task_sheet: '任务单',
  lesson_plan: '教案',
  manual_annotation: '标注',
};

/**
 * 单条证据：时间戳 → 来源标签 → 引文。
 * V1.13（P1-1）：时间戳从来源标签里挪出来做成等宽 chip，放在行首——
 * 证据区从「一堆引用」变成「可按课堂进程顺读的切片」。
 * 点击跳转「数据接入」原文；打印态降级为纯文本。
 */
export default function EvidenceItem({ quote, source, timestamp, disabled }: Props) {
  const tag = SOURCE_TAG[source];

  const handleClick = () => {
    if (disabled) return;
    dispatchLocate(source, quote);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      data-export-keep="1"
      title={disabled ? undefined : '点击查看原文位置'}
      className={cn(
        'group/ev flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors',
        disabled
          ? 'cursor-default'
          : 'cursor-pointer hover:bg-primary/[0.06] print:cursor-default print:hover:bg-transparent',
      )}
    >
      {timestamp && (
        <span className="mt-px shrink-0 rounded bg-muted px-1 py-px font-mono text-[10px] leading-tight tabular-nums text-foreground/70 print:bg-gray-200 print:text-black">
          {timestamp}
        </span>
      )}
      <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
        <span className="mr-1 inline-flex shrink-0 items-center rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary print:bg-gray-200 print:text-black">
          {tag}
        </span>
        {quote}
      </span>
    </button>
  );
}
