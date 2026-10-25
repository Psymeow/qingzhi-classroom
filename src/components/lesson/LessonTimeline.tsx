'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Loader2, PlayCircle, Volume2, AlertTriangle, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AnalysisReport, EssenceDomainResult } from '@/lib/evaluation/types';
import { markersFor, msToClock, type TimelineMarker, type TimelineSegment } from '@/lib/report/timeline';
import { friendlyError } from '@/components/feedback/StateBlocks';

interface SourceMedia {
  id: string;
  file_name: string | null;
  size_bytes: number | null;
  created_at: string | null;
  url: string | null;
}

interface TimelinePayload {
  segment_source: 'asr' | 'transcript' | 'none';
  segments: TimelineSegment[];
  duration_ms: number | null;
  transcript_chars: number;
  videos: SourceMedia[];
  audios: SourceMedia[];
}

interface IndicatorRow {
  code: string;
  name: string;
  category: string;
  score: number | null;
  markers: TimelineMarker[];
  /** 该指标带了多少条文字证据（含未能挂上时间轴的） */
  quoteCount: number;
}

interface DomainGroup {
  key: 'cognitive' | 'affective';
  label: string;
  score: number | null;
  rows: IndicatorRow[];
}

const scoreTone = (score: number | null): string => {
  if (score === null) return 'text-muted-foreground';
  if (score >= 8.1) return 'text-emerald-700';
  if (score >= 6.1) return 'text-sky-700';
  if (score >= 4.1) return 'text-amber-700';
  if (score >= 2.1) return 'text-orange-700';
  return 'text-rose-700';
};

const dotTone = (score: number | null): string => {
  if (score === null) return 'bg-muted-foreground/40';
  if (score >= 8.1) return 'bg-emerald-500';
  if (score >= 6.1) return 'bg-sky-500';
  if (score >= 4.1) return 'bg-amber-500';
  if (score >= 2.1) return 'bg-orange-500';
  return 'bg-rose-500';
};

/**
 * 课堂切片：把报告里基于课堂实录的证据挂到视频时间轴上。
 *
 * 每个内涵指标（认知 11 + 情感 8）一行时间轴，圆点=该指标证据出现的时刻；
 * 点圆点 → 播放器跳到那一秒。横条长度=课堂实录总长。
 *
 * 只有「课堂实录」这一路证据能挂时间轴：观察记录、任务单、教案没有时间坐标，
 * 所以指标行会同时给出「几条证据挂上了 / 共几条」，避免把挂不上的当成没证据。
 */
