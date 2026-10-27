'use client';

import { useState } from 'react';
import { BookOpen, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { THEORY_ANCHORS } from '@/lib/report/theory-anchors';

/**
 * 维度理论依据标签（V1.26）：在每个维度得分下挂一条可展开/收起的理论锚点。
 * 默认收起，不干扰报告阅读；导出打印时自动展开（print:block）。
 *
 * 与 AI 解读（DimensionInterpretationBlock）的分工：
 *   本标签回答「这个维度的评分标准站什么理论上」——静态、全课例一致、可追溯到文献；
 *   AI 解读回答「这节课为什么在这个维度是这个分」——动态、逐课例生成。
 */
export default function TheoryAnchorTag({ dimensionCode }: { dimensionCode: string }) {
  const [open, setOpen] = useState(false);
  const anchor = THEORY_ANCHORS[dimensionCode];
  if (!anchor) return null;

  return (
    <div className="mt-1.5 rounded-lg border border-sky-200/70 bg-sky-50/40 print:break-inside-avoid">
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-sky-900">
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-sky-600" />
          <span className="shrink-0">理论依据</span>
          <span className="truncate font-normal text-sky-800/70">{anchor.claim}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-xs text-sky-800 hover:text-sky-900"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? '收起' : '展开'}
          <ChevronDown
            className={`ml-0.5 h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
          />
        </Button>
      </div>
      <div hidden={!open} className="print:block space-y-2 border-t border-sky-200/70 px-3 py-2">
        <p className="text-[11px] leading-relaxed text-foreground/85">{anchor.detail}</p>
        <div className="space-y-1 border-t border-sky-200/60 pt-1.5">
          <div className="text-[10px] font-medium text-sky-800/80">参考文献（APA 第 7 版）</div>
          {anchor.bibliography.map((b) => (
            <p
              key={b}
              className="pl-3 text-[10px] leading-relaxed text-muted-foreground [text-indent:-0.75rem]"
            >
              {b}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
