'use client';

// ============================================================
// 档位刻度尺（P0-1）
// 目的：把「进度条」换成「尺子」——教师一眼看到自己在哪一档、
//       下一档的边界在哪、还差多少，而不是只知道"一半多点"。
// 刻度来自评价标准本身的档位边界（与引擎 bandLabel10 一致），
// 因此可以验算，不引入任何外部经验值。
// ============================================================

/** 档位边界：≥8.1 优秀 / ≥6.1 良好 / ≥4.1 中等 / ≥2.1 可精进 / <2.1 起步阶段 */
export const SCALE_BANDS: ReadonlyArray<{ min: number; label: string }> = [
  { min: 8.1, label: '优秀' },
  { min: 6.1, label: '良好' },
  { min: 4.1, label: '中等' },
  { min: 2.1, label: '可精进' },
  { min: 0, label: '起步阶段' },
];

const TICKS = [0, 4.1, 6.1, 8.1, 10];

/** 分数 → 档名（与引擎同一口径）。 */
export function scaleBand(score: number): string {
  return SCALE_BANDS.find((b) => score >= b.min)?.label ?? '起步阶段';
}

/** 分数 → 紧邻的上一档（已在最高档时返回 undefined）。 */
export function nextBand(score: number): { min: number; label: string } | undefined {
  return [...SCALE_BANDS].reverse().find((b) => b.min > score);
}

interface Props {
  /** 维度分或综合分；null 表示本次未评（材料不足，不进均分） */
  score: number | null;
  /** 已有档位标签时直接传入，避免与后端口径打架 */
  band?: string | null;
  /** 该维度下待补的二级指标数 */
  pending?: number;
  showTicks?: boolean;
  showMeta?: boolean;
  className?: string;
}

export default function ScaleBar({
  score,
  band,
  pending,
  showTicks = true,
  showMeta = true,
  className = '',
}: Props) {
  const has = score !== null && Number.isFinite(score);
  const s = has ? Math.max(0, Math.min(10, score as number)) : 0;
  const pct = `${s * 10}%`;
  const label = band ?? (has ? scaleBand(s) : null);
  const up = has ? nextBand(s) : undefined;

  return (
    <div className={`w-full ${className}`}>
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand-gradient"
          style={{ width: pct }}
        />
        {has && (
          <span
            className="absolute h-3 w-3 rounded-full border-2 border-background bg-primary"
            style={{ left: pct, top: '50%', transform: 'translate(-50%, -50%)' }}
            aria-hidden
          />
        )}
      </div>

      {showTicks && (
        <div className="relative mt-1 h-3" aria-hidden>
          {TICKS.map((t) => {
            const left = `${t * 10}%`;
            const transform = t === 0 ? 'none' : t === 10 ? 'translateX(-100%)' : 'translateX(-50%)';
            const isBand = t === 4.1 || t === 6.1 || t === 8.1;
            return (
              <span
                key={t}
                className="absolute top-0 flex flex-col items-center"
                style={{ left, transform }}
              >
                <i className={`w-px ${isBand ? 'h-1.5 bg-foreground/35' : 'h-1 bg-border'}`} />
                <em
                  className={`not-italic tabular-nums leading-none ${
                    isBand ? 'text-[10px] font-medium text-foreground/60' : 'text-[10px] text-muted-foreground/70'
                  }`}
                >
                  {t}
                </em>
              </span>
            );
          })}
        </div>
      )}

      {showMeta && (
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed">
          {has ? (
            <>
              <span className="font-medium text-foreground">{label}</span>
              {up ? (
                <span className="text-muted-foreground">
                  距「{up.label}」还差 <span className="tabular-nums">{(up.min - s).toFixed(1)}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  距满分还差 <span className="tabular-nums">{(10 - s).toFixed(1)}</span>
                </span>
              )}
              {typeof pending === 'number' && pending > 0 && (
                <span className="text-amber-700">{pending} 项待补</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">本次未评（材料不足，不计入均分）</span>
          )}
        </div>
      )}
    </div>
  );
}
