'use client';

// ============================================================
// 二级指标地图（P1-2）
// 目的：把「五维 → 33 个二级指标」这一层第一次真正画出来。
//       此前三层结构只活在后端：维度分能对账，但教师看不到
//       33 个指标各自的名字、分数、哪几格是空的。
// 一格 = 一个二级指标；颜色 = 档位；虚线空框 = 本次未评（材料不足）；
// 琥珀点 = 多源分歧待复核；悬停看指标名、分数、证据条数。
// 纯展示组件：数据全部来自已有报告，不新增采集、不新增评分。
// ============================================================

interface MapIndicator {
  indicator_code: string;
  name?: string;
  score: number | null;
  need_review: boolean;
  source_scores?: Array<{ evidences: string[] }>;
}

interface MapDimension {
  dimension_code: string;
  indicators: MapIndicator[];
}

interface Props {
  results: MapDimension[];
  meta: Array<{ code: string; name: string }>;
  /** 旧报告里 indicators 没有 name，用标准内容补一份 code → name 映射 */
  names?: Record<string, string>;
  className?: string;
}

function cellTone(score: number | null): string {
  if (score === null) {
    return 'border border-dashed border-border bg-transparent text-muted-foreground/50';
  }
  if (score >= 8.1) return 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-800';
  if (score >= 6.1) return 'border border-sky-500/40 bg-sky-500/15 text-sky-800';
  if (score >= 4.1) return 'border border-amber-500/40 bg-amber-500/15 text-amber-800';
  if (score >= 2.1) return 'border border-orange-500/40 bg-orange-500/15 text-orange-800';
  return 'border border-rose-500/40 bg-rose-500/15 text-rose-800';
}

const LEGEND = [
  { label: '优秀', tone: 'border border-emerald-500/40 bg-emerald-500/15' },
  { label: '良好', tone: 'border border-sky-500/40 bg-sky-500/15' },
  { label: '中等', tone: 'border border-amber-500/40 bg-amber-500/15' },
  { label: '可精进及以下', tone: 'border border-rose-500/40 bg-rose-500/15' },
];

export default function IndicatorMap({ results, meta, names, className = '' }: Props) {
  const rows = results
    .map((d) => {
      const m = meta.find((x) => x.code === d.dimension_code);
      return {
        code: d.dimension_code,
        name: m?.name ?? d.dimension_code,
        cells: d.indicators.map((ind, i) => ({
          ...ind,
          seq: i + 1,
          label: ind.name ?? names?.[ind.indicator_code] ?? ind.indicator_code,
          evidenceCount: (ind.source_scores ?? []).reduce(
            (n, s) => n + (s.evidences?.length ?? 0),
            0,
          ),
        })),
      };
    })
    .filter((r) => r.cells.length > 0);

  if (rows.length === 0) return null;

  const total = rows.reduce((n, r) => n + r.cells.length, 0);
  const scored = rows.reduce(
    (n, r) => n + r.cells.filter((c) => c.score !== null).length,
    0,
  );

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          共 <span className="font-medium tabular-nums text-foreground">{total}</span> 个二级指标，本次评出{' '}
          <span className="font-medium tabular-nums text-foreground">{scored}</span> 个
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
          {LEGEND.map((l) => (
            <span key={l.label} className="inline-flex items-center gap-1">
              <i className={`h-2.5 w-2.5 rounded-[3px] ${l.tone}`} />
              {l.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-border" />
            待补
          </span>
          <span className="inline-flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            待复核
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.code} className="flex items-start gap-2 break-inside-avoid">
            <div
              className="w-[92px] shrink-0 truncate pt-0.5 text-[11px] leading-tight text-muted-foreground"
              title={`${row.code} ${row.name}`}
            >
              <span className="font-medium text-foreground/70">{row.code}</span> {row.name}
            </div>
            <div className="flex flex-1 flex-wrap gap-1">
              {row.cells.map((c) => (
                <span
                  key={c.indicator_code}
                  title={`${c.indicator_code} ${c.label} · ${
                    c.score === null ? '本次未评（材料不足）' : `${c.score.toFixed(1)} 分`
                  } · ${c.evidenceCount} 条证据${c.need_review ? ' · 待复核' : ''}`}
                  className={`relative flex h-6 w-6 items-center justify-center rounded-[5px] text-[10px] font-medium tabular-nums ${cellTone(
                    c.score,
                  )}`}
                >
                  {c.seq}
                  {c.need_review && (
                    <i className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-background" />
                  )}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
