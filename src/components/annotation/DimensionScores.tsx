'use client';

import { Input } from '@/components/ui/input';
import type { ManualDimensionScore } from '@/lib/evaluation/annotation-types';

export interface DimMeta {
  code: string;
  order: number;
  name: string;
  weight: number;
  observation_focus: string;
}

export default function DimensionScores({
  dimensions,
  scores,
  onChange,
}: {
  dimensions: DimMeta[];
  scores: ManualDimensionScore[];
  onChange: (next: ManualDimensionScore[]) => void;
}) {
  function setScore(code: string, value: string) {
    if (value === '') {
      update(code, { score: null });
      return;
    }
    const n = Number(value);
    if (Number.isNaN(n)) return;
    const clamped = Math.max(0, Math.min(10, Math.round(n * 10) / 10));
    update(code, { score: clamped });
  }

  function update(code: string, patch: Partial<ManualDimensionScore>) {
    const exists = scores.some((s) => s.dimension_code === code);
    if (exists) {
      onChange(scores.map((s) => (s.dimension_code === code ? { ...s, ...patch } : s)));
    } else {
      onChange([...scores, { dimension_code: code, score: null, comment: '', ...patch }]);
    }
  }

  const scored = scores.filter((s) => typeof s.score === 'number').length;

  return (
    <div className="space-y-3">
      <div className="text-xs leading-relaxed text-muted-foreground">
        <p>
          这五个分数不参与综合分计算。综合分由各维度二级指标的逐项判定汇总得出；你在这里打的分是一份独立参照。已评 {scored}/{dimensions.length} 维。
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed">
          <li>与 AI 分相差 1.5 分以上，报告会把该维度标成「待复核」，提示再看一遍</li>
          <li>与其它材料来源相差 2.5 分以上，同样会标「待复核」</li>
          <li>填了「评分依据」，会以「人工评分评语」出现在报告的维度证据里</li>
        </ul>
        <p className="mt-1 text-[11px] leading-relaxed">它的作用不是改分，而是让看报告的人知道，这里有一份不同意见。</p>
      </div>
      <div className="space-y-3">
        {dimensions.map((d) => {
          const cur = scores.find((s) => s.dimension_code === d.code);
          return (
            <div key={d.code} className="rounded-xl border border-border/80 bg-card p-3 shadow-sm transition hover:border-primary/30">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    <span className="mr-1 text-primary/70">{['一', '二', '三', '四', '五'][d.order - 1]}、</span>
                    {d.name}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">权重 {(d.weight * 100).toFixed(0)}%</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.observation_focus}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    value={cur?.score ?? ''}
                    onChange={(e) => setScore(d.code, e.target.value)}
                    className="h-8 w-16 text-center text-sm"
                    placeholder="—"
                  />
                  <span className="text-xs text-muted-foreground">/10</span>
                </div>
              </div>
              <Input
                value={cur?.comment ?? ''}
                onChange={(e) => update(d.code, { comment: e.target.value.slice(0, 500) })}
                placeholder="评分依据 / 备注（可选）"
                className="mt-2 h-8 text-xs"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
