'use client';

import { useMemo, useState } from 'react';
import {
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  Scale,
  Sparkles,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import LessonTypeBar from '@/components/lesson/LessonTypeBar';
import ConsistencyCheck from '@/components/lesson/ConsistencyCheck';
import LessonTypeEvalView from '@/components/report/LessonTypeEvalView';
import EssenceEvalView from '@/components/report/EssenceEvalView';
import EvidenceItem from '@/components/report/EvidenceItem';
import DimensionInterpretationBlock, {
  useDimensionInterpretations,
} from '@/components/report/DimensionInterpretation';
import { getSourceText, locateQuote, nearestTimestamp, type LocateSource } from '@/lib/report/locate';
import {
  SOURCE_LABEL,
  type DataSource,
} from '@/lib/evaluation/types';
import type { DimMeta } from '@/components/annotation/DimensionScores';
import type { AnalysisRunner } from '@/components/lesson/useAnalysisRunner';

interface Props {
  lessonId: string;
  dimensions: DimMeta[];
  onUnauthorized: () => void;
  /** 分析运行器：报告、运行状态与「重新运行分析」入口由页面顶层的全局控制条（视频上方）持有。 */
  runner: AnalysisRunner;
}

/** 与 `DataSource` 保持一致的五路来源；此前漏掉 `lesson_plan`，导致教案明明已评分却不在齐备性面板显示。 */
const SOURCE_KEYS: DataSource[] = [
  'av_transcript',
  'manual_annotation',
  'observer_note',
  'task_sheet',
  'lesson_plan',
];

const CN_NUM = ['一', '二', '三', '四', '五', '六'];

function scoreColor(score: number | null): string {
  if (score === null || score === undefined) return 'bg-muted';
  if (score >= 8.5) return 'bg-emerald-500';
  if (score >= 7) return 'bg-lime-500';
  if (score >= 5.5) return 'bg-amber-400';
  if (score >= 3.5) return 'bg-orange-400';
  return 'bg-red-400';
}

export default function AnalysisPanel({ lessonId, dimensions, onUnauthorized, runner }: Props) {
  // 人工终裁输入（仅本地草稿，点击「应用终裁并重算」时随请求提交）
  const [calib, setCalib] = useState<Record<string, string>>({});
  const [calibNote, setCalibNote] = useState<Record<string, string>>({});
  const report = runner.report;

  const dimMeta = useMemo(() => {
    const m = new Map<string, DimMeta>();
    dimensions.forEach((d) => m.set(d.code, d));
    return m;
  }, [dimensions]);

  // V1.17 维度级 AI 解读：旧报告缺省时按需生成一次（与报告面板共享同一请求）
  const dimInterp = useDimensionInterpretations({
    lessonId,
    genKey: report?.result.generated_at ?? '',
    existing: report?.result.dimension_interpretations ?? null,
    enabled: !!report && report.result.ai_meta?.enabled !== false,
  });

  if (runner.loading) {
    return (
      <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" /> 正在加载分析结果…
      </div>
    );
  }

  const result = report?.result;
  const availability = result?.source_availability;
  // P1-2：评价依据充分性。可用来源 <2 个时，分数仅来自单一渠道，显著提示谨慎解读。
  const availableSourceCount = availability
    ? SOURCE_KEYS.filter((k) => availability[k]).length
    : 0;
  const insufficientBasis = availableSourceCount <= 1;
  const reviewDims = result?.dimension_results.filter((d) => d.need_review) ?? [];
  const aiMeta = result?.ai_meta;
  const commentary = result?.ai_commentary;
  const lessonTypeEval = result?.lesson_type_eval ?? null;
  const essenceEval = result?.essence_eval ?? null;

  return (
    <div className="space-y-4">
      <LessonTypeBar lessonId={lessonId} onUnauthorized={onUnauthorized} onChange={runner.setLessonType} />


      {aiMeta && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
            aiMeta.used
              ? 'border-primary/25 bg-primary/[0.05] text-primary'
              : 'border-border bg-muted/40 text-muted-foreground'
          }`}
        >
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {aiMeta.used
              ? `AI 已参与本次评分${commentary ? '，并生成了教学评语' : ''}`
              : aiMeta.enabled
                ? `AI 本次未能完成，已用内置评分规则完成评价${aiMeta.error ? `：${aiMeta.error}` : ''}`
                : '本次分析未启用 AI（仅使用内置评分规则）'}
          </span>
        </div>
      )}

      {!result ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
          <Gauge className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-foreground">尚未生成分析报告</p>
          <p className="mt-1 text-xs text-muted-foreground">
            请先在「数据接入」导入转写文稿 / 观察记录，或在「人工标注」完成打分与打点，再点击左列视频上方的「运行课堂分析」。
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="shadow-card sm:col-span-1">
              <CardContent className="flex flex-col items-center justify-center p-5 text-center">
                <div className="text-xs text-muted-foreground">综合得分</div>
                <div className="mt-1 bg-brand-gradient bg-clip-text text-4xl font-bold tabular-nums text-transparent">
                  {result.total_score.toFixed(1)}
                </div>
                <Badge className="mt-2 border-0 bg-brand-gradient hover:bg-brand-gradient">{result.total_level}</Badge>
                {report.is_calibrated && (
                  <div className="mt-1.5 text-[11px] font-medium text-emerald-600">已含人工校准终裁</div>
                )}
                {(() => {
                  const total = result.dimension_results.reduce((n, d) => n + d.indicators.length, 0);
                  const scored = result.dimension_results.reduce(
                    (n, d) => n + d.indicators.filter((ind) => ind.score !== null && ind.score !== undefined).length,
                    0,
                  );
                  return total > 0 ? (
                    <div className="mt-1.5 text-[11px] text-muted-foreground">指标覆盖 {scored}/{total}</div>
                  ) : null;
                })()}
                {insufficientBasis && (
                  <div className="mt-2 flex items-start gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>本次仅依据{availableSourceCount === 0 ? '人工标注' : '单一材料'}评价，分数请谨慎解读；补充课堂转写或观察记录后重新分析更可靠。</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-card sm:col-span-2">
              <CardContent className="p-4">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Database className="h-3.5 w-3.5 text-primary" /> 数据来源齐备性
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {SOURCE_KEYS.map((key) => {
                    const ok = availability?.[key];
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
                          ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-border bg-muted/50 text-muted-foreground'
                        }`}
                      >
                        {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border border-border" />}
                        {SOURCE_LABEL[key]}
                      </div>
                    );
                  })}
                </div>
                {reviewDims.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {reviewDims.length} 个维度存在多源分歧（分差 ≥ 2.5），建议在「冲突复核」中人工终裁。
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="dimensions">
            {/* 窄屏 5 个标签放不下会把整页撑出横向滚动，改为标签栏内自身横滑 */}
            <TabsList className="h-auto w-full justify-start overflow-x-auto bg-muted p-[3px] sm:inline-flex sm:w-fit sm:justify-center">
              <TabsTrigger value="dimensions" className="shrink-0">
                五维结果与证据
              </TabsTrigger>
              <TabsTrigger value="lesson-type" className="shrink-0">
                课型要点
                {lessonTypeEval && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {lessonTypeEval.lesson_type_name}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="essence" className="shrink-0">
                认知·情感观察点
              </TabsTrigger>
              <TabsTrigger value="review" className="shrink-0">
                冲突复核
                {reviewDims.length > 0 && (
                  <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
                    {reviewDims.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="ai" className="shrink-0">
                AI 教学评语
                {commentary && <Sparkles className="ml-1.5 h-3 w-3 text-primary" />}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dimensions" className="space-y-3">
              {result.dimension_results.map((d, idx) => {
                const meta = dimMeta.get(d.dimension_code);
                const name = meta?.name ?? d.dimension_code;
                return (
                  <Card key={d.dimension_code} className="shadow-card">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {CN_NUM[idx] ?? idx + 1}. {name}
                          </span>
                          {d.need_review && (
                            <Badge variant="outline" className="border-amber-300 text-amber-700">
                              <AlertTriangle className="mr-1 h-3 w-3" /> 待复核
                            </Badge>
                          )}
                          {d.level_label && <Badge variant="secondary">{d.level_label}</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${scoreColor(d.score)}`}
                              style={{ width: `${((d.score ?? 0) / 10) * 100}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-sm font-semibold tabular-nums">
                            {d.score === null ? '—' : d.score.toFixed(1)}
                          </span>
                        </div>
                      </div>
                      {/* V1.8 分数对账：让老师能自己把维度分算出来 */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-relaxed text-muted-foreground">
                        {d.reconcile_method === 'indicator_aggregate' ? (
                          <span>
                            {typeof d.ai_score === 'number' ? 'AI 分对账：' : '对账：'}
                            {d.indicators.filter((i) => i.score !== null).length} 项二级指标均值 ={' '}
                            <span className="font-medium tabular-nums text-foreground">
                              {(d.indicator_avg ?? d.score ?? 0).toFixed(1)}
                            </span>
                            <span className="text-muted-foreground/70">
                              {typeof d.ai_score === 'number'
                                ? `（已终裁为 ${d.score === null ? '—' : d.score.toFixed(1)}）`
                                : '（把上面各指标分平均即得）'}
                            </span>
                          </span>
                        ) : d.reconcile_method === 'source_fusion' ? (
                          <span>该维度无二级指标，分数由多来源融合得出，无法按指标验算</span>
                        ) : null}
                        {typeof d.reconcile_gap === 'number' && (
                          <span className="text-muted-foreground/80">
                            · 多来源参考 {typeof d.source_fused === 'number' ? d.source_fused.toFixed(1) : '—'}
                            ，差 {d.reconcile_gap.toFixed(1)}
                            {d.need_review && ' → 需人工复核'}
                          </span>
                        )}
                      </div>
                      {/* V1.17 维度级 AI 解读：依据/为什么/怎么读/怎么提升，默认收起 */}
                      <DimensionInterpretationBlock
                        interpretation={
                          dimInterp.items?.find((x) => x.dimension_code === d.dimension_code) ?? null
                        }
                        loading={dimInterp.loading}
                        error={dimInterp.error}
                        onRetry={dimInterp.retry}
                      />
                      {(() => {
                        // P1-1：证据可点击跳回「数据接入」原文位置；按来源分组，无分组时回退普通列表。
                        const groups = d.source_scores.filter((s) => s.evidences.length > 0);
                        if (groups.length === 0 && d.evidences.length === 0) return null;
                        if (groups.length === 0) {
                          const srcText = getSourceText('av_transcript') ?? '';
                          return (
                            <ul className="mt-2 space-y-0">
                              {d.evidences.slice(0, 6).map((ev, i) => {
                                const at = locateQuote(srcText, ev)?.start ?? -1;
                                return (
                                  <EvidenceItem
                                    key={i}
                                    quote={ev}
                                    source="av_transcript"
                                    timestamp={at >= 0 ? nearestTimestamp(srcText, at) : null}
                                  />
                                );
                              })}
                            </ul>
                          );
                        }
                        return (
                          <div className="mt-2 space-y-0">
                            {groups.flatMap((s) => {
                              const srcText = getSourceText(s.source as LocateSource) ?? '';
                              return s.evidences.slice(0, 3).map((ev, i) => {
                                const at = locateQuote(srcText, ev)?.start ?? -1;
                                return (
                                  <EvidenceItem
                                    key={`${s.source}-${i}`}
                                    quote={ev}
                                    source={s.source as LocateSource}
                                    timestamp={s.source === 'av_transcript' && at >= 0 ? nearestTimestamp(srcText, at) : null}
                                  />
                                );
                              });
                            })}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>

            <TabsContent value="lesson-type">
              {lessonTypeEval ? (
                <LessonTypeEvalView eval={lessonTypeEval} />
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">本课例暂未生成课型要点评价</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {runner.lessonType
                      ? '请开启「AI 深度分析」并重新运行；若 AI 繁忙，可稍后再试。'
                      : '请先在上方选择课型（或用 AI 识别），再运行分析。'}
                  </p>
                </div>
              )}
            </TabsContent>
            <TabsContent value="essence">
              {essenceEval?.llm_used ? (
                <EssenceEvalView
                  eval={essenceEval}
                  lessonId={lessonId}
                  genKey={report?.result.generated_at ?? ''}
                  existing={report?.result.essence_interpretations ?? null}
                  enabled={!!report && report.result.ai_meta?.enabled !== false}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                  <p className="text-sm font-medium text-foreground">本课例暂未生成认知·情感观察点</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    观察点由 AI 阅读课堂转写后生成，请确认已粘贴课堂转写文稿、开启「AI 深度分析」后重新运行；AI 繁忙时可稍后再试。
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="review" className="space-y-3">
              <Card className="shadow-card">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Scale className="h-4 w-4 text-primary" /> 人工终裁（填写后覆盖 AI 评分并重算综合分，AI 分与终裁分均会保留）
                  </div>
                  {result.dimension_results.map((d, idx) => {
                    const meta = dimMeta.get(d.dimension_code);
                    return (
                      <div key={d.dimension_code} className="rounded-xl border border-border/80 bg-muted/20 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-medium text-foreground">
                            {CN_NUM[idx] ?? idx + 1}. {meta?.name ?? d.dimension_code}
                            {d.need_review && (
                              <Badge variant="outline" className="ml-2 border-amber-300 text-amber-700">
                                {d.review_reason === 'both'
                                  ? '来源冲突 + 对账缺口'
                                  : d.review_reason === 'reconcile_gap'
                                    ? '对账有缺口'
                                    : '来源分差过大'}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">AI 融合 {d.score === null ? '—' : d.score.toFixed(1)}</span>
                            <Input
                              type="number"
                              min={0}
                              max={10}
                              step={0.5}
                              placeholder="终裁0-10"
                              className="h-8 w-24 text-xs"
                              value={calib[d.dimension_code] ?? ''}
                              onChange={(e) => setCalib((c) => ({ ...c, [d.dimension_code]: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {SOURCE_KEYS.map((key) => {
                            const found = d.source_scores.find((s) => s.source === key);
                            const avg = found && found.score !== null ? found.score : null;
                            return (
                              <span
                                key={key}
                                className={`rounded-md px-1.5 py-0.5 text-[11px] ${
                                  avg === null ? 'bg-muted text-muted-foreground/60' : 'bg-primary/10 text-primary'
                                }`}
                              >
                                {SOURCE_LABEL[key]} {avg === null ? '无数据' : avg.toFixed(1)}
                              </span>
                            );
                          })}
                        </div>
                        <Input
                          type="text"
                          maxLength={200}
                          placeholder="终裁理由（选填，如：结合课后访谈与作业表现上调）"
                          className="mt-2 h-8 text-xs"
                          value={calibNote[d.dimension_code] ?? ''}
                          onChange={(e) => setCalibNote((n) => ({ ...n, [d.dimension_code]: e.target.value }))}
                        />
                      </div>
                    );
                  })}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() =>
                        runner.run({
                          calibrations: Object.entries(calib)
                            .map(([dimension_code, v]) => ({
                              dimension_code,
                              final_score: v.trim() === '' ? null : Math.max(0, Math.min(10, Number(v))),
                              review_note: calibNote[dimension_code]?.trim() || undefined,
                            }))
                            .filter((c) => c.final_score !== null && !Number.isNaN(c.final_score as number)),
                        })
                      }
                      disabled={runner.running}
                    >
                      {runner.running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                      应用终裁并重算
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ai" className="space-y-3">
              {commentary ? (
                <>
                  <Card className="border-primary/20 shadow-card">
                    <CardContent className="space-y-2 p-4">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <Sparkles className="h-4 w-4 text-primary" /> 总体结论
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/90">{commentary.summary}</p>
                    </CardContent>
                  </Card>

                  {commentary.highlights.length > 0 && (
                    <Card className="shadow-card">
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> 课堂亮点
                        </div>
                        <ul className="space-y-1.5">
                          {commentary.highlights.map((h, i) => (
                            <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                              <span>{h}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {commentary.suggestions.length > 0 && (
                    <Card className="shadow-card">
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <Lightbulb className="h-4 w-4 text-amber-500" /> 教学改进建议
                        </div>
                        <ul className="space-y-1.5">
                          {commentary.suggestions.map((sg, i) => (
                            <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                              <span>{sg}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  <div className="text-[11px] text-muted-foreground/80">
                    由 AI 生成于 {new Date(commentary.generated_at).toLocaleString('zh-CN')} · AI 评语仅作参考，不改变评分
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center">
                  <Sparkles className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium text-foreground">本次报告未包含 AI 评语</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {aiMeta?.enabled === false
                      ? '当前已关闭「AI 深度分析」，开启后重新运行即可生成。'
                      : 'AI 评语本次未生成（可能是服务繁忙或超时），评分结果不受影响，可稍后重新运行分析。'}
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <div className="text-[11px] text-muted-foreground/80">
            {result.standard_name ?? '情智相长课堂评价标准'} v{result.standard_version} · 生成于 {new Date(result.generated_at).toLocaleString('zh-CN')}
          </div>

          {runner.useLlm && <ConsistencyCheck lessonId={lessonId} onUnauthorized={onUnauthorized} />}
        </>
      )}
    </div>
  );
}