export default function LessonTimeline({ lessonId, result }: { lessonId: string; result: AnalysisReport | null }) {
  const [data, setData] = useState<TimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMedia, setActiveMedia] = useState<string | null>(null);
  const [active, setActive] = useState<{ code: string; name: string; marker: TimelineMarker } | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/lessons/${lessonId}/timeline`, { cache: 'no-store' });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `加载失败（${res.status}）`);
        }
        const payload = (await res.json()) as TimelinePayload;
        if (cancelled) return;
        setData(payload);
        const first = payload.videos.find((v) => v.url) ?? payload.audios.find((a) => a.url) ?? null;
        setActiveMedia(first?.url ?? null);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e, '课堂时间轴加载失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const segments = data?.segments ?? [];
  const durationMs = data?.duration_ms ?? null;

  const groups = useMemo<DomainGroup[]>(() => {
    const essence = result?.essence_eval;
    if (!essence || !segments.length) return [];
    const build = (
      key: 'cognitive' | 'affective',
      label: string,
      domain: EssenceDomainResult | undefined,
    ): DomainGroup => ({
      key,
      label,
      score: domain?.score ?? null,
      rows: (domain?.indicators ?? []).map((ind) => {
        const quotes = ind.points.flatMap((p) => p.evidences ?? []);
        const markers = markersFor(segments, quotes);
        return {
          code: ind.code,
          name: ind.name,
          category: ind.category,
          score: ind.score,
          markers,
          quoteCount: quotes.length,
        };
      }),
    });
    return [
      build('cognitive', '认知 · 高阶思维发展', essence.cognitive),
      build('affective', '情感 · 数学情感素养', essence.affective),
    ];
  }, [result, segments]);

  const seek = useCallback((row: IndicatorRow, marker: TimelineMarker) => {
    const el = mediaRef.current;
    if (el) {
      el.currentTime = Math.max(0, marker.startMs / 1000);
      void el.play().catch(() => {});
    }
    setActive({ code: row.code, name: row.name, marker });
  }, []);

  const totalMarkers = groups.reduce((n, g) => n + g.rows.reduce((m, r) => m + r.markers.length, 0), 0);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载课堂实录时间轴…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 py-8 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const hasMedia = Boolean(activeMedia);
  const hasSegments = segments.length > 0;
  const mediaList = [...data.videos, ...data.audios].filter((m) => m.url);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Film className="h-4 w-4 text-muted-foreground" />
            课堂切片
            {hasSegments && (
              <Badge variant="secondary" className="ml-1 font-normal">
                {data.segment_source === 'asr' ? '识别时间轴' : '文稿时间码'} · {segments.length} 段
              </Badge>
            )}
          </CardTitle>
          <p className="text-[13px] leading-5 text-muted-foreground">
            每个维度一行时间轴，圆点是该维度在课堂里出现的证据时刻，点一下直接跳到视频对应位置。
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasMedia && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-[13px] leading-5 text-muted-foreground">
              这节课还没有上传课堂录像或录音。到「数据接入」上传音视频后，点素材上的「识别为文稿」，
              系统会抽音轨识别并留下分段时间轴，本页的圆点才能跳到具体时刻。
            </div>
          )}

          {hasMedia && (
            <div className="overflow-hidden rounded-lg border border-border/70 bg-black">
              {data.videos.some((v) => v.url === activeMedia) ? (
                <video
                  ref={(el) => { mediaRef.current = el; }}
                  src={activeMedia ?? undefined}
                  controls
                  playsInline
                  className="aspect-video w-full bg-black"
                />
              ) : (
                <div className="flex items-center gap-3 bg-card px-4 py-6">
                  <Volume2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <audio
                    ref={(el) => { mediaRef.current = el; }}
                    src={activeMedia ?? undefined}
                    controls
                    className="w-full"
                  />
                </div>
              )}
            </div>
          )}

          {mediaList.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {mediaList.map((m) => {
                const on = m.url === activeMedia;
                return (
                  <Button
                    key={m.id}
                    type="button"
                    size="sm"
                    variant={on ? 'secondary' : 'ghost'}
                    className="h-7 max-w-[220px] truncate text-[12px]"
                    onClick={() => setActiveMedia(m.url)}
                    title={m.file_name ?? undefined}
                  >
                    {m.file_name ?? '课堂实录'}
                  </Button>
                );
              })}
            </div>
          )}

          {!hasSegments && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-[13px] leading-5 text-muted-foreground">
              还没有可用时间轴。两条路：① 在上方素材点「识别为文稿」由音视频自动生成带时间码的逐字稿；
              ② 上传或粘贴带 <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">[08:12]</code>{' '}
              行首时间码的转写文稿，系统会直接按行解析出时间轴。
            </div>
          )}

          {hasSegments && totalMarkers === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-[13px] leading-5 text-muted-foreground">
              时间轴已就绪，但当前报告里的证据还没挂上具体时刻——通常是因为分析结果生成于时间轴之前。
              重新运行一次分析，证据就会带上下标时间。
            </div>
          )}
        </CardContent>
      </Card>

      {hasSegments &&
        groups.map((group) => (
          <Card key={group.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                <span>{group.label}</span>
                <span className={`text-sm font-medium tabular-nums ${scoreTone(group.score)}`}>
                  {group.score === null ? '未评' : group.score.toFixed(1)}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {group.rows.map((row) => (
                <div key={row.code} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-1 py-1 hover:bg-muted/40">
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{row.code}</span>
                      <span className="truncate text-[13px] font-medium">{row.name}</span>
                      <span className={`ml-auto shrink-0 text-[12px] tabular-nums ${scoreTone(row.score)}`}>
                        {row.score === null ? '—' : row.score.toFixed(1)}
                      </span>
                    </div>
                    <div className="relative mt-1.5 h-5">
                      {/* 底槽：长度 = 课堂实录总长 */}
                      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" aria-hidden />
                      {row.markers.map((marker) => {
                        const pct = durationMs && durationMs > 0 ? Math.min(100, (marker.startMs / durationMs) * 100) : 0;
                        const on = active?.code === row.code && active.marker.startMs === marker.startMs;
                        return (
                          <button
                            key={`${row.code}-${marker.startMs}`}
                            type="button"
                            onClick={() => seek(row, marker)}
                            title={`${msToClock(marker.startMs)} · ${marker.text.slice(0, 60)}`}
                            aria-label={`跳到 ${msToClock(marker.startMs)}`}
                            className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card transition-transform hover:scale-150 focus-visible:outline-none focus-visible:ring-primary ${
                              on ? 'scale-150 ring-primary' : ''
                            } ${dotTone(row.score)}`}
                            style={{ left: `${pct}%` }}
                          />
                        );
                      })}
                      {row.markers.length === 0 && row.quoteCount > 0 && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70">
                          {row.quoteCount} 条证据未挂上课堂时刻（来自观察记录/任务单，或引文与逐字稿不一致）
                        </span>
                      )}
                      {row.quoteCount === 0 && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/60">
                          本次未取到文字证据
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[11px] leading-4 text-muted-foreground">
                    {row.markers.length > 0 ? `${row.markers.length} 处` : '—'}
                    <ChevronRight className="ml-0.5 inline h-3 w-3" />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}

      {active && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-1.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <PlayCircle className="h-4 w-4 text-primary" />
              <span className="font-mono tabular-nums">{msToClock(active.marker.startMs)}</span>
              <span className="font-normal text-muted-foreground">
                {active.code} {active.name}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <p className="text-[13px] leading-6">「{active.marker.text}」</p>
            {active.marker.quote && active.marker.quote !== active.marker.text && (
              <p className="text-[12px] leading-5 text-muted-foreground">
                报告引用：{active.marker.quote}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
