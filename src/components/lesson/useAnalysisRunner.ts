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

/** 客户端兜底脱敏：任何混入技术细节（Key/状态码/堆栈词/浏览器原生 Abort 文案）的错误替换为友好中文提示。 */
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
 * 本页自己触发的分析硬超时。用专属 name 与浏览器原生 TimeoutError 区分：
 * 后者会被 isAbortError 归入「中断」，而这里要给出更准确的超时说明。
 */
class AnalysisTimeoutError extends Error {
  constructor() {
    super("analysis run timed out");
    this.name = 'AnalysisTimeoutError';
  }
}

/**
 * 后台回连（V1.30）
 *
 * 分析跑在服务端，浏览器只是发了个 POST。用户点完「重新运行分析」就退回上一页时，
 * 那个请求在后台继续、报告照样落库；但再进这节课时页面只 GET 一次报告，
 * 拿到的还是旧结果，而且不会自己刷新——表现为「好像没有重新运行分析」。
 *
 * 解法：发起分析时把「起跑时间 + 起跑时的报告指纹」写进 localStorage；
 * 进入页面时若发现未结算的标记，就轮询报告直到指纹变化（新结果已落库）再渲染。
 * 不需要服务端新增状态：每次重新运行都会刷新报告的 updated_at，天然就是结算信号。
 */
/** at 是标记写入时刻（毫秒）；旧格式可能缺失，读取时按立即过期处理 */
type PendingRun = { startedAt: number; before: string; at?: number };

/** 平台函数 maxDuration = 60s，再留 40s 余量：超过这个窗口还没结果就认为后台没跑成 */
/**
 * 本次分析请求的硬超时（毫秒）。
 * 服务端 maxDuration=60s、LLM 阶段上限 55s；fetch 侧另配 90s（见 analysisApi.run）。
 * 这里再留 5s 余量作为兜底：正常由 fetch 先触发，只有 fetch 也失灵（如连接不返回、
 * AbortSignal 不生效）时才走到这里——它的职责是保证 running/phase/pending 一定能复位。
 */
const RUN_HARD_TIMEOUT_MS = 95_000;

/** 标记写入后超过这个时长视为陈旧（本次分析早已结束或从未成功启动），直接跳过恢复 */
const PENDING_MAX_AGE_MS = 10 * 60_000;

/** 轮询读取连续失败次数上限：约 5 次 × 2s = 10s 内全失败即认定接口不可用，提前退出 */
const PENDING_MAX_CONSECUTIVE_FAILURES = 5;

const PENDING_TIMEOUT_MS = 100_000;
const PENDING_POLL_MS = 2000;

const pendingKey = (lessonId: string) => `qz-analysis-pending:${lessonId}`;

/** 报告指纹：同一课例的报告是同一条记录（id 不变），靠 updated_at / 总分判断是否被重新运行覆盖 */
function fpOf(r: StoredReport | null): string {
  if (!r) return 'none';
  return `${r.id}|${r.updated_at ?? r.created_at ?? ''}|${r.total_score}`;
}

