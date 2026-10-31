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
  /** 本站媒体代理地址（/api/media/:id），优先使用；为空时退回 url */
  play_url?: string | null;
}

/**
 * 优先走本站媒体代理。
 * 浏览器直连存储 CDN 时，连接耗时会在十几毫秒到十几秒之间随机跳，
 * 视频靠连续 range 请求边下边播，一次卡住整段就停在 0:00。
 */
const mediaSrc = (m: SourceMedia): string | null => m.play_url ?? m.url;

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
  /**
   * 播放位置只用来定位「当前是第几句」，本身不参与渲染。
   *
   * 之前把 currentTime 存进 state：`timeupdate` 每秒触发约 4 次，整份 268 段的字幕列表
   * 就跟着每秒全量 reconcile 四遍，播放时主线程被吃掉，页面点哪儿都发闷。
   * 现在把毫秒放进 ref，只在**跨句**时才 setState 一次，字幕列表的重绘频率从 4Hz 降到约 0.25Hz。
   */
  const currentMsRef = useRef(0);
  const currentSegRef = useRef(-1);
  const [currentSeg, setCurrentSeg] = useState(-1);

  const syncPosition = useCallback((ms: number) => {
    currentMsRef.current = ms;
    const segs = segmentsRef.current;
    let ans = -1;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].s <= ms) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (ans !== currentSegRef.current) {
      currentSegRef.current = ans;
      setCurrentSeg(ans);
    }
  }, []);
  const [mediaError, setMediaError] = useState<{ code: number; hint: string } | null>(null);

  /** 本次播放地址是否已自动重签重试过；防止坏文件导致无限重试 */
  const autoRetriedRef = useRef(false);

  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef(false);
  const programmaticRef = useRef(false);
  const lockTimerRef = useRef<number | null>(null);
  /** 字幕段落的 ref 镜像：定位计算在 timeupdate 回调里同步跑，不能等 state 更新后再读 */
  const segmentsRef = useRef<TimelineSegment[]>([]);

  const applyPayload = useCallback((payload: TimelinePayload) => {
    setData(payload);
    const first =
      payload.videos.find((v) => mediaSrc(v)) ?? payload.audios.find((a) => mediaSrc(a)) ?? null;
    setActiveMedia(first ? mediaSrc(first) : null);
    setMediaError(null);
  }, []);

  // 统一走 api 客户端：附带 x-session，否则服务端 401「请先登录」
  const loadTimeline = useCallback(async () => {
    const payload = await api.get<TimelinePayload>(`/api/lessons/${lessonId}/timeline`);
    applyPayload(payload);
    return payload;
  }, [lessonId, applyPayload]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        autoRetriedRef.current = false;
        await loadTimeline();
      } catch (e) {
        if (!cancelled) setError(friendlyError(e, '课堂播放器加载失败'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTimeline]);

  const seekToMs = useCallback((ms: number, autoplay: boolean) => {
    const el = mediaRef.current;
    if (!el) return;
    const sec = Math.max(0, ms / 1000);
    // 同一位置只补播放：不必要的 currentTime 赋值会触发 timeupdate 抖动，字幕跟着跳
    if (Math.abs(el.currentTime - sec) > 0.05) el.currentTime = sec;
    if (autoplay) void el.play().catch(() => {});
    syncPosition(ms);
    // 显式跳转（点字幕/点证据）不算用户滚动，恢复自动跟随
    scrollLockRef.current = false;
  }, [syncPosition]);

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
    // 播放中每秒触发约 4 次；只有跨到另一句才会 setState，其余更新都停在 ref 里
    if (el) syncPosition(el.currentTime * 1000);
  }, [syncPosition]);

  /**
   * 播放失败兜底。
   *
   * 黑屏不出声是最难排查的故障：签名过期、取流 5xx、对象缺失，在界面上长得一模一样。
   * 这里把浏览器暴露的 MediaError.code 翻成人话，并先自动换一份新签名重试一次——
   * 「签名过期」和「取流瞬时失败」这两类都能被这一步吃掉，用户无感。
   */
  const onMediaError = useCallback(async () => {
    const el = mediaRef.current;
    const code = el && 'error' in el && el.error ? el.error.code : 0;
    if (!autoRetriedRef.current) {
      autoRetriedRef.current = true;
      try {
        await loadTimeline();
        return;
      } catch {
        // 重签也失败，继续走下面的提示
      }
    }
    const HINT: Record<number, string> = {
      1: '播放被中断，请重新加载',
      2: '网络中断，无法继续加载',
      3: '文件解码失败，可能已损坏',
      4: '播放地址暂时不可用（取流失败，或文件已不在存储中）',
    };
    const base = HINT[code] ?? '未知播放错误';
    // 浏览器只肯给一个 MediaError.code，真正的 403/404/502 藏在后端响应体里。
    // 补一次探测请求把服务端的话术取回来，否则界面上只有「错误码 4」，等于没线索。
    let detail = '';
    if (activeMedia) {
      try {
        const res = await fetch(activeMedia, {
          method: 'GET',
          headers: { Range: 'bytes=0-1' },
          cache: 'no-store',
        });
        if (!res.ok) {
          const text = (await res.text()).slice(0, 120).trim();
          detail = text ? `状态 ${res.status}：${text}` : `状态 ${res.status}`;
        }
      } catch {
        // 探测本身也失败就不追加，保留基础提示，不掩盖原错误
      }
    }
    setMediaError({ code, hint: detail ? `${base}（${detail}）` : base });
  }, [loadTimeline, activeMedia]);

  /** 手动重新加载：重置自动重试额度后再拉一次新签名 */
  const manualReload = useCallback(async () => {
    autoRetriedRef.current = false;
    setMediaError(null);
    try {
      await loadTimeline();
    } catch (e) {
      setMediaError({ code: 0, hint: friendlyError(e, '重新获取播放地址失败') });
    }
  }, [loadTimeline]);

  // 固定数组引用：data?.segments ?? [] 每次 render 都新建空数组，
  // 引用变化会让下游依赖 segments 的 memo/useEffect 失效
  const segments = useMemo(() => data?.segments ?? [], [data]);
  segmentsRef.current = segments;

  // 换片源/重新加载后重算当前句，避免上一个媒体的高亮残留在不存在的段号上
  useEffect(() => {
    currentSegRef.current = -1;
    currentMsRef.current = 0;
    setCurrentSeg(-1);
  }, [activeMedia]);

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
  const mediaList = [...(data?.videos ?? []), ...(data?.audios ?? [])].filter((m) => mediaSrc(m));
  // 有媒体记录但一个都签不出 URL（存储凭证/对象缺失）：不能当成「没传过」误导用户
  const mediaCount = (data?.videos?.length ?? 0) + (data?.audios?.length ?? 0);
  const mediaSignBroken = !hasMedia && mediaCount > 0;
  const isVideo = (data?.videos ?? []).some((v) => mediaSrc(v) === activeMedia);

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
                key={activeMedia ?? 'none'}
                ref={(el) => {
                  mediaRef.current = el;
                }}
                src={activeMedia ?? undefined}
                controls
                playsInline
                onTimeUpdate={onTimeUpdate}
                onError={() => void onMediaError()}
                className="aspect-video w-full bg-black"
              />
            ) : (
              <div className="flex items-center gap-3 bg-card px-4 py-5">
                <Volume2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                <audio
                  key={activeMedia ?? 'none'}
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  src={activeMedia ?? undefined}
                  controls
                  onTimeUpdate={onTimeUpdate}
                  onError={() => void onMediaError()}
                  className="w-full"
                />
              </div>
            )}
          </div>
        )}

        {mediaError && (
          <div className="flex flex-wrap items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[13px] leading-5 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">
              {mediaError.hint}
              {mediaError.code > 0 && (
                <span className="text-muted-foreground">（错误码 {mediaError.code}）</span>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[12px]"
              onClick={() => void manualReload()}
            >
              重新加载
            </Button>
          </div>
        )}

        {mediaList.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {mediaList.map((m) => {
              const on = mediaSrc(m) === activeMedia;
              return (
                <Button
                  key={m.id}
                  type="button"
                  size="sm"
                  variant={on ? 'secondary' : 'ghost'}
                  className="h-7 max-w-[200px] truncate text-[12px]"
                  onClick={() => {
                    // 位置重置交给上面的 [activeMedia] effect，避免这里重复 setState
                    setActiveMedia(mediaSrc(m));
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
