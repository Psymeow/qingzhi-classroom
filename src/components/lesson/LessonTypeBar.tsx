'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ScanSearch, Wand2, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ApiError,
  lessonTypeApi,
  type LessonTypeDetection,
  type LessonTypeInfo,
} from '@/lib/api/client';

interface Props {
  lessonId: string;
  onUnauthorized: () => void;
  /** 当前生效课型变化（选择或识别成功）时通知父组件，作为分析运行参数 */
  onChange?: (lessonType: string | null) => void;
  /** 初始课型（来自课例详情），避免与接口不一致 */
  initialType?: string | null;
}

const NONE_VALUE = '__none__';

/**
 * 各课型的情感主线与首选教学行为（对应 behavior-library 中的行为名称）。
 * 选中课型时补一句提示，让教师知道「这个课型差异在哪、先从哪几个做法入手」。
 */
const TYPE_HINT: Record<string, string> = {
  new: '好奇→成就 · 首选 认知冲突情境、梯度问题链、结构化小组合作',
  review: '自主→掌控 · 首选 结构化反思引导、变式题组、分层任务',
  comment: '反思→优化 · 容错需求最高 · 首选 错误资源化、依据性追问、容错氛围营造',
  practice: '应用→创造 · 首选 真实问题锚定、结构化小组合作、同伴情感支持',
  topic: '困惑→贯通 · 首选 驱动性主问题、梯度问题链、困境中的韧性护航',
};

function confColor(c: number): string {
  if (c >= 0.75) return 'text-emerald-600';
  if (c >= 0.5) return 'text-amber-600';
  return 'text-orange-600';
}

export default function LessonTypeBar({ lessonId, onUnauthorized, onChange, initialType }: Props) {
  const [info, setInfo] = useState<LessonTypeInfo | null>(null);
  const [value, setValue] = useState<string | null>(initialType ?? null);
  const [detecting, setDetecting] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [detection, setDetection] = useState<LessonTypeDetection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    lessonTypeApi
      .get(lessonId)
      .then((d) => {
        if (!alive) return;
        setInfo(d);
        const cur = initialType ?? d.lesson_type;
        setValue(cur);
        onChange?.(cur);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) onUnauthorized();
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  const applyType = useCallback(
    (next: string | null, opts: { persist?: boolean } = {}) => {
      setValue(next);
      onChange?.(next);
      if (!opts.persist) return;
      setSavingType(true);
      lessonTypeApi
        .set(lessonId, next)
        .catch((e) => {
          if (e instanceof ApiError && e.status === 401) {
            onUnauthorized();
            return;
          }
          setError(e instanceof Error ? e.message : '保存课型失败');
        })
        .finally(() => setSavingType(false));
    },
    [lessonId, onChange, onUnauthorized],
  );

  async function detect(apply: boolean) {
    setDetecting(true);
    setError(null);
    try {
      const r = await lessonTypeApi.detect(lessonId, apply);
      setDetection(r.detection);
      if (apply) applyType(r.detection.lesson_type);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      setError(e instanceof Error ? e.message : '课型识别失败');
    } finally {
      setDetecting(false);
    }
  }

  const statOf = (code: string) => info?.stats.find((s) => s.code === code);

  return (
    <div className="space-y-2 rounded-xl border border-primary/15 bg-primary/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">课型</span>
        <Select
          value={value ?? NONE_VALUE}
          onValueChange={(v) => applyType(v === NONE_VALUE ? null : v, { persist: true })}
          disabled={savingType}
        >
          <SelectTrigger size="sm" className="h-8 w-36 text-xs">
            <SelectValue placeholder="选择课型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>未指定课型</SelectItem>
            {info?.options.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
                {statOf(o.value) ? `（${statOf(o.value)?.points} 要点）` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => detect(false)}
                disabled={detecting}
              >
                {detecting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="mr-1.5 h-3.5 w-3.5" />}
                AI 识别
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              依据课堂实际发生的学习活动，判定最接近的课型；识别后可选择应用到本课例。
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {savingType && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {/* 选中课型后追加一句情感主线 + 首选行为，让选择有依据；
            未选课型时不显示；文案允许换行，不固定宽度，避免窄屏溢出 */}
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {value
            ? `按「${info?.options.find((o) => o.value === value)?.label ?? value}」加载专属要点集参与 AI 评分`
            : '未指定课型时只输出通用五维评分，不输出课型要点评价'}
          {value && TYPE_HINT[value] && (
            <span className="text-muted-foreground/70">· {TYPE_HINT[value]}</span>
          )}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {detection && (
        <div className="rounded-lg border border-primary/20 bg-background/70 px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Wand2 className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium text-foreground">
              AI 判定为「{detection.lesson_type_name}」
            </span>
            <Badge variant="secondary" className={`gap-1 ${confColor(detection.confidence)}`}>
              {detection.confidence >= 0.5 ? <CheckCircle2 className="h-3 w-3" /> : <Info className="h-3 w-3" />}
              置信度 {(detection.confidence * 100).toFixed(0)}%
            </Badge>
            <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => applyType(detection.lesson_type, { persist: true })}>
              采用该课型
            </Button>
          </div>
          <p className="mt-1.5 leading-relaxed text-muted-foreground">{detection.basis}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[...detection.candidates]
              .sort((a, b) => b.score - a.score)
              .map((c) => (
                <span
                  key={c.code}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    c.code === detection.lesson_type ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {info?.options.find((o) => o.value === c.code)?.label ?? c.code} {(c.score * 100).toFixed(0)}%
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
