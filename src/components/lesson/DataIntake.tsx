'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Loader2,
  UploadCloud,
  FileText,
  FileUp,
  Trash2,
  Download,
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertCircle,
  PenLine,
  Video,
  Users,
} from 'lucide-react';
import {
  assetsApi,
  inputsApi,
  ApiError,
  type Asset,
  type UploadProgress,
} from '@/lib/api/client';
import {
  UPLOADABLE_KINDS,
  ASSET_KIND_LABEL,
  ASSET_KIND_HINT,
  ASSET_ACCEPT,
  ASSET_MAX_HINT,
  validateAssetFile,
  isPlainTextTranscriptFile,
  normalizeTranscriptText,
  type AssetKind,
} from '@/lib/lesson/assets';
import {
  LOCATE_EVENT,
  locateQuote,
  setSourceText,
  type LocateDetail,
  type LocateSource,
} from '@/lib/report/locate';

const PARSE_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: '待解析', cls: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200' },
  parsed: { label: '已解析', cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  failed: { label: '解析失败', cls: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200' },
  skipped: { label: '无需解析', cls: 'bg-muted text-muted-foreground ring-1 ring-inset ring-border' },
};

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 上传卡片：音视频走「ASR 识别为课堂文稿」，其余走「文档解析为文本」。 */
function isAvMedia(kind: AssetKind): boolean {
  return kind === 'av_video' || kind === 'av_audio';
}

export default function DataIntake({ lessonId, onUnauthorized }: { lessonId: string; onUnauthorized: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingKind, setUploadingKind] = useState<AssetKind | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptFileRef = useRef<HTMLInputElement | null>(null);
  const activeKindRef = useRef<AssetKind | null>(null);

  // 文本输入
  const [transcript, setTranscript] = useState('');
  const [observerText, setObserverText] = useState('');
  const [taskSheetText, setTaskSheetText] = useState('');
  const [textLoaded, setTextLoaded] = useState(false);
  const [parsingId, setParsingId] = useState<string | null>(null);
  // 音视频 ASR：识别中的素材 id + 结果提示（成功后写入下方「课堂转写文稿」框）
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [transcribeNotice, setTranscribeNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // parseFail：记录最近一个解析失败的素材，用于就地给出「重试 / 改用手工粘贴」恢复路径。
  const [parseFail, setParseFail] = useState<{ id: string; kind: AssetKind; name: string } | null>(null);
  // 转写文稿「上传文稿」：纯文本浏览器端就地读入；Word/PDF 走素材上传 + 服务端解析
  const [importingTranscript, setImportingTranscript] = useState(false);
  // V1.19 AI 标注说话人：转写文稿逐行标注教师/学生/齐声/媒体（长文稿需数十秒）
  const [labeling, setLabeling] = useState(false);
  const [labelNotice, setLabelNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // V1.19 同类素材重复上传：以最新为准——确认后先传新文件，再自动删除旧素材
  const [overwritePending, setOverwritePending] = useState<{ kind: AssetKind; file: File; olds: Asset[] } | null>(null);
  // 上传进度（字节 + 阶段）：进度条给用户等待预期；同一时刻仅一个上传在进行
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [importNotice, setImportNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P0-6：三段文本的最新值始终同步到 ref，防抖定时器回调读 ref，
  // 避免「onChange 当次渲染里调用的 scheduleSave 仍是旧闭包、读到空串」导致的假保存。
  const textsRef = useRef({ transcript: '', observer_text: '', task_sheet_text: '' });
  // 是否已发生过用户编辑：防止挂载回填的异步结果晚于用户输入而覆盖其内容。
  const dirtyRef = useRef(false);
  const transcriptAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const observerAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const taskSheetAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // P1-1：从报告证据跳回原文时的定位反馈
  const [locateHint, setLocateHint] = useState<{ ok: boolean; text: string } | null>(null);
  const locateHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleAuth = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.status === 401) onUnauthorized();
    },
    [onUnauthorized],
  );

  // 维护模块级原文缓存（供报告侧计算证据时间戳等只读用途）
  useEffect(() => {
    setSourceText('av_transcript', transcript);
    setSourceText('observer_note', observerText);
    setSourceText('task_sheet', taskSheetText);
  }, [transcript, observerText, taskSheetText]);

  useEffect(() => {
    const SOURCE_FIELD: Record<LocateSource, { label: string; area: () => HTMLTextAreaElement | null; text: () => string }> = {
      av_transcript: { label: '课堂转写文稿', area: () => transcriptAreaRef.current, text: () => textsRef.current.transcript },
      observer_note: { label: '观察员记录', area: () => observerAreaRef.current, text: () => textsRef.current.observer_text },
      task_sheet: { label: '学生任务单', area: () => taskSheetAreaRef.current, text: () => textsRef.current.task_sheet_text },
      lesson_plan: { label: '教学设计（教案）', area: () => null, text: () => '' },
      manual_annotation: { label: '人工标注', area: () => null, text: () => '' },
    };

    const flashHint = (ok: boolean, text: string) => {
      setLocateHint({ ok, text });
      if (locateHintTimer.current) clearTimeout(locateHintTimer.current);
      locateHintTimer.current = setTimeout(() => setLocateHint(null), 4000);
    };

    const handler = (e: Event) => {
      const { source, quote } = (e as CustomEvent<LocateDetail>).detail;
      const spec = SOURCE_FIELD[source];
      if (source === 'manual_annotation') {
        document.getElementById('annotation-workbench')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        flashHint(true, '该证据来自人工标注，已为你定位到标注工作台。');
        return;
      }
      const area = spec.area();
      const text = spec.text();
      if (!area) return;
      const found = locateQuote(text, quote);
      area.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (found) {
        try {
          area.focus({ preventScroll: true });
          area.setSelectionRange(found.start, found.end);
          if (highlightTimer.current) clearTimeout(highlightTimer.current);
          highlightTimer.current = setTimeout(() => {
            try {
              area.setSelectionRange(area.selectionStart ?? 0, area.selectionStart ?? 0);
            } catch {
              /* noop */
            }
          }, 6000);
        } catch {
          /* 部分 WebView 不支持选区，滚动到位即可 */
        }
        flashHint(true, `已在「${spec.label}」中定位到这条证据的原文位置。`);
      } else {
        flashHint(false, `已跳转到「${spec.label}」，但未匹配到完全一致的原文（可能在分析后被修改），请人工核对。`);
      }
    };

    window.addEventListener(LOCATE_EVENT, handler);
    return () => {
      window.removeEventListener(LOCATE_EVENT, handler);
      if (locateHintTimer.current) clearTimeout(locateHintTimer.current);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
    // refs + textsRef 在整个组件生命周期稳定可用
  }, []);

  const loadAssets = useCallback(async () => {
    try {
      const list = await assetsApi.list(lessonId);
      setAssets(list);
      setListError(null);
    } catch (e) {
      handleAuth(e);
      setListError(e instanceof Error ? e.message : '素材加载失败');
    } finally {
      setLoading(false);
    }
  }, [lessonId, handleAuth]);

  useEffect(() => {
    let cancelled = false;
    loadAssets();
    // 回填带重试：刷新/冷启动会话恢复空窗可能让首次 inputs GET 失败，
    // 不能因此让已保存文本永久显示为空（曾表现为「已保存、刷新后丢失」）。
    const backfill = async (attempt = 0): Promise<void> => {
      try {
        const input = await inputsApi.get(lessonId);
        if (cancelled) return;
        // 仅在用户尚未编辑时回填，避免异步回填竞态覆盖正在输入的内容。
        if (!dirtyRef.current) {
          const t = input?.transcript ?? '';
          const o = input?.observer_text ?? '';
          const ts = input?.task_sheet_text ?? '';
          setTranscript(t);
          setObserverText(o);
          setTaskSheetText(ts);
          textsRef.current = { transcript: t, observer_text: o, task_sheet_text: ts };
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          handleAuth(e); // 真正登录失效：跳登录
        } else if (attempt < 3) {
          window.setTimeout(() => backfill(attempt + 1), 400 * (attempt + 1));
          return;
        }
      } finally {
        if (!cancelled) setTextLoaded(true);
      }
    };
    void backfill();
    return () => {
      cancelled = true;
    };
  }, [lessonId, loadAssets, handleAuth]);

  /** 触发服务端解析，成功后把解析文本回填到对应编辑区；返回解析出的字符数，失败返回 -1 */
  const runParse = useCallback(
    async (assetId: string) => {
      setParsingId(assetId);
      setListError(null);
      setParseFail(null);
      try {
        const r = await assetsApi.parse(lessonId, assetId);
        await loadAssets();
        const input = await inputsApi.get(lessonId);
        if (r.field === 'transcript') {
          const v = input?.transcript ?? '';
          setTranscript(v);
          textsRef.current = { ...textsRef.current, transcript: v };
        } else if (r.field === 'observer_text') {
          const v = input?.observer_text ?? '';
          setObserverText(v);
          textsRef.current = { ...textsRef.current, observer_text: v };
        } else if (r.field === 'lesson_plan_text') {
          // 教案文本无独立编辑框：解析结果已入库供分析使用，不回填任何文本框
        } else {
          const v = input?.task_sheet_text ?? '';
          setTaskSheetText(v);
          textsRef.current = { ...textsRef.current, task_sheet_text: v };
        }
        // 解析已把文本写入后端，标记为已保存。
        setSaveState('saved');
        return r.chars ?? 0;
      } catch (e) {
        handleAuth(e);
        await loadAssets();
        const target = assets.find((a) => a.id === assetId);
        if (target) {
          setParseFail({
            id: assetId,
            kind: (target.kind as AssetKind) ?? 'task_sheet',
            name: target.file_name,
          });
        }
        setListError(
          e instanceof ApiError && e.status === 401
            ? e.message
            : '文档自动解析未成功（可能是扫描件、图片不清或格式受限），可重试，或改用手工粘贴文本。',
        );
        return -1;
      } finally {
        setParsingId(null);
      }
    },
    [lessonId, loadAssets, handleAuth, assets],
  );

  function pickFile(kind: AssetKind) {
    activeKindRef.current = kind;
    setUploadingKind(kind);
    fileInputRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const kind = activeKindRef.current;
    // 允许重复选择同一文件
    e.target.value = '';
    if (!file || !kind) {
      setUploadingKind(null);
      return;
    }
    // P0-5：上传前客户端预校验（与服务端同一份规则），超限/类型不符直接拦下，不空等上传。
    const invalid = validateAssetFile(kind, file);
    if (invalid) {
      setListError(invalid);
      setUploadingKind(null);
      activeKindRef.current = null;
      return;
    }
    // V1.19：同类素材重复上传以最新为准——先让用户确认覆盖，
    // 确认后上传新文件、自动删除旧素材并提示重新分析。
    const olds = assets.filter((a) => a.kind === kind);
    if (olds.length > 0) {
      setUploadingKind(null);
      activeKindRef.current = null;
      setOverwritePending({ kind, file, olds });
      return;
    }
    try {
      const asset = await assetsApi.upload(lessonId, file, kind, undefined, (p) => setUploadProgress(p));
      await loadAssets();
      // 任务单 / 观察记录 / 教学设计：上传后立即解析为文本，参与 AI 语义评分
      if (kind === 'task_sheet' || kind === 'observer_record' || kind === 'lesson_plan') {
        await runParse(asset.id);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : '上传失败，请稍后重试');
    } finally {
      setUploadingKind(null);
      activeKindRef.current = null;
      setUploadProgress(null);
    }
  }

  // 覆盖确认后的执行：先上传新素材，成功后删除被覆盖的旧素材（单个失败不阻断主流程）
  async function confirmOverwrite() {
    const pending = overwritePending;
    setOverwritePending(null);
    if (!pending) return;
    const { kind, file, olds } = pending;
    setUploadingKind(kind);
    activeKindRef.current = kind;
    try {
      const asset = await assetsApi.upload(lessonId, file, kind, undefined, (p) => setUploadProgress(p));
      for (const old of olds) {
        try {
          await assetsApi.remove(lessonId, old.id);
        } catch {
          // 旧素材删除失败不阻断：新素材已生效，旧素材可在列表手动删除
        }
      }
      setAssets((prev) => prev.filter((a) => !olds.some((o) => o.id === a.id)));
      setListError(null);
      // 任务单 / 观察记录 / 教学设计：上传后立即解析为文本，参与 AI 语义评分
      if (kind === 'task_sheet' || kind === 'observer_record' || kind === 'lesson_plan') {
        await runParse(asset.id);
      } else if (isAvMedia(kind)) {
        setTranscribeNotice({
          ok: true,
          text: `已用「${file.name}」覆盖之前的${olds.length}个${ASSET_KIND_LABEL[kind]}素材。旧视频已删除；如已有转写文稿或分析结果，是基于旧视频产出的，请点新素材行的「识别为文稿」并重新运行分析。`,
        });
      }
      await loadAssets();
    } catch (err) {
      setListError(err instanceof Error ? err.message : '上传失败，请稍后重试');
    } finally {
      setUploadingKind(null);
      activeKindRef.current = null;
      setUploadProgress(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await assetsApi.remove(lessonId, toDelete.id);
      setAssets((prev) => prev.filter((a) => a.id !== toDelete.id));
      if (parseFail?.id === toDelete.id) setParseFail(null);
      setToDelete(null);
    } catch (e) {
      handleAuth(e);
      setListError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  }

  // 音视频 -> 课堂转写文稿：服务端 ASR（录像先抽音轨）。
  // 服务端已把 transcript 落库（transcript_source='asr'），这里只同步本地显示；
  // 不再走 inputsApi.save，否则会把来源改写成 manual。
  const runTranscribe = useCallback(
    async (assetId: string) => {
      setTranscribingId(assetId);
      setTranscribeNotice(null);
      try {
        const r = await assetsApi.transcribe(lessonId, assetId);
        setTranscript(r.transcript);
        textsRef.current = { ...textsRef.current, transcript: r.transcript };
        dirtyRef.current = true;
        setSaveState('saved');
        const mins = r.duration_ms ? `，时长约 ${Math.max(1, Math.round(r.duration_ms / 60000))} 分钟` : '';
        // 时间轴精度如实告知：全窗对齐 = 句子级；只有部分窗成功 = 近似值
        const axis =
          r.window_count && r.aligned_windows
            ? r.aligned_windows >= r.window_count
              ? `，已按 ${r.window_count} 段对齐课堂时间轴`
              : `，时间轴按 ${r.aligned_windows}/${r.window_count} 段对齐（部分片段未识别成功）`
            : '';
        setTranscribeNotice({
          ok: true,
          text: `已识别 ${r.char_count.toLocaleString()} 字课堂文稿${mins}${axis}，每行已带时间戳并写入下方转写文稿、参与自动分析${
            r.truncated ? '（内容过长，已截断至长度上限）' : ''
          }。ASR 无法区分说话人，可点「AI 标注说话人」补齐教师/学生/齐声/媒体标签。`,
        });
        await loadAssets();
      } catch (e) {
        handleAuth(e);
        setTranscribeNotice({ ok: false, text: e instanceof Error ? e.message : '识别失败' });
      } finally {
        setTranscribingId(null);
      }
    },
    [lessonId, handleAuth, loadAssets],
  );

  // V1.19 AI 标注说话人：DeepSeek 逐行判断教师/学生/齐声/媒体，
  // 服务端改写文稿为 `[mm:ss - mm:ss][教师]: 内容` 并落库，这里同步本地显示。
  const runLabelSpeakers = useCallback(async () => {
    if (!textsRef.current.transcript?.trim()) {
      setLabelNotice({ ok: false, text: '请先上传或粘贴课堂转写文稿，再标注说话人。' });
      return;
    }
    setLabeling(true);
    setLabelNotice(null);
    try {
      const r = await inputsApi.labelSpeakers(lessonId);
      setTranscript(r.transcript);
      textsRef.current = { ...textsRef.current, transcript: r.transcript };
      dirtyRef.current = true;
      setSaveState('saved');
      setLabelNotice({
        ok: true,
        text: `已为 ${r.labeled_lines.toLocaleString()} 行文稿标注说话人（教师 / 学生 / 齐声 / 媒体），每行已带时间戳与说话人标签${r.capped ? '；文稿过长，超出上限的部分未标注' : ''}。语义评分将同步区分说话人。`,
      });
    } catch (e) {
      handleAuth(e);
      setLabelNotice({ ok: false, text: e instanceof Error ? e.message : '说话人标注失败，请稍后重试' });
    } finally {
      setLabeling(false);
    }
  }, [lessonId, handleAuth]);

  // P0-6：稳定的防抖保存函数。不依赖三段文本 state（只读 ref），
  // 因此 onChange 当次渲染调用的就是最新函数，定时器里拿到的是最新输入。
  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const payload = textsRef.current;
        const saved = await inputsApi.save(lessonId, payload);
        // 只有后端确认为非空落库才算「已保存」；三段全空时后端返回 input:null，
        // 不能向用户显示「已自动保存」，以免造成假保存错觉。
        const anyContent = Boolean(
          (payload.transcript ?? '').trim() ||
            (payload.observer_text ?? '').trim() ||
            (payload.task_sheet_text ?? '').trim(),
        );
        if (!anyContent || !saved) {
          setSaveState('idle');
        } else {
          setSaveState('saved');
        }
      } catch (e) {
        handleAuth(e);
        setSaveState('error');
      }
    }, 1200);
  }, [lessonId, handleAuth]);

  // 三段文本统一走该更新器：先同步 ref（立即生效，供本次触发的防抖读取），再更新 state 渲染。
  const updateText = useCallback(
    (field: 'transcript' | 'observerText' | 'taskSheetText', value: string) => {
      if (field === 'transcript') {
        setTranscript(value);
        textsRef.current = { ...textsRef.current, transcript: value };
      } else if (field === 'observerText') {
        setObserverText(value);
        textsRef.current = { ...textsRef.current, observer_text: value };
      } else {
        setTaskSheetText(value);
        textsRef.current = { ...textsRef.current, task_sheet_text: value };
      }
      scheduleSave();
    },
    [scheduleSave],
  );

  /**
   * 上传课堂转写文稿：纯文本（.txt/.md/.csv/.srt/.vtt…）浏览器端就地读入文本框并自动保存；
   * Word / PDF 走素材上传 + 服务端文档解析，解析结果回填到转写文稿框。
   */
  async function onTranscriptFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重复选择同一文件
    if (!file) return;
    const invalid = validateAssetFile('transcript', file);
    if (invalid) {
      setImportNotice({ ok: false, text: invalid });
      return;
    }
    setImportingTranscript(true);
    setImportNotice(null);
    try {
      if (isPlainTextTranscriptFile(file)) {
        const text = normalizeTranscriptText(await file.text());
        if (!text) {
          setImportNotice({ ok: false, text: '文稿内容为空，未导入。' });
          return;
        }
        // 后端转写字段上限 20 万字；超出部分截断并明确告知，不静默丢内容。
        const LIMIT = 200_000;
        const over = text.length > LIMIT;
        updateText('transcript', over ? text.slice(0, LIMIT) : text);
        setImportNotice({
          ok: true,
          text: over
            ? `已导入「${file.name}」前 20 万字（原文 ${text.length} 字，超出上限部分未导入）。`
            : `已导入「${file.name}」，共 ${text.length} 字，可直接运行分析。`,
        });
      } else {
        const asset = await assetsApi.upload(lessonId, file, 'transcript', undefined, (p) => setUploadProgress(p));
        await loadAssets();
        const chars = await runParse(asset.id);
        // 文档解析服务对超长文稿可能截断（约 1.6 万字节），解析较长时提示核对末尾并建议改用 .txt。
        const nearLimit = chars >= 6000;
        setImportNotice(
          chars < 0
            ? {
                ok: false,
                text: `「${file.name}」已上传，但自动解析未成功，可点素材行的「重新解析」或改用手工粘贴。`,
              }
            : {
                ok: true,
                text: nearLimit
                  ? `已上传并解析「${file.name}」（${chars} 字）。文档解析对超长文稿可能截断，请核对末尾是否完整；长文稿建议改用 .txt 上传（浏览器本地读取，不截断）。`
                  : `已上传并解析「${file.name}」，文本已填入下方转写文稿。`,
              },
        );
      }
    } catch (err) {
      handleAuth(err);
      setImportNotice({ ok: false, text: err instanceof Error ? err.message : '文稿导入失败，请重试' });
    } finally {
      setImportingTranscript(false);
      setUploadProgress(null);
    }
  }

  /** 解析失败的恢复路径：滚动并聚焦到对应手工粘贴文本框。 */
  const focusManualBox = useCallback((kind: AssetKind) => {
    const el =
      kind === 'observer_record'
        ? observerAreaRef.current
        : kind === 'task_sheet'
          ? taskSheetAreaRef.current
          : transcriptAreaRef.current;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => el?.focus(), 350);
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const hasArchiveAv = assets.some((a) => a.kind === 'av_video' || a.kind === 'av_audio');
  const failedAsset = parseFail ? assets.find((a) => a.id === parseFail.id) : null;

  return (
    <Card id="data-intake" className="scroll-mt-4 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <UploadCloud className="h-4 w-4" />
          </span>
          数据接入
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* P1-1：证据跳原文定位反馈 */}
        {locateHint && (
          <div
            className={`rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
              locateHint.ok
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900/80'
                : 'border-amber-200 bg-amber-50/70 text-amber-900/80'
            }`}
          >
            {locateHint.text}
          </div>
        )}
        {/* P1-10：上传前脱敏提示 */}
        <div className="rounded-lg border border-blue-200/70 bg-blue-50/60 px-3 py-2 text-[11px] leading-relaxed text-blue-900/80">
          隐私提醒：上传前请将学生真实姓名替换为编号（如「生 1」），并去除与评价无关的电话、家庭、健康等个人信息；课堂录音/录像仅作存档。
        </div>
        {/* 文件素材：按分类上传 */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {UPLOADABLE_KINDS.map((kind) => {
            const avMedia = isAvMedia(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => pickFile(kind)}
                disabled={uploadingKind !== null}
                className="group flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-border bg-muted/30 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/[0.04] hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{ASSET_KIND_LABEL[kind]}</span>
                  {uploadingKind === kind ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : avMedia ? (
                    <Video className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
                  ) : (
                    <UploadCloud className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" />
                  )}
                </div>
                <span className="text-xs leading-relaxed text-muted-foreground">{ASSET_KIND_HINT[kind]}</span>
                <span className="text-[11px] text-muted-foreground/70">{ASSET_MAX_HINT[kind]} · 点击上传</span>
                {uploadingKind === kind && uploadProgress && (
                  <div className="mt-1 w-full space-y-1">
                    <Progress
                      value={uploadProgress.stage === 'processing' ? 100 : Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}
                      className="h-1.5"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {uploadProgress.stage === 'processing'
                        ? '已上传完成，正在保存…'
                        : `已上传 ${Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}%（${formatSize(uploadProgress.loaded)} / ${formatSize(uploadProgress.total)}）`}
                    </span>
                  </div>
                )}
                {avMedia && (
                  <span className="mt-0.5 inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary ring-1 ring-inset ring-primary/20">
                    上传后可识别为课堂文稿
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={onFileChosen}
          // accept 在选择文件前按当前分类动态设置
          accept={uploadingKind ? ASSET_ACCEPT[uploadingKind] : undefined}
        />

        {listError && (
          <div className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2.5">
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{listError}</span>
            </p>
            {/* 解析失败就地恢复：重试 或 跳到手工粘贴框 */}
            {parseFail && failedAsset && (parseFail.kind === 'task_sheet' || parseFail.kind === 'observer_record' || parseFail.kind === 'transcript') && (
              <div className="flex flex-wrap gap-2 pl-6">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={parsingId !== null}
                  onClick={() => runParse(parseFail.id)}
                >
                  {parsingId === parseFail.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  重新解析
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => focusManualBox(parseFail.kind)}
                >
                  <PenLine className="mr-1.5 h-3.5 w-3.5" />
                  改用手工粘贴
                </Button>
              </div>
            )}
          </div>
        )}

        {/* 已上传素材列表 */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">已上传素材（{assets.length}）</h3>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          </div>
          {assets.length === 0 && !loading ? (
            <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
              暂无素材，可从上方分类上传课堂音视频、教案、任务单或观察记录；任务单与观察记录上传后会自动解析为文本，转写文稿可在下方「课堂转写文稿」区直接上传
            </p>
          ) : (
            <ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/80 bg-card">
              {assets.map((a) => {
                // V1.9：音视频不参与文档文本解析（走 ASR 转写独立通道），不显示解析徽标，
                // 否则初始 pending 永远不变、给用户"卡住"的错觉
                const isAv = a.kind === 'av_video' || a.kind === 'av_audio';
                const isParseable =
                  a.kind === 'task_sheet' || a.kind === 'observer_record' || a.kind === 'transcript' || a.kind === 'lesson_plan';
                const pb = PARSE_BADGE[a.parse_status] ?? PARSE_BADGE.pending;
                const isFailed = a.parse_status === 'failed' && isParseable;
                return (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground" title={a.file_name}>
                          {a.file_name}
                        </span>
                        {!isAv && (
                          <Badge variant="secondary" className={`shrink-0 gap-0.5 border-0 ${pb.cls}`}>
                            {a.parse_status === 'parsed' ? (
                              <CheckCircle2 className="h-3 w-3" />
                            ) : (
                              <Clock className="h-3 w-3" />
                            )}
                            {pb.label}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ASSET_KIND_LABEL[a.kind as AssetKind] ?? a.kind}
                        {a.size_bytes ? ` · ${formatSize(a.size_bytes)}` : ''}
                        {isAv && ' · 可识别为课堂文稿'}
                        {a.kind === 'lesson_plan' && ' · 解析后作为教学设计素材参与设计类指标分析'}
                      </p>
                      {isFailed && (
                        <button
                          type="button"
                          onClick={() => focusManualBox(a.kind as AssetKind)}
                          className="mt-1 inline-flex items-center text-[11px] font-medium text-primary hover:underline"
                        >
                          <PenLine className="mr-1 h-3 w-3" />
                          解析失败？点此手工粘贴文本
                        </button>
                      )}
                    </div>
                    {(a.kind === 'task_sheet' || a.kind === 'observer_record' || a.kind === 'transcript') && (
                      <button
                        type="button"
                        onClick={() => runParse(a.id)}
                        disabled={parsingId !== null}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-40"
                        title="重新解析为文本"
                      >
                        {parsingId === a.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    {(a.kind === 'av_video' || a.kind === 'av_audio') && (
                      <button
                        type="button"
                        onClick={() => runTranscribe(a.id)}
                        disabled={transcribingId !== null}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-40"
                        title={a.kind === 'av_video' ? '抽取音轨并识别为课堂文稿' : '识别为课堂文稿'}
                      >
                        {transcribingId === a.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    {a.url && (
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={a.file_name}
                        className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                        title="下载 / 预览"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => setToDelete(a)}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-red-50 hover:text-red-600"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 文本数据：转写文稿 / 任务单 / 观察记录 */}
        <div className="space-y-4 border-t border-border/70 pt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">转写文稿 · 任务单 · 观察记录</h3>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {saveState === 'saving' && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
              {saveState === 'error' && <AlertCircle className="h-3 w-3 text-destructive" />}
              {!textLoaded
                ? '加载中…'
                : saveState === 'saving'
                  ? '正在保存…'
                  : saveState === 'saved'
                    ? '已自动保存'
                    : saveState === 'error'
                      ? '保存失败，请重试'
                      : '编辑后自动保存'}
            </span>
          </div>

          {/* 音视频可识别为文稿：不再宣称「仅存档」，给出可执行路径并与转写框紧邻关联。 */}
          {hasArchiveAv && (
            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              <Video className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                已上传的课堂录音/录像可在上方素材列表点<b className="text-foreground">「识别为文稿」</b>
                转成逐字稿（录像会自动抽取音轨），识别结果写入下方转写文稿后即参与 AI 分析；也可直接上传或粘贴文字稿。
              </span>
            </div>
          )}

          {transcribeNotice && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                transcribeNotice.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-destructive/25 bg-destructive/5 text-destructive'
              }`}
            >
              {transcribeNotice.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <span>{transcribeNotice.text}</span>
            </div>
          )}
          {transcribingId && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-800">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              <span>正在识别为课堂文稿…录像会先抽取音轨再识别，约需 10–30 秒（长视频更久），请稍候。</span>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground">
                课堂转写文稿（可上传 .txt / Word / PDF、手动粘贴，或由上方音视频一键识别；建议每行一句，带{' '}
                <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">[时间戳]</code> 与{' '}
                <code className="rounded bg-muted px-1 py-px font-mono text-[11px]">[说话人]</code> 标签）
              </label>
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={labeling || !transcript.trim()}
                  onClick={runLabelSpeakers}
                  title="用 AI 为每行判断教师/学生/齐声/媒体，并写入时间戳与说话人标签"
                >
                  {labeling ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Users className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  AI 标注说话人
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={importingTranscript}
                  onClick={() => transcriptFileRef.current?.click()}
                >
                  {importingTranscript ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <FileUp className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  上传文稿
                </Button>
              </span>
            </div>
            <input
              ref={transcriptFileRef}
              type="file"
              className="hidden"
              accept={ASSET_ACCEPT.transcript}
              onChange={onTranscriptFileChosen}
            />
            {importingTranscript && uploadProgress && (
              <div className="space-y-1">
                <Progress
                  value={uploadProgress.stage === 'processing' ? 100 : Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}
                  className="h-1.5"
                />
                <span className="text-[10px] text-muted-foreground">
                  {uploadProgress.stage === 'processing'
                    ? '已上传，正在解析文稿…'
                    : `已上传 ${Math.round((uploadProgress.loaded / uploadProgress.total) * 100)}%（${formatSize(uploadProgress.loaded)} / ${formatSize(uploadProgress.total)}）`}
                </span>
              </div>
            )}
            <Textarea
              ref={transcriptAreaRef}
              value={transcript}
              onChange={(e) => updateText('transcript', e.target.value)}
              placeholder="上传或粘贴师生对话转写文本，可含时间戳。例如：&#10;[00:01 - 00:02][教师]: 好，上课！&#10;00:01:20 师：请同学们观察这两个图形……"
              className="min-h-40 max-h-[26rem] resize-y overflow-y-auto"
            />
            {importNotice && (
              <p
                className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
                  importNotice.ok ? 'text-emerald-700' : 'text-destructive'
                }`}
              >
                {importNotice.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                ) : (
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                )}
                <span>{importNotice.text}</span>
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              学生任务单文本（上传任务单后自动解析，也可手动粘贴或修订）
            </label>
            <Textarea
              ref={taskSheetAreaRef}
              value={taskSheetText}
              onChange={(e) => updateText('taskSheetText', e.target.value)}
              placeholder="由上传的任务单自动解析生成，或直接粘贴学生作答内容。任务单将作为独立材料，与课堂转写、观察记录共同参与 AI 评分。"
              className="min-h-28 max-h-72 resize-y overflow-y-auto"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">观察员现场记录（自由文本）</label>
            <Textarea
              ref={observerAreaRef}
              value={observerText}
              onChange={(e) => updateText('observerText', e.target.value)}
              placeholder="记录课堂关键事件、学生反应、小组协作情况等观察信息…"
              className="min-h-28 max-h-72 resize-y overflow-y-auto"
            />
          </div>
        </div>
      </CardContent>

      <AlertDialog open={Boolean(toDelete)} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除该素材？</AlertDialogTitle>
            <AlertDialogDescription>
              将同时删除文件「{toDelete?.file_name}」及其记录，此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-500"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* V1.19 同类素材重复上传：以最新为准，确认后新文件上传成功即自动删除旧素材 */}
      <AlertDialog
        open={Boolean(overwritePending)}
        onOpenChange={(open) => !open && setOverwritePending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              覆盖已有的{ASSET_KIND_LABEL[overwritePending?.kind ?? 'av_video']}？
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  本课例已上传 {overwritePending?.olds.length ?? 0} 个
                  {ASSET_KIND_LABEL[overwritePending?.kind ?? 'av_video']}
                  （{overwritePending?.olds.map((o) => o.file_name).join('、')}）。
                  同类素材以最新上传为准，上传成功后旧素材将<b className="text-foreground">自动删除</b>
                  （此操作不可恢复）。
                </p>
                {isAvMedia(overwritePending?.kind ?? 'av_video') && (
                  <p className="text-foreground/80">
                    注意：旧视频对应的转写文稿与分析结果是基于旧视频产出的，覆盖后需对新视频重新
                    「识别为文稿」并重新运行分析。
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmOverwrite(); }}>
              上传新文件并覆盖
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
