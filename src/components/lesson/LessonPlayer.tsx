'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Loader2, Volume2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SEEK_EVENT, msToClock, type SeekDetail, type TimelineSegment } from '@/lib/report/timeline';
import { friendlyError } from '@/components/feedback/StateBlocks';
import { api } from '@/lib/api/client';

interface SourceMedia {
  id: string;
  file_name: string | null;
  url: string | null;
}

interface TimelinePayload {
  segment_source: 'asr' | 'transcript' | 'none';
  segments: TimelineSegment[];
  duration_ms: number | null;
  videos: SourceMedia[];
  audios: SourceMedia[];
}

/** 说话人四类的徽标配色：教师 / 学生 / 齐声 / 媒体；未标注的段不显示 */
const SPEAKER_BADGE: Record<string, string> = {
  教师: 'bg-blue-50 text-blue-700 ring-blue-200',
  学生: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  齐声: 'bg-amber-50 text-amber-700 ring-amber-200',
  媒体: 'bg-purple-50 text-purple-700 ring-purple-200',
};

/**
 * 课堂播放器：视频/音频 + 实时字幕。
 *
 * 与「课堂切片」时间轴解耦：本组件只负责播放与字幕，跳转统一走 SEEK_EVENT，
 * 报告证据、时间轴圆点、问答引用都通过 seekTo() 派发事件，由这里执行。
 *
 * 字幕跟随：播放中自动把当前句滚到可见区；用户手动滚动后暂停跟随 4 秒，
 * 避免和阅读发生拉扯。段数很多时靠 content-visibility 让浏览器跳过屏外渲染。
 */
