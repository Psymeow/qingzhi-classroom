'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import {
  Loader2,
  FileDown,
  Printer,
  AlertTriangle,
  Users,
  ListChecks,
  Sparkles,
  Lightbulb,
  CheckCircle2,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { annotationApi, ApiError, type StoredReport } from '@/lib/api/client';
import { SOURCE_LABEL } from '@/lib/evaluation/types';
import type { DimMeta } from '@/components/annotation/DimensionScores';
import type {
  InteractionEdge,
  SeatLayoutType,
  SeatStudent,
  TimelineEvent,
} from '@/lib/evaluation/annotation-types';
import { EVENT_CATEGORY_LABEL } from '@/lib/evaluation/annotation-types';
import SeatingSnapshot from './SeatingSnapshot';
import LessonTypeEvalView from './LessonTypeEvalView';
import EssenceEvalView from './EssenceEvalView';
import EssenceOnePager from './EssenceOnePager';
import ScaleBar from './ScaleBar';
import IndicatorMap from './IndicatorMap';
import EvidenceItem from './EvidenceItem';
import DimensionInterpretationBlock, {
  useDimensionInterpretations,
} from './DimensionInterpretation';
import { downloadReportHtml } from '@/lib/report/export-html';
import { getSourceText, locateQuote, nearestTimestamp, type LocateSource } from '@/lib/report/locate';

/** 证据在原文中的起始位置（找不到返回 -1）。 */
function locateIndex(text: string, quote: string): number {
  return locateQuote(text, quote)?.start ?? -1;
}

interface LessonMeta {
  teacher_name?: string | null;
  school?: string | null;
  grade_class?: string | null;
}

interface Props {
  report: StoredReport;
  lessonId: string;
  dimensions: DimMeta[];
  /** 旧报告的 indicators 没有 name：由课例详情用标准内容补一份 code → name 映射 */
  indicatorNames?: Record<string, string>;
  lessonTitle: string;
  onUnauthorized: () => void;
  /** 课例元信息：用于打印/导出件落款（学校/教师/班级） */
  lessonMeta?: LessonMeta | null;
  /** 离线样例：直接注入座位/互动/事件，跳过 annotationApi 拉取 */
  initialAnnotation?: AnnPayload | null;
}

/** P0-2 报告四章骨架：长报告要能跳着读，章节名用动词短语而非数据术语。 */
const SECTION_NAV = [
  { n: '1', id: 'sec-overview', title: '一眼看这课' },
  { n: '2', id: 'sec-dims', title: '五维拆开看' },
  { n: '3', id: 'sec-evidence', title: '每条分的出处' },
  { n: '4', id: 'sec-scene', title: '课堂现场与材料' },
];

