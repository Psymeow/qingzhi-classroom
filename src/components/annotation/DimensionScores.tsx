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
      <p className="text-xs text-muted-foreground">
        按五个维度给出 0–10 分（可保留一位小数），未评分留空。已评 {scored}/{dimensions.length} 维。
      </p>
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