function readPending(lessonId: string): PendingRun | null {
  try {
    const raw = window.localStorage.getItem(pendingKey(lessonId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingRun>;
    if (typeof v.startedAt !== 'number' || typeof v.before !== 'string') return null;
    // 标记带写入时刻：超过 PENDING_MAX_AGE_MS 视为陈旧，直接作废。
    // 旧格式可能只有 startedAt / 没有 at，此时按立即过期处理——宁可少等一轮，也不空转 100s。
    const at = typeof v.at === 'number' ? v.at : null;
    if (at === null || Date.now() - at > PENDING_MAX_AGE_MS) {
      clearPending(lessonId);
      return null;
    }
    return { startedAt: v.startedAt, before: v.before, at };
  } catch {
    // 隐私模式或存储被禁用：退回「无回连」，不影响分析本身
    return null;
  }
}

function writePending(lessonId: string, before: string) {
  try {
    window.localStorage.setItem(
      pendingKey(lessonId),
      JSON.stringify({ startedAt: Date.now(), before, at: Date.now() }),
    );
  } catch {
    /* 同上：写不进去就当没有回连 */
  }
}

function clearPending(lessonId: string) {
  try {
    window.localStorage.removeItem(pendingKey(lessonId));
  } catch {
    /* 同上 */
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  // 同步一份最新报告，供「起跑时记指纹」读取（state 闭包可能滞后一次渲染）
  const reportRef = useRef<StoredReport | null>(null);
  reportRef.current = report;

  // 回调放进 ref 而不进依赖：调用方（页面）可能传入内联函数，一旦写进 useCallback
  // 依赖，父组件每次渲染都会重建 load → useEffect 重跑 → 又调 onReportChange →
  // 父组件再次渲染，形成无限循环（曾导致「分析报告」标签反复闪烁、接口被刷）。
  const onUnauthorizedRef = useRef(onUnauthorized);
  const onReportChangeRef = useRef(onReportChange);
  onUnauthorizedRef.current = onUnauthorized;
  onReportChangeRef.current = onReportChange;

  const load = useCallback(async (): Promise<StoredReport | null> => {
    try {
      const r = await analysisApi.get(lessonId);
      setReport(r);
      onReportChangeRef.current(r ?? null);
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorizedRef.current();
        return null;
      }
      setError(e instanceof Error ? safeError(e, '加载报告失败，请刷新页面重试。') : '加载报告失败，请刷新页面重试。');
      return null;
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  /** 退出页面再进来时接上「后台还在跑」的分析：轮询到新结果落库为止，超时则如实提示。 */
  const resumePending = useCallback(
    async (pending: PendingRun, isCancelled: () => boolean) => {
      setPhase('上一次分析仍在后台进行，正在等待结果…');
      const deadline = pending.startedAt + PENDING_TIMEOUT_MS;
      // 连续读取失败也要退出：接口持续 404/500 时，继续空转只是把 100s 白白等满。
      let consecutiveFailures = 0;
      try {
        while (Date.now() < deadline) {
          await sleep(PENDING_POLL_MS);
          if (isCancelled()) return;
          let next: StoredReport | null = null;
          try {
            next = await analysisApi.get(lessonId);
            consecutiveFailures = 0;
          } catch {
            // 网络抖动可容忍，但连续失败说明报告接口本身有问题，不再空转
            consecutiveFailures += 1;
            if (consecutiveFailures >= PENDING_MAX_CONSECUTIVE_FAILURES) {
              setError('报告读取连续失败，已停止等待；请稍后刷新页面查看结果。');
              return;
            }
            continue;
          }
          if (isCancelled()) return;
          if (fpOf(next) !== pending.before) {
            setReport(next);
            onReportChangeRef.current(next ?? null);
            return;
          }
        }
        // 预期内没等到：后台多半已经超时或失败。清掉标记并说明，避免每次进来都白等一轮。
        setError('上一次分析在后台没有完成，报告仍是上一次的结果；如需最新结果请重新运行分析。');
      } finally {
        clearPending(lessonId);
        if (!isCancelled()) setPhase(null);
      }
    },
    [lessonId],
  );

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void (async () => {
      const current = await load();
      if (cancelled) return;
      const pending = readPending(lessonId);
      if (!pending) return;
      // 本页就是发起方时不会走到这里（run 收尾时已清标记）；
      // 走到这里说明是「退出后重新进入」或换了标签页/设备。
      // 指纹已经变了说明那次跑完了（当前拿到的就是新结果），标记直接清掉。
      if (fpOf(current) !== pending.before || Date.now() - pending.startedAt > PENDING_TIMEOUT_MS) {
        clearPending(lessonId);
        return;
      }
      await resumePending(pending, isCancelled);
    })();
    return () => {
      cancelled = true;
    };
  }, [load, lessonId, resumePending]);

  // 标签页重新可见时对齐一次服务端状态。不置 loading，避免切回页面闪一下骨架屏。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // 本页正在跑分析时由 run() 自己负责结果，不要用旧报告把进行中的状态盖掉
      if (running) return;
      void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load, running]);

  async function run(runOpts?: { calibrations?: ManualCalibration[] }) {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    // 起跑前记下当前报告指纹：退出页面再进来时，用它判断后台那次跑完了没有
    writePending(lessonId, fpOf(reportRef.current));
    // 分阶段提示：先读材料，再（可选）等待 AI，最后融合出报告，消除「点了没反应」的焦虑。
    setPhase('正在读取课堂材料…');
    const phaseTimer = window.setTimeout(() => {
      if (useLlm) setPhase('AI 正在阅读材料并逐项评分，通常需要 20–60 秒，请稍候…');
      else setPhase('正在综合多源材料完成评分…');
    }, 1200);
    try {
      // 硬超时兜底：fetch 侧已有 90s，这里 95s 再兜一层。若请求永不返回（连接未关闭、
      // AbortSignal 不生效等），必须由这里主动 abort 并抛错，否则 running 永久为 true，
      // 按钮锁死在「取消」态、进度条永久转、pending 标记同步残留。
      let timer: number | undefined;
      const r = await Promise.race([
        analysisApi.run(
          lessonId,
          {
            source_weights: { ...DEFAULT_SOURCE_WEIGHTS },
            calibrations: runOpts?.calibrations ?? [],
            use_llm: useLlm,
            lesson_type: lessonType,
          },
          { signal: controller.signal },
        ),
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => {
            controller.abort();
            reject(new AnalysisTimeoutError());
          }, RUN_HARD_TIMEOUT_MS);
        }),
      ]).finally(() => window.clearTimeout(timer));
      setReport(r);
      onReportChange(r);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized();
        return;
      }
      if (e instanceof AnalysisTimeoutError) {
        // fetch 与本页兜底都没能在窗口内拿到结果：服务端可能仍在处理。
        console.warn('[analysis] 请求超时未返回', e);
        setError(
          '本次分析超时未返回。服务器可能仍在处理，请刷新页面查看结果；若报告已更新可直接查看，未更新可稍后再试。',
        );
      } else if (controller.signal.aborted) {
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
      // 本次请求已结算（成功/失败/取消都算），后台回连标记随之作废
      clearPending(lessonId);
      setRunning(false);
      setPhase(null);
    }
  }

  function cancelRun() {
    // 取消是用户主动行为：标记不应残留，否则下次进页面会去空等一次已放弃的分析。
    abortRef.current?.abort();
    clearPending(lessonId);
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