/** 章节抬头：编号 + 标题 + 一句「这一节回答什么」，先教怎么看再给数据。 */
function SectionHead({
  n,
  id,
  title,
  hint,
  questions,
}: {
  n: string;
  id: string;
  title: string;
  hint: string;
  /** 本节「想一想」：给读者 2–3 个可以用眼前数据回答的问题，把报告变成读得下去的读物 */
  questions?: string[];
}) {
  return (
    <div id={id} className="scroll-mt-24 flex items-start gap-2 pt-2">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">
        {n}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        {questions && questions.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {questions.map((q) => (
              <li key={q} className="text-[11px] leading-relaxed text-muted-foreground/85">
                <span className="mr-1 text-primary/70">想</span>
                {q}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 分数 → 文字色（按档位边界，与引擎同口径；维度档名如「较融合」不参与配色） */
function scoreTextClass(score: number | null): string {
  if (score === null) return 'text-muted-foreground';
  if (score >= 8.1) return 'text-emerald-600';
  if (score >= 6.1) return 'text-sky-600';
  if (score >= 4.1) return 'text-amber-600';
  if (score >= 2.1) return 'text-orange-600';
  return 'text-rose-600';
}

const CN_NUM = ['一', '二', '三', '四', '五', '六'];

interface AnnPayload {
  seating?: {
    layout_type?: SeatLayoutType;
    rows?: number;
    cols?: number;
    students?: SeatStudent[];
  };
  interactions?: InteractionEdge[];
  events?: TimelineEvent[];
}

function levelColorClass(level: string | null): string {
  if (!level) return 'bg-muted text-muted-foreground';
  if (level === '优秀') return 'bg-emerald-100 text-emerald-700';
  if (level === '良好') return 'bg-lime-100 text-lime-700';
  if (level === '中等') return 'bg-amber-100 text-amber-700';
  if (level === '待提升') return 'bg-orange-100 text-orange-700';
  return 'bg-red-100 text-red-700';
}

export default function ReportView({
  report,
  lessonId,
  dimensions,
  indicatorNames,
  lessonTitle,
  onUnauthorized,
  lessonMeta,
  initialAnnotation,
}: Props) {
  const [ann, setAnn] = useState<AnnPayload | null>(initialAnnotation ?? null);
  const [loadingAnn, setLoadingAnn] = useState(!initialAnnotation);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement | null>(null);

  const exportFileName = useMemo(() => {
    const title = (lessonTitle || '课堂分析报告').replace(/[\\/:*?"<>|]/g, '_');
    const date = new Date(report.result.generated_at).toISOString().slice(0, 10);
    return `${title}_${date}`;
  }, [lessonTitle, report.result.generated_at]);

  /** 下载独立 HTML 报告：Via 等无打印框架的浏览器的稳定导出路径。 */
  const handleDownloadHtml = () => {
    if (!reportRef.current) return;
    try {
      downloadReportHtml(reportRef.current, exportFileName);
      setExportMsg('已开始下载报告文件，打开后可用浏览器「另存为 PDF」');
    } catch {
      setExportMsg('导出失败，请截图保存或更换浏览器重试');
    }
  };

  /**
   * Via/安卓 WebView 等手机浏览器没有打印框架：window.print() 不抛 JS 异常（catch 不到），
   * 而是由浏览器原生层弹黑色「操作失败」。触屏设备直接走 HTML 下载（文件内可再「另存为 PDF」）；
   * 桌面浏览器才调起系统打印。
   */
  const handlePrint = () => {
    const coarsePointer = typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if (coarsePointer || mobileUA) {
      handleDownloadHtml();
      return;
    }
    try {
      window.print();
      setExportMsg(null);
    } catch {
      handleDownloadHtml();
    }
  };

  useEffect(() => {
    // 离线样例已注入标注，不再请求接口
    if (initialAnnotation) {
      setAnn(initialAnnotation);
      setLoadingAnn(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await annotationApi.get(lessonId);
        if (!cancelled) setAnn((r?.annotation?.payload ?? null) as AnnPayload | null);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          onUnauthorized();
          return;
        }
      } finally {
        if (!cancelled) setLoadingAnn(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId, initialAnnotation]);

  const result = report.result;
  // 离线样例没有「数据接入」原文，证据不可跳转
  const offlineSample = lessonId === 'sample-lesson';

  // V1.17 维度级 AI 解读：旧报告缺省时按需生成一次，随后随报告落库
  const dimInterp = useDimensionInterpretations({
    lessonId,
    genKey: result.generated_at,
    existing: result.dimension_interpretations,
    enabled: !offlineSample && result.ai_meta?.enabled !== false,
  });

  const radarData = useMemo(() => {
    const metaMap = new Map(dimensions.map((d) => [d.code, d]));
    return result.dimension_results.map((d, i) => ({
      dim: metaMap.get(d.dimension_code)?.name ?? `${CN_NUM[i]}`,
      score: d.score ?? 0,
      fullMark: 10,
    }));
  }, [result, dimensions]);

  const reviewCount = result.dimension_results.filter((d) => d.need_review).length;
  // P1-2：仅 0–1 个数据来源时，分数可比性弱，报告显著提示谨慎解读。
  const availableSourceCount = (
    Object.keys(result.source_availability) as Array<keyof typeof result.source_availability>
  ).filter((k) => result.source_availability[k]).length;
  const insufficientBasis = availableSourceCount <= 1;
  // 指标覆盖率：让使用者看清本次实际评到了多少个指标点，未覆盖不等于 0 分
  const indicatorStats = result.dimension_results.reduce(
    (acc, d) => {
      acc.total += d.indicators.length;
      acc.scored += d.indicators.filter((ind) => ind.score !== null && ind.score !== undefined).length;
      return acc;
    },
    { scored: 0, total: 0 },
  );
  const events = [...(ann?.events ?? [])].sort((a, b) => (a.time_sec ?? 0) - (b.time_sec ?? 0));
  const seating = ann?.seating;
  const commentary = result.ai_commentary;
  const lessonTypeEval = result.lesson_type_eval ?? null;

  // P0-3：证据渲染抽成一处——五维卡只留分数与对账，证据独立成章复用同一渲染。
  const renderEvidence = (d: (typeof result.dimension_results)[number]) => {
    const groups = d.source_scores.filter((s) => s.evidences.length > 0);
    const fallbackText = getSourceText('av_transcript') ?? '';
    if (groups.length === 0) {
      if (d.evidences.length === 0) return null;
      return (
        <ul className="mt-1.5 space-y-0">
          {d.evidences.slice(0, 5).map((ev, k) => {
            const at = locateIndex(fallbackText, ev);
            return (
              <EvidenceItem
                key={k}
                quote={ev}
                source="av_transcript"
                timestamp={at >= 0 ? nearestTimestamp(fallbackText, at) : null}
                disabled={offlineSample}
              />
            );
          })}
        </ul>
      );
    }
    return (
      <div className="mt-1 space-y-0">
        {groups.flatMap((s) => {
          const srcText = getSourceText(s.source as LocateSource) ?? '';
          return s.evidences.slice(0, 2).map((ev, k) => {
            const at = locateIndex(srcText, ev);
            return (
              <EvidenceItem
                key={`${s.source}-${k}`}
                quote={ev}
                source={s.source as LocateSource}
                timestamp={s.source === 'av_transcript' && at >= 0 ? nearestTimestamp(srcText, at) : null}
                disabled={offlineSample}
              />
            );
          });
        })}
      </div>
    );
  };

  return (
    <div ref={reportRef} className="space-y-4 print:space-y-3">
      {/* 报告头（打印时不显示按钮） */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="text-foreground/70">{result.standard_name ?? result.standard_code}</span>
          <span>v{result.standard_version}</span>
          <span className="text-muted-foreground/50">·</span>
          <span>生成于{' '}{new Date(result.generated_at).toLocaleString('zh-CN')}</span>
          {report.is_calibrated && <span className="ml-2 text-emerald-600">已含人工终裁</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} title="调起系统打印，可另存为 PDF">
            <Printer className="mr-2 h-4 w-4" /> 打印 / 存 PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadHtml} title="下载独立报告文件，手机浏览器也可用">
            <FileDown className="mr-2 h-4 w-4" /> 下载报告
          </Button>
          <Button variant="outline" size="sm" asChild title="一页 A4 速读，可直接打印或放进档案袋">
            <Link href={`/lessons/${lessonId}/onepage`} target="_blank" rel="noopener">
              <FileText className="mr-2 h-4 w-4" /> 单页版
            </Link>
          </Button>
        </div>
      </div>
      {exportMsg && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800 print:hidden">
          {exportMsg}
        </div>
      )}

      {/* 打印标题与落款（仅打印/导出可见） */}
      <div className="hidden print:block">
        <h1 className="text-lg font-bold">{lessonTitle} · 课堂情智相长分析报告</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          学校：{lessonMeta?.school || '＿＿＿＿＿'} ｜ 班级：{lessonMeta?.grade_class || '＿＿＿＿＿'} ｜ 授课教师：
          {lessonMeta?.teacher_name || '＿＿＿＿＿'} ｜ 评价人：＿＿＿＿＿
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          生成时间：{new Date(result.generated_at).toLocaleString('zh-CN')} ｜ 评价标准：
          {result.standard_name ?? '情智相长课堂评价标准'} v{result.standard_version}
        </p>
      </div>

      {/* P0-2 章节导航：长报告也能跳着读（打印时不出现） */}
      <nav
        aria-label="报告章节导航"
        className="sticky top-2 z-20 overflow-x-auto rounded-lg border border-border/60 bg-background/90 px-1 py-1 backdrop-blur print:hidden"
      >
        <div className="flex items-center gap-0.5 whitespace-nowrap">
          {SECTION_NAV.map((sec) => (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {sec.n}. {sec.title}
            </a>
          ))}
        </div>
      </nav>

      {/* 情智相长一页速读（V1.11）：结论先行，全量证据链在下方 */}
      <SectionHead
        n="1"
        id="sec-overview"
        title="一眼看这课"
        hint="这一节回答「这节课整体什么形状、有没有哪条腿明显短」，三十秒读完，不必先看数字。"
        questions={[
          '认知与情感两侧，哪一侧更亮？',
          '五维里最短的那条腿是哪一维？',
          '如果只改一处，改哪里最划算？',
        ]}
      />
      <EssenceOnePager report={result} />

      {/* 综合分 + 雷达 */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="shadow-card md:col-span-1">
          <CardContent className="flex flex-col items-center justify-center p-5 text-center">
            <div className="text-xs text-muted-foreground">综合得分</div>
            <div className="mt-1 bg-brand-gradient bg-clip-text text-5xl font-bold tabular-nums text-transparent">
              {result.total_score.toFixed(1)}
            </div>
            <Badge className={`mt-2 ${levelColorClass(result.total_level)}`}>{result.total_level}</Badge>
            <div className="mt-2 w-full max-w-[16rem]">
              <ScaleBar score={result.total_score} band={result.total_level} showMeta={false} />
            </div>
            <div className="mt-3 text-[11px] text-muted-foreground">
              满分 10 · 五维综合
              {indicatorStats.total > 0 && (
                <span className="ml-1">
                  ｜ 指标覆盖 {indicatorStats.scored}/{indicatorStats.total}
                </span>
              )}
            </div>
            {insufficientBasis && (
              <div className="mt-2 flex items-start gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800 print:border-amber-300 print:bg-amber-50">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>本次评价依据较少（仅{availableSourceCount === 0 ? '人工标注' : '单一材料'}），分数请谨慎解读</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-card md:col-span-2">
          <CardContent className="p-4">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">图 1-1　五维素养雷达</div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid />
                  <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: '#5b5468' }} />
                  <PolarRadiusAxis domain={[0, 10]} tick={{ fontSize: 9, fill: '#9aa0b0' }} axisLine={false} />
                  <Radar
                    name="得分"
                    dataKey="score"
                    stroke="#5b54e6"
                    fill="#5b54e6"
                    fillOpacity={0.32}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {reviewCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>本报告有 {reviewCount} 个维度存在多源分歧，已在分析页标记待复核；可由教研员人工终裁后重新生成。</span>
        </div>
      )}

      <SectionHead
        n="2"
        id="sec-dims"
        title="五维拆开看"
        hint="这一节回答「五个维度各几分、分是怎么算出来的」——每一维的分数都能用二级指标均值验算。"
        questions={[
          '这个维度分，用下面的二级指标均值能算出来吗？',
          '地图里哪几格是空的？为什么空？',
          '标了待复核的维度，是来源冲突还是对账缺口？',
        ]}
      />

      {/* AI 教学评语（AI 生成，仅作参考，不改变评分） */}
      {commentary && (
        <Card className="break-inside-avoid border-primary/20 shadow-card">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Sparkles className="h-4 w-4 text-primary" /> AI 教学评语
              </div>
              <span className="text-[11px] text-muted-foreground">AI 生成 · 仅作参考</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{commentary.summary}</p>
            <div className="grid gap-3 md:grid-cols-2">
              {commentary.highlights.length > 0 && (
                <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/60 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> 课堂亮点
                  </div>
                  <ul className="space-y-1">
                    {commentary.highlights.map((h, i) => (
                      <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-foreground/85">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-500" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {commentary.suggestions.length > 0 && (
                <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-800">
                    <Lightbulb className="h-3.5 w-3.5" /> 改进建议
                  </div>
                  <ul className="space-y-1">
                    {commentary.suggestions.map((sg, i) => (
                      <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-foreground/85">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                        <span>{sg}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 课型专属要点评价（手册 91 要点，按课型加载）；未生成时固定占位，避免区块凭空消失 */}
      {lessonTypeEval ? (
        <div className="break-inside-avoid">
          <LessonTypeEvalView eval={lessonTypeEval} />
        </div>
      ) : (
        <Card className="shadow-card">
          <CardContent className="py-6 text-center text-xs text-muted-foreground">
            本课例未生成课型要点评价：未指定课型，或运行分析时未开启 AI 深度分析。
          </CardContent>
        </Card>
      )}

      {/* 表一内涵评价：认知 11 指标 + 情感 8 指标，57 个细化观察点；未生成时固定占位 */}
      {result.essence_eval?.llm_used ? (
        <div className="break-inside-avoid">
          <EssenceEvalView eval={result.essence_eval} />
        </div>
      ) : (
        <Card className="shadow-card">
          <CardContent className="py-6 text-center text-xs text-muted-foreground">
            本课例未生成认知·情感观察点：需包含课堂转写文稿并开启 AI 深度分析后运行；AI 繁忙时可稍后重试。
          </CardContent>
        </Card>
      )}

      {/* 五维得分条 + 证据联动 */}
      <Card id="full-evidence" className="shadow-card scroll-mt-20">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ListChecks className="h-4 w-4 text-primary" /> 五维评分与对账
          </div>
          <div className="mb-3">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">图 2-1　二级指标地图</div>
            <IndicatorMap
              results={result.dimension_results}
              meta={dimensions.map((x) => ({ code: x.code, name: x.name }))}
              names={indicatorNames}
            />
          </div>
          {(result.calibrations?.length ?? 0) > 0 && (
            <div className="mb-3 border-l-2 border-emerald-400 pl-2.5 print:break-inside-avoid">
              <div className="text-xs font-semibold text-emerald-800">人工终裁留痕</div>
              <ul className="mt-1.5 space-y-1">
                {result.calibrations!.map((c) => {
                  const dr = result.dimension_results.find((x) => x.dimension_code === c.dimension_code);
                  const meta = dimensions.find((x) => x.code === c.dimension_code);
                  return (
                    <li key={c.dimension_code} className="text-[11px] leading-relaxed text-emerald-900/90">
                      <span className="font-medium">{meta?.name ?? c.dimension_code}</span>：
                      AI {dr?.ai_score !== undefined && dr.ai_score !== null ? dr.ai_score.toFixed(1) : '—'}
                      {' → '}终裁 <span className="font-semibold">{c.final_score?.toFixed(1)}</span>
                      {c.reviewer ? ` · 终裁人 ${c.reviewer}` : ''}
                      {c.reviewed_at ? ` · ${new Date(c.reviewed_at).toLocaleDateString('zh-CN')}` : ''}
                      {c.review_note ? `；理由：${c.review_note}` : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="space-y-3">
            {result.dimension_results.map((d, i) => {
              const meta = dimensions.find((x) => x.code === d.dimension_code);
              return (
                <div key={d.dimension_code} className="break-inside-avoid">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="font-medium text-foreground">
                        {CN_NUM[i]}. {meta?.name ?? d.dimension_code}
                      </span>
                      {d.level_label && (
                        <span className={`text-[13px] font-semibold ${scoreTextClass(d.score)}`}>
                          {d.level_label}
                        </span>
                      )}
                      {d.need_review && (
                        <Badge variant="outline" className="border-amber-300 text-[10px] text-amber-700">
                          {d.review_reason === 'both'
                            ? '待复核·冲突+缺口'
                            : d.review_reason === 'reconcile_gap'
                              ? '待复核·对账缺口'
                              : '待复核·来源冲突'}
                        </Badge>
                      )}
                    </div>
                    <span className="text-right text-[11px] font-normal tabular-nums text-muted-foreground">
                      {d.score === null ? (
                        '—'
                      ) : d.ai_score !== undefined && d.ai_score !== null ? (
                        <span>
                          <span className="mr-1 text-xs font-normal text-muted-foreground line-through print:no-underline">
                            AI {d.ai_score.toFixed(1)}
                          </span>
                          {d.score.toFixed(1)}
                          <span className="ml-1 text-[10px] font-normal text-emerald-700">终裁</span>
                          <span className="text-xs font-normal text-muted-foreground"> / 10</span>
                        </span>
                      ) : (
                        `${d.score.toFixed(1)} / 10`
                      )}
                    </span>
                  </div>
                  <ScaleBar
                    className="mt-1.5"
                    score={d.score}
                    band={d.level_label ?? null}
                    pending={d.indicators.filter((i) => i.score === null).length}
                  />
                  {/* V1.8 分数对账：报告里也给出可验算的口径，避免"指标分与维度分对不上" */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-relaxed text-muted-foreground print:text-[9pt]">
                    {d.reconcile_method === 'indicator_aggregate' ? (
                      <span>
                        对账：{d.indicators.filter((i) => i.score !== null).length} 项二级指标均值 ={' '}
                        <span className="font-medium tabular-nums text-foreground">
                          {(d.indicator_avg ?? d.score ?? 0).toFixed(1)}
                        </span>
                      </span>
                    ) : d.reconcile_method === 'source_fusion' ? (
                      <span>该维度无二级指标，分数由多来源融合得出</span>
                    ) : null}
                    {typeof d.reconcile_gap === 'number' && (
                      <span>
                        · 多来源参考 {typeof d.source_fused === 'number' ? d.source_fused.toFixed(1) : '—'}
                        ，差 {d.reconcile_gap.toFixed(1)}
                        {d.need_review ? '（待复核）' : ''}
                      </span>
                    )}
                  </div>
                  {/* V1.17 维度级 AI 解读：依据/为什么/怎么读/怎么提升，默认收起，导出打印时展开 */}
                  <DimensionInterpretationBlock
                    interpretation={
                      dimInterp.items?.find((x) => x.dimension_code === d.dimension_code) ?? null
                    }
                    loading={dimInterp.loading}
                    error={dimInterp.error}
                    onRetry={dimInterp.retry}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* P0-3 证据独立成章：每条分的原文出处，点任意一条回到课堂现场 */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <SectionHead
            n="3"
            id="sec-evidence"
            title="每条分的出处"
            hint="这一节回答「哪句话支撑了这个分」——每条证据都能点回原文，看过上下文再判断分数是否公道。"
            questions={[
              '按时间顺序读下来，这些瞬间撑得住这个分吗？',
              '有没有被漏掉的课堂片段？',
              '哪一句你并不认同？可以直接改判。',
            ]}
          />
          <div className="mt-2 space-y-3">
            {result.dimension_results.map((d, i) => {
              const meta = dimensions.find((x) => x.code === d.dimension_code);
              const ev = renderEvidence(d);
              if (!ev) return null;
              return (
                <div key={d.dimension_code} className="break-inside-avoid">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-foreground">
                      {CN_NUM[i]}. {meta?.name ?? d.dimension_code}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {d.score === null ? '未评' : `${d.score.toFixed(1)} 分`}
                    </span>
                  </div>
                  {ev}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <SectionHead
        n="4"
        id="sec-scene"
        title="课堂现场与材料"
        hint="这一节是现场快照：座位与互动关系、关键事件打点，以及本次评价实际用到了哪些材料。"
        questions={[
          '发言主要集中在哪些学生身上？',
          '关键事件和前面的分数对得上吗？',
          '这次用到了哪些材料，缺了什么？',
        ]}
      />

      {/* 座位与互动关系图 */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Users className="h-4 w-4 text-primary" /> 图 4-1　课堂互动关系图
          </div>
          {loadingAnn ? (
            <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载标注…
            </div>
          ) : seating && seating.students && seating.students.length > 0 ? (
            <SeatingSnapshot
              layoutType={seating.layout_type ?? 'rows'}
              rows={seating.rows ?? 6}
              cols={seating.cols ?? 7}
              students={seating.students}
              interactions={ann?.interactions ?? []}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
              本节课尚未进行座位与互动标注
            </div>
          )}
        </CardContent>
      </Card>

      {/* 关键事件打点 */}
      {events.length > 0 && (
        <Card className="shadow-card">
          <CardContent className="p-4">
            <div className="mb-3 text-sm font-medium text-foreground">关键事件打点（{events.length}）</div>
            <ol className="space-y-2">
              {events.map((e) => {
                const mm = Math.floor((e.time_sec ?? 0) / 60).toString().padStart(2, '0');
                const ss = ((e.time_sec ?? 0) % 60).toString().padStart(2, '0');
                return (
                  <li key={e.id} className="flex gap-3 text-xs">
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono tabular-nums text-primary">
                      {mm}:{ss}
                    </span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {EVENT_CATEGORY_LABEL[e.category] ?? e.category}
                    </Badge>
                    <span className="text-muted-foreground">{e.note || '—'}</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* P2-3 报告性质声明：把控制权写在明面上，正面回应「AI 给教师打分」的顾虑 */}
      <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[10px] leading-relaxed text-muted-foreground print:border-0 print:bg-transparent">
        <span className="font-medium text-foreground/80">报告性质：</span>
        本报告用于教学改进与自我反思，不用于人事评价、职称评审或教师排名；是否分享给他人、何时查阅，由授课教师决定。AI
        判定可能有偏差，任一维度分数均可由教研员人工终裁后重新生成。
      </div>

      {/* 数据来源说明（打印留痕）；P1-5：面向教师只说明用了哪些材料，不展示内部权重刻度 */}
      <div className="text-[10px] leading-relaxed text-muted-foreground/80">
        评价依据：
        {(Object.keys(SOURCE_LABEL) as Array<keyof typeof SOURCE_LABEL>)
          .filter((k) => result.source_availability[k])
          .map((k) => SOURCE_LABEL[k])
          .join('、') || '无'}
        ；系统综合多源材料评分，材料不足的来源自动降权。
      </div>

      {/* 打印/导出落款页脚：学校、教师、班级、评价人、日期、标准版本（P1-6） */}
      <div className="hidden break-inside-avoid text-[10px] leading-relaxed text-muted-foreground/80 print:block">
        <div className="mt-2 border-t border-border pt-2">
          学校：{lessonMeta?.school || '＿＿＿＿＿'}　班级：{lessonMeta?.grade_class || '＿＿＿＿＿'}　授课教师：
          {lessonMeta?.teacher_name || '＿＿＿＿＿'}　评价人（签名）：＿＿＿＿＿
        </div>
        <div className="mt-1">
          评价标准：{result.standard_name ?? '情智相长课堂评价标准'} v{result.standard_version}　报告生成时间：
          {new Date(result.generated_at).toLocaleString('zh-CN')}
        </div>
      </div>
    </div>
  );
}
