'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { analysisApi, ApiError, type StoredReport } from '@/lib/api/client';
import { DEFAULT_SOURCE_WEIGHTS, type ManualCalibration } from '@/lib/evaluation/types';

export interface AnalysisRunner {
  report: StoredReport | null;
  loading: boolean;
  running: boolean;
  phase: string | null;
  error: string | null;
  useLlm: boolean;
  setUseLlm: (v: boolean) => void;
  lessonType: string | null;
  setLessonType: (t: string | null) => void;
  run: (opts?: { calibrations?: ManualCalibration[] }) => Promise<void>;
  cancelRun: () => void;
}

/** 客户端兜底脱敏：任何混入技术细节（Key/状态码/堆栈词/浏览器原生 Abort 文案）的错误都替换为友好中文提示。 */
function safeError(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/api[_-]?key|deepseek|401|403|429|5\d\d|timeout|超时|json|fetch|undefined|stack|网络|abort|signal|domexception/i.test(raw)) {
    return fallback;
  }
  return raw || fallback;
}

/** 浏览器原生 AbortError 的 message 为英文（signal is aborted without reason），不能直接上屏。 */
function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { name?: unknown; message?: unknown };
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  return typeof err.message === 'string' && /abort/i.test(err.message);
}

/**
 * 分析运行器（V1.20 全局化）：运行/取消、AI 深度分析开关、课型、报告加载与阶段进度的唯一状态源。
 * 挂在课例详情页顶层——全局控制条（视频上方）与融合分析面板共享同一实例，
 * 避免「按钮在融合分析板块里、但操作的是全局数据」的错位。
 */
export function useAnalysisRunner(opts: {
  lessonId: string;
  onUnauthorized: () => void;
  onReportChange: (report: StoredReport | null) => void;
}): AnalysisRunner {
  const { lessonId, onUnauthorized, onReportChange } = opts;
  const [report, setReport] = useState<StoredReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useLlm, setUseLlm] = useState(true);
  const [lessonType, setLessonType] = useState<string | null>(null);
  // P0-3：分阶段进度提示 + 可取消。abortRef 持有当前分析请求的 AbortController。
  const [phase, setPhase] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await analysisApi.get(lessonId);
      setReport(r);
      onReportChange(r ?? null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      setError(e instanceof Error ? safeError(e, '加载报告失败，请刷新页面重试。') : '加载报告失败，请刷新页面重试。');
    } finally {
      setLoading(false);
    }
  }, [lessonId, onUnauthorized, onReportChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(runOpts?: { calibrations?: ManualCalibration[] }) {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    // 分阶段提示：先读材料，再（可选）等待 AI，最后融合出报告，消除「点了没反应」的焦虑。
    setPhase('正在读取课堂材料…');
    const phaseTimer = window.setTimeout(() => {
      if (useLlm) setPhase('AI 正在阅读材料并逐项评分，通常需要 20–60 秒，请稍候…');
      else setPhase('正在综合多源材料完成评分…');
    }, 1200);
    try {
      const r = await analysisApi.run(
        lessonId,
        {
          source_weights: { ...DEFAULT_SOURCE_WEIGHTS },
          calibrations: runOpts?.calibrations ?? [],
          use_llm: useLlm,
          lesson_type: lessonType,
        },
        { signal: controller.signal },
      );
      setReport(r);
      onReportChange(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      if (controller.signal.aborted) {
        // 用户主动取消：不作为错误，保留上一次报告。
        setError(null);
      } else if (isAbortError(e)) {
        // 非用户取消的中断（页面刷新/切走、浏览器或网关中断长请求）：
        // 浏览器原生文案是英文「signal is aborted without reason」，不能直接上屏。
        console.warn('[analysis] 请求被中断', e);
        setError('本次分析请求被中断（可能是页面刷新/切换或网络波动），报告仍是上一次结果，请重新运行分析。');
      } else if (e instanceof ApiError && e.status === 422) {
        setError(safeError(e, '暂无可分析的材料，请先在「数据接入」粘贴转写文稿/观察记录，或完成人工标注。'));
      } else {
        setError(safeError(e, '分析失败，请稍后重试；若长时间无响应可取消后关闭「AI 深度分析」再试。'));
      }
    } finally {
      window.clearTimeout(phaseTimer);
      abortRef.current = null;
      setRunning(false);
      setPhase(null);
    }
  }

  function cancelRun() {
    abortRef.current?.abort();
  }

  return {
    report,
    loading,
    running,
    phase,
    error,
    useLlm,
    setUseLlm,
    lessonType,
    setLessonType,
    run,
    cancelRun,
  };
}
