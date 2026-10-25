import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * 数据区域四态（loading / empty / error / success）的公共呈现组件。
 * 只负责状态呈现，不涉及任何数据流；错误文案遵循「发生了什么 + 为什么 + 现在能干什么」。
 */

/**
 * 错误文案脱敏：老师看不懂技术细节（500/401/failed…）。
 * 消息里含技术特征时改用友好兜底文案；含足够中文说明时才原样展示。
 */
export function friendlyError(raw: unknown, fallback: string): string {
  const msg = (raw instanceof Error ? raw.message : String(raw ?? '')).trim();
  if (!msg) return fallback;
  const hasTech = /\b[45]\d{2}\b|status|failed|fetch|http|请求失败|服务器错误/i.test(msg);
  const chinese = msg.match(/[一-龥]/g)?.length ?? 0;
  if (hasTech && chinese < 8) return fallback;
  if (chinese >= 4) return msg;
  return fallback;
}

/** 课例列表 loading：骨架屏（结构与真实卡片一致），不是转圈圈 */
export function LessonListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">正在加载课例列表…</span>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-2xl border border-border/80 bg-card p-5 shadow-card"
            aria-hidden
          >
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 w-2/3 rounded" />
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2">
              <Skeleton className="h-3 rounded" />
              <Skeleton className="h-3 rounded" />
              <Skeleton className="h-3 rounded" />
              <Skeleton className="h-3 rounded" />
            </div>
            <div className="mt-4 border-t border-border/60 pt-3.5">
              <Skeleton className="h-3 w-1/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 课例详情 loading：页头 + 信息卡骨架 */
export function LessonDetailSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">正在加载课例…</span>
      <div className="space-y-2.5" aria-hidden>
        <Skeleton className="h-7 w-64 rounded" />
        <Skeleton className="h-4 w-80 max-w-full rounded" />
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-card" aria-hidden>
        <Skeleton className="h-4 w-32 rounded" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16 rounded" />
              <Skeleton className="h-4 w-28 rounded" />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-6 shadow-card" aria-hidden>
        <Skeleton className="h-4 w-40 rounded" />
        <Skeleton className="mt-4 h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** 局部区块 loading：小骨架，替代转圈圈 */
export function BlockSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-live="polite" className={`space-y-3 ${className ?? ''}`}>
      <span className="sr-only">正在加载…</span>
      <Skeleton className="h-4 w-40 rounded" aria-hidden />
      <Skeleton className="h-20 w-full rounded-xl" aria-hidden />
    </div>
  );
}

/**
 * 错误态：原因一句话 + 重试按钮（可选附返回等次级操作）。
 * title=发生了什么；reason=为什么；按钮=现在能干什么。
 */
export function ErrorPanel({
  title,
  reason,
  onRetry,
  retryLabel = '重新加载',
  children,
}: {
  title: string;
  reason: string;
  onRetry?: () => void;
  retryLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-destructive">{title}</p>
          <p className="mt-1 text-sm leading-relaxed text-destructive/90">{reason}</p>
          {(onRetry || children) && (
            <div className="mt-3.5 flex flex-wrap items-center gap-2">
              {onRetry && (
                <Button size="sm" variant="outline" onClick={onRetry}>
                  <RefreshCw className="h-4 w-4" />
                  {retryLabel}
                </Button>
              )}
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