export default function LessonPlayer({ lessonId }: { lessonId: string }) {
  const [data, setData] = useState<TimelinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeMedia, setActiveMedia] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef(false);
  const programmaticRef = useRef(false);
  const lockTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const payload = await api.get<TimelinePayload>(`/api/lessons/${lessonId}/timeline`);
        if (cancelled) return;
        setData(payload);
        const first = payload.videos.find((v) => v.url) ?? payload.audios.find((a) => a.url) ?? null;
        setActiveMedia(first?.url ?? null);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e, '课堂播放器加载失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const seekToMs = useCallback((ms: number, autoplay: boolean) => {
    const el = mediaRef.current;
    if (!el) return;
    const sec = Math.max(0, ms / 1000);
    // 同一位置只补播放：不必要的 currentTime 赋值会触发 timeupdate 抖动，字幕跟着跳
    if (Math.abs(el.currentTime - sec) > 0.05) el.currentTime = sec;
    if (autoplay) void el.play().catch(() => {});
    setCurrentMs(ms);
    // 显式跳转（点字幕/点证据）不算用户滚动，恢复自动跟随
    scrollLockRef.current = false;
  }, []);

  // 接收外部跳转请求
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<SeekDetail>).detail;
      if (!d || typeof d.ms !== 'number' || !Number.isFinite(d.ms)) return;
      seekToMs(d.ms, true);
    };
    window.addEventListener(SEEK_EVENT, handler);
    return () => window.removeEventListener(SEEK_EVENT, handler);
  }, [seekToMs]);

  const onTimeUpdate = useCallback(() => {
    const el = mediaRef.current;
    if (el) setCurrentMs(el.currentTime * 1000);
  }, []);

  const segments = data?.segments ?? [];

  /** 当前播放位置落在第几段（二分；段起点已按时间排序） */
  const currentSeg = useMemo(() => {
    if (!segments.length) return -1;
    let lo = 0;
    let hi = segments.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].s <= currentMs) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }, [currentMs, segments]);

  useEffect(() => {
    if (currentSeg < 0 || scrollLockRef.current) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-seg="${currentSeg}"]`);
    if (!el) return;
    programmaticRef.current = true;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentSeg]);

  const onListScroll = useCallback(() => {
    // 程序触发的滚动不锁定，只有用户手动滚才暂停跟随
    if (programmaticRef.current) {
      programmaticRef.current = false;
      return;
    }
    scrollLockRef.current = true;
    if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = window.setTimeout(() => {
      scrollLockRef.current = false;
    }, 4000);
  }, []);

  useEffect(
    () => () => {
      if (lockTimerRef.current) window.clearTimeout(lockTimerRef.current);
    },
    [],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载课堂实录…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-start gap-2 py-6 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </CardContent>
      </Card>
    );
  }

  const hasMedia = Boolean(activeMedia);
  const hasSegments = segments.length > 0;
  const mediaList = [...(data?.videos ?? []), ...(data?.audios ?? [])].filter((m) => m.url);
  // 有媒体记录但一个都签不出 URL（存储凭证/对象缺失）：不能当成「没传过」误导用户
  const mediaCount = (data?.videos?.length ?? 0) + (data?.audios?.length ?? 0);
  const mediaSignBroken = !hasMedia && mediaCount > 0;
  const isVideo = (data?.videos ?? []).some((v) => v.url === activeMedia);

  return (
    <Card className="overflow-hidden shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Film className="h-4 w-4 text-muted-foreground" />
          课堂实录
          {hasSegments && (
            <Badge variant="secondary" className="ml-1 font-normal">
              {data?.segment_source === 'asr' ? '识别时间轴' : '文稿时间码'} · {segments.length} 段
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {!hasMedia && !mediaSignBroken && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-[13px] leading-5 text-muted-foreground">
            这节课还没有课堂录像或录音。到「数据接入」上传后，这里会常驻播放器和逐句字幕，
            右侧的证据、时间轴都能一键跳到对应时刻。
          </div>
        )}

        {mediaSignBroken && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] leading-5 text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              已上传 {mediaCount} 个音视频，但播放地址生成失败（通常是存储服务异常或文件对象缺失）。
              请稍后刷新重试；若持续出现，请联系管理员并附上课例名称。
            </span>
          </div>
        )}

        {hasMedia && (
          <div className="overflow-hidden rounded-lg border border-border/70 bg-black">
            {isVideo ? (
              <video
                ref={(el) => {
                  mediaRef.current = el;
                }}
                src={activeMedia ?? undefined}
                controls
                playsInline
                onTimeUpdate={onTimeUpdate}
                className="aspect-video w-full bg-black"
              />
            ) : (
              <div className="flex items-center gap-3 bg-card px-4 py-5">
                <Volume2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <audio
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  src={activeMedia ?? undefined}
                  controls
                  onTimeUpdate={onTimeUpdate}
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
                  className="h-7 max-w-[200px] truncate text-[12px]"
                  onClick={() => {
                    setActiveMedia(m.url);
                    setCurrentMs(0);
                  }}
                  title={m.file_name ?? undefined}
                >
                  {m.file_name ?? '课堂实录'}
                </Button>
              );
            })}
          </div>
        )}

        {hasMedia && !hasSegments && (
          <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-[13px] leading-5 text-muted-foreground">
            还没有逐句字幕。到「数据接入」点素材上的「识别为文稿」，或上传带{' '}
            <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">[08:12]</code> 行首时间码的转写文稿；文稿里标注{' '}
            <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">[教师] / [学生] / [齐声] / [媒体]</code>{' '}
            说话人时，字幕会按说话人分色显示。
          </div>
        )}

        {hasSegments && (
          <div
            ref={listRef}
            onScroll={onListScroll}
            className="max-h-[420px] space-y-px overflow-y-auto rounded-lg border border-border/60 bg-muted/20 p-1 [content-visibility:auto]"
          >
            {segments.map((seg, i) => {
              const on = i === currentSeg;
              return (
                <button
                  key={`${seg.s}-${i}`}
                  type="button"
                  data-seg={i}
                  onClick={() => seekToMs(seg.s, true)}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    on ? 'bg-primary/12' : 'hover:bg-muted/60'
                  }`}
                >
                  <span
                    className={`mt-px shrink-0 font-mono text-[11px] tabular-nums ${
                      on ? 'text-primary' : 'text-muted-foreground/70'
                    }`}
                  >
                    {msToClock(seg.s)}
                  </span>
                  {seg.speaker && (
                    <span
                      className={`mt-px inline-flex w-8 shrink-0 justify-center rounded px-1 py-px text-[10px] font-medium ring-1 ring-inset ${
                        SPEAKER_BADGE[seg.speaker] ?? 'bg-muted text-muted-foreground ring-border'
                      }`}
                    >
                      {seg.speaker}
                    </span>
                  )}
                  <span className={`min-w-0 text-[13px] leading-5 ${on ? 'font-medium' : 'text-foreground/85'}`}>
                    {seg.t}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
