'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError, analysisApi } from '@/lib/api/client';
import type { DimensionInterpretation } from '@/lib/evaluation/types';

// ============================================================
// 维度级 AI 解读（V1.17）：每个维度的评分下挂四段可展开长文——
// 依据/素材、为什么是这个分、如何解读、如何提升。
// 查看报告时按需生成（同一课例跨组件共享一次请求），生成后服务端已落库。
// ============================================================

/** 同一课例的生成请求去重：「融合分析」与「分析报告」两个面板同时挂载，只发一次 */
const inflight = new Map<string, Promise<DimensionInterpretation[]>>();

function ensureDimensionInterpretations(lessonId: string): Promise<DimensionInterpretation[]> {
  const hit = inflight.get(lessonId);
  if (hit) return hit;
  const p = analysisApi.generateInterpretations(lessonId).finally(() => {
    inflight.delete(lessonId);
  });
  inflight.set(lessonId, p);
  return p;
}

function friendlyError(e: unknown): string {
  const raw = e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e ?? '');
  if (/deepseek|json|timeout|超时|token|api[_-]?key|401|403|429|5\d\d/i.test(raw)) {
    return 'AI 服务暂时不可用，请稍后重试';
  }
  return raw || '解读生成失败，请稍后重试';
}

interface UseDimensionInterpretationsOpts {
  lessonId: string;
  /** 报告里已有的解读（旧报告缺省时按需补生成） */
  existing?: DimensionInterpretation[] | null;
  /** 报告生成时间：重新分析后旧解读作废，状态整体复位 */
  genKey: string;
  /** 是否允许按需生成：离线样例 / 关闭「AI 深度分析」的报告不生成 */
  enabled: boolean;
}

