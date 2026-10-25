'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  MessageSquare,
  X,
  Send,
  Loader2,
  Globe,
  ExternalLink,
  Sparkles,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { seekTo } from '@/lib/report/timeline';
import { friendlyError } from '@/components/feedback/StateBlocks';
import { api } from '@/lib/api/client';

interface WebResult {
  title: string;
  authors: string;
  year: string | null;
  venue: string | null;
  url: string | null;
  source: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  webResults?: WebResult[];
  error?: boolean;
}

interface AskResponse {
  answer: string;
  web_used: boolean;
  web_results: WebResult[];
}

const SUGGESTIONS = [
  '这节课的高阶思维培养得怎么样？哪些环节最能看出来？',
  '学生的课堂参与度如何？有哪几个关键时刻？',
  '教学设计和实际授课有哪些出入？',
  '情感目标达成度如何？有没有相关研究依据？',
];

function parseClockToMs(label: string): number | null {
  const m = label.match(/^实录\s*(\d+):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = m[3] ? Number(m[1]) : 0;
  const mm = m[3] ? Number(m[2]) : Number(m[1]);
  const ss = Number(m[3] ?? m[2]);
  return h * 3600000 + mm * 60000 + ss * 1000;
}

function RefChip({
  label,
  webResults,
}: {
  label: string;
  webResults: WebResult[];
}) {
  const ms = parseClockToMs(label);
  if (ms !== null) {
    return (
      <button
        type="button"
        onClick={() => seekTo(ms, 'assistant-ref')}
        title="点击让左侧播放器跳到这一刻"
        className="mx-0.5 inline-flex items-center gap-0.5 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-px align-middle text-[11px] font-medium text-primary transition hover:bg-primary/20"
      >
        <span className="font-mono tabular-nums">{label}</span>
      </button>
    );
  }

  const web = label.match(/^文献\s*(\d+)$/);
  if (web) {
    const idx = Number(web[1]) - 1;
    const item = webResults[idx];
    if (item) {
      return (
        <a
          href={item.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={`${item.title}${item.year ? ` · ${item.year}` : ''}`}
          className="mx-0.5 inline-flex items-center gap-0.5 rounded-full border border-sky-300/60 bg-sky-50 px-1.5 py-px align-middle text-[11px] font-medium text-sky-700 transition hover:bg-sky-100"
        >
          <Globe className="h-2.5 w-2.5" />
          文献 {web[1]}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      );
    }
    return <Badge variant="outline" className="mx-0.5 align-middle text-[11px]">{label}</Badge>;
  }

  return (
    <Badge variant="secondary" className="mx-0.5 align-middle text-[11px] font-normal">
      {label}
    </Badge>
  );
}

function AnswerBody({ text, webResults }: { text: string; webResults: WebResult[] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  // 局部 /g 正则：模块级共享的正则在组件里改 lastIndex 会踩 react-hooks/immutability
  const refRe = /【([^】]{1,24})】/g;
  let m: RegExpExecArray | null;
  while ((m = refRe.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${key++}`}>{text.slice(last, m.index)}</span>);
    parts.push(<RefChip key={`r${key++}`} label={m[1] ?? ''} webResults={webResults} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`t${key++}`}>{text.slice(last)}</span>);

  return (
    <div className="whitespace-pre-wrap break-words text-[13.5px] leading-6 text-foreground/90">
      {parts}
    </div>
  );
}

/**
 * 「情智相长」问答助手：右下角浮动入口 + 右侧抽屉，不挤占详情页布局。
 * 回答里的【实录 mm:ss】可点击，让常驻播放器直接跳到那一秒。
 */
export default function AskAssistant({ lessonId }: { lessonId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [useWeb, setUseWeb] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || loading) return;
      setInput('');
      setLoading(true);
      const history = messages
        .filter((m) => !m.error)
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));
      setMessages((prev) => [
        ...prev,
        { id: `u${idRef.current++}`, role: 'user', content: q },
      ]);
      try {
        const data = await api.post<Partial<AskResponse>>(`/api/lessons/${lessonId}/ask`, {
          question: q,
          history,
          use_web: useWeb,
        });
        setMessages((prev) => [
          ...prev,
          {
            id: `a${idRef.current++}`,
            role: 'assistant',
            content: data.answer ?? '（没有返回内容）',
            webResults: data.web_results ?? [],
          },
        ]);
      } catch (e) {
        setMessages((prev) => [
          ...prev,
          {
            id: `e${idRef.current++}`,
            role: 'assistant',
            content: friendlyError(e, '问答没跑通，可能是网络波动'),
            error: true,
          },
        ]);
      } finally {
        setLoading(false);
        inputRef.current?.focus();
      }
    },
    [lessonId, loading, messages, useWeb],
  );

  const showWelcome = messages.length === 0 && !loading;

  return (
    <>
      {/* 浮动入口 */}
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full p-0 shadow-lg"
        aria-label={open ? '收起问答助手' : '打开问答助手'}
        title="情智相长问答助手"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
      </Button>

      {/* 抽屉 */}
      {open && (
        <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label="情智相长问答助手">
          <div className="absolute inset-0 bg-background/40 backdrop-blur-[1px]" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-[440px] flex-col border-l border-border bg-card shadow-2xl">
            <header className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">情智相长问答助手</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  基于这节课的实录、教案、观察记录与分析结论
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={useWeb ? 'secondary' : 'ghost'}
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => setUseWeb((v) => !v)}
                title={useWeb ? '问到研究依据时会自动检索公开学术文献' : '已关闭联网检索'}
              >
                <Globe className="h-3 w-3" />
                {useWeb ? '联网' : '离线'}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setOpen(false)} aria-label="关闭">
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {showWelcome && (
                <div className="space-y-2.5">
                  <p className="text-[13px] leading-5 text-muted-foreground">
                    可以问我这节课的任何事。回答会标注出处，点时间码就能让左边的播放器跳到对应画面。
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        className="rounded-full border border-border/70 bg-muted/40 px-2.5 py-1 text-left text-[12px] leading-4 text-foreground/80 transition hover:border-primary/40 hover:bg-primary/10"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) =>
                m.role === 'user' ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[13.5px] leading-6 text-primary-foreground">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start">
                    <div
                      className={`max-w-[92%] rounded-2xl rounded-bl-sm px-3 py-2 ${
                        m.error ? 'border border-destructive/30 bg-destructive/5' : 'bg-muted/60'
                      }`}
                    >
                      {m.error ? (
                        <div className="flex items-start gap-1.5 text-[13px] leading-5 text-destructive">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>{m.content}</span>
                        </div>
                      ) : (
                        <AnswerBody text={m.content} webResults={m.webResults ?? []} />
                      )}
                    </div>
                  </div>
                ),
              )}

              {loading && (
                <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在查阅课例材料{useWeb ? '与公开文献' : ''}…
                </div>
              )}

              {messages.some((m) => m.webResults?.length) && (
                <div className="rounded-lg border border-sky-200/70 bg-sky-50/60 p-2.5">
                  <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-sky-800">
                    <Globe className="h-3 w-3" /> 联网检索到的研究
                  </p>
                  <ul className="space-y-1">
                    {messages
                      .flatMap((m) => m.webResults ?? [])
                      .slice(0, 8)
                      .map((r, i) => (
                        <li key={`${r.url ?? r.title}-${i}`} className="text-[11.5px] leading-4">
                          {r.url ? (
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sky-700 underline-offset-2 hover:underline"
                            >
                              {r.title}
                            </a>
                          ) : (
                            <span className="text-foreground/80">{r.title}</span>
                          )}
                          <span className="text-muted-foreground">
                            {r.year ? ` · ${r.year}` : ''}
                            {r.venue ? ` · ${r.venue}` : ''}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="border-t border-border/70 p-3"
            >
              <div className="flex items-center gap-2">
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="问点这节课的问题…"
                  className="h-9 flex-1 rounded-full bg-muted/40"
                  maxLength={2000}
                />
                <Button type="submit" size="sm" className="h-9 w-9 shrink-0 rounded-full p-0" disabled={loading || !input.trim()} aria-label="发送">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