/** 取报告各维度的 AI 解读；缺失时自动（去重）调用一次生成接口 */
export function useDimensionInterpretations({
  lessonId,
  existing,
  genKey,
  enabled,
}: UseDimensionInterpretationsOpts) {
  const [items, setItems] = useState<DimensionInterpretation[] | null>(existing ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedKeyRef = useRef<string | null>(null);
  const existingRef = useRef(existing);
  // 渲染期写 ref 会触发 react-hooks/refs 报错；改为 effect 内同步，
  // 且必须声明在下方读取它的 effect 之前，保证同一提交内先写后读。
  useEffect(() => {
    existingRef.current = existing;
  }, [existing]);

  useEffect(() => {
    const own = existingRef.current ?? null;
    setItems(own);
    setError(null);
    if (own && own.length > 0) return;
    if (!enabled || !lessonId) return;
    const myKey = `${genKey}:${attempt}`;
    if (startedKeyRef.current === myKey) return;
    startedKeyRef.current = myKey;
    let cancelled = false;
    setLoading(true);
    ensureDimensionInterpretations(lessonId)
      .then((arr) => {
        if (cancelled) return;
        setItems(arr.length > 0 ? arr : null);
        if (arr.length === 0) setError('未生成解读内容');
      })
      .catch((e) => {
        if (!cancelled) setError(friendlyError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [genKey, attempt, enabled, lessonId]);

  const retry = () => setAttempt((a) => a + 1);
  return { items, loading, error, retry };
}

// ---------- 表一内涵观察点解读（V1.19）：认知/情感各一段四段长文 ----------
// 与五维解读同款按需生成（独立请求、独立去重），复用同一组件渲染。

const essenceInflight = new Map<string, Promise<DimensionInterpretation[]>>();

function ensureEssenceInterpretations(lessonId: string): Promise<DimensionInterpretation[]> {
  const hit = essenceInflight.get(lessonId);
  if (hit) return hit;
  const p = analysisApi.generateEssenceInterpretations(lessonId).finally(() => {
    essenceInflight.delete(lessonId);
  });
  essenceInflight.set(lessonId, p);
  return p;
}

interface UseEssenceInterpretationsOpts {
  lessonId: string;
  /** 报告里已有的内涵解读（旧报告缺省时按需补生成） */
  existing?: DimensionInterpretation[] | null;
  /** 报告生成时间：重新分析后旧解读作废，状态整体复位 */
  genKey: string;
  /** 是否允许按需生成：离线样例 / 关闭「AI 深度分析」的报告不生成 */
  enabled: boolean;
}

/** 取表一内涵（认知/情感）的 AI 解读；缺失时自动（去重）调用一次生成接口 */
export function useEssenceInterpretations({
  lessonId,
  existing,
  genKey,
  enabled,
}: UseEssenceInterpretationsOpts) {
  const [items, setItems] = useState<DimensionInterpretation[] | null>(existing ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const startedKeyRef = useRef<string | null>(null);
  const existingRef = useRef(existing);
  // 渲染期写 ref 会触发 react-hooks/refs 报错；改为 effect 内同步，
  // 且必须声明在下方读取它的 effect 之前，保证同一提交内先写后读。
  useEffect(() => {
    existingRef.current = existing;
  }, [existing]);

  useEffect(() => {
    const own = existingRef.current ?? null;
    setItems(own);
    setError(null);
    if (own && own.length > 0) return;
    if (!enabled || !lessonId) return;
    const myKey = `${genKey}:${attempt}`;
    if (startedKeyRef.current === myKey) return;
    startedKeyRef.current = myKey;
    let cancelled = false;
    setLoading(true);
    ensureEssenceInterpretations(lessonId)
      .then((arr) => {
        if (cancelled) return;
        setItems(arr.length > 0 ? arr : null);
        if (arr.length === 0) setError('未生成解读内容');
      })
      .catch((e) => {
        if (!cancelled) setError(friendlyError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [genKey, attempt, enabled, lessonId]);

  const retry = () => setAttempt((a) => a + 1);
  return { items, loading, error, retry };
}

function InterpSection({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-primary">{label}</div>
      <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-foreground/85">{text}</p>
    </div>
  );
}

interface BlockProps {
  interpretation?: DimensionInterpretation | null;
  /** 本课解读正在生成中（整课一次请求，所有维度共用状态） */
  loading: boolean;
  /** 整课生成失败的提示（所有维度共用） */
  error: string | null;
  onRetry: () => void;
}

/**
 * 单个维度下的 AI 解读折叠区。默认收起，展开后分四段；
 * 导出/打印时按钮被移除、内容强制展开（hidden 属性 + print:block）。
 */
export default function DimensionInterpretationBlock({
  interpretation,
  loading,
  error,
  onRetry,
}: BlockProps) {
  const [open, setOpen] = useState(false);

  if (interpretation) {
    return (
      <div className="mt-2 rounded-lg border border-primary/20 bg-primary/[0.04] print:break-inside-avoid">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="shrink-0">AI 解读</span>
            <span className="truncate font-normal text-muted-foreground">
              依据 · 为什么 · 怎么读 · 怎么提升
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-xs"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? '收起' : '展开'}
            <ChevronDown
              className={`ml-0.5 h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
            />
          </Button>
        </div>
        <div
          hidden={!open}
          className="print:block space-y-2.5 border-t border-primary/10 px-3 py-2.5"
        >
          <InterpSection label="评分依据与素材" text={interpretation.basis} />
          <InterpSection label="为什么这节课这个维度评这个分" text={interpretation.why} />
          <InterpSection label="如何解读这个分" text={interpretation.how_to_read} />
          <InterpSection label="如何提升这个维度" text={interpretation.how_to_improve} />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        AI 正在阅读材料并生成本维度解读，通常需要 10–40 秒，页面可先继续浏览…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        <span>维度解读暂未生成：{error}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 px-1.5 text-[11px]"
          onClick={onRetry}
        >
          <RefreshCw className="mr-1 h-3 w-3" />
          重试
        </Button>
      </div>
    );
  }

  return null;
}
