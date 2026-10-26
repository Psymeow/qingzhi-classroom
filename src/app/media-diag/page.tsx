'use client';

// 临时登录态诊断页：浏览器地址栏直接打开 /api/media-diag 会因缺 x-session 头返回 401，
// 本页在前端用已登录态调用接口并渲染结论，用于定位「课堂切片视频加载不出来」的数据侧根因。

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

interface AssetDiag {
  lesson_id: string;
  lesson_title: string | null;
  asset_id: string;
  kind: string;
  file_name: string | null;
  file_url: string | null;
  sign: 'ok' | 'err' | 'skip';
  sign_error?: string;
  head_status?: number | null;
  head_error?: string;
  signed_host?: string | null;
}

interface DiagPayload {
  user_id: string;
  bucket_note: { name: string | null; endpoint: string | null };
  count: number;
  assets: AssetDiag[];
}

function SignLine({ a }: { a: AssetDiag }) {
  if (a.sign === 'ok') {
    return (
      <span className="text-emerald-700">
        OK{a.signed_host ? ` · ${a.signed_host}` : ''}
      </span>
    );
  }
  if (a.sign === 'err') {
    return <span className="text-red-700">失败 · {a.sign_error ?? '未知错误'}</span>;
  }
  return <span className="text-muted-foreground">未执行（无 key）</span>;
}

function HeadLine({ a }: { a: AssetDiag }) {
  if (a.sign !== 'ok') return <span className="text-muted-foreground">—</span>;
  if (a.head_error) return <span className="text-red-700">请求失败 · {a.head_error}</span>;
  const s = a.head_status;
  if (s === undefined || s === null) return <span className="text-muted-foreground">—</span>;
  if (s === 404) {
    return <span className="text-amber-700">404 — 对象不在当前 bucket</span>;
  }
  if (s >= 200 && s < 300) return <span className="text-emerald-700">{s}</span>;
  return <span className="text-red-700">{s}</span>;
}

export default function MediaDiagPage() {
  const [payload, setPayload] = useState<DiagPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<DiagPayload>('/api/media-diag')
      .then(setPayload)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-4 text-lg font-semibold">媒体加载诊断（临时）</h1>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] leading-5 text-red-800">
          诊断请求失败：{error}
        </div>
      )}

      {!error && !payload && (
        <div className="text-[13px] text-muted-foreground">诊断加载中…</div>
      )}

      {payload && (
        <div className="space-y-4 text-[13px] leading-5">
          <div className="space-y-1 rounded-lg border border-border/70 bg-card px-3 py-2.5">
            <div className="text-muted-foreground">
              账号：<span className="font-mono text-foreground">{payload.user_id}</span>
            </div>
            <div className="text-muted-foreground">
              存储桶：
              <span className="font-mono text-foreground">{payload.bucket_note.name ?? '未设置'}</span>
              {payload.bucket_note.endpoint ? (
                <span className="ml-2 font-mono text-foreground">{payload.bucket_note.endpoint}</span>
              ) : null}
            </div>
            <div className="text-muted-foreground">
              音视频素材数：<span className="font-medium text-foreground">{payload.count}</span>
            </div>
          </div>

          {payload.count === 0 && (
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-muted-foreground">
              当前账号下没有音视频素材记录。
            </div>
          )}

          <div className="space-y-3">
            {payload.assets.map((a) => (
              <div
                key={a.asset_id}
                className="rounded-lg border border-border/70 bg-card px-3 py-2.5 text-xs leading-5"
              >
                <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground">
                    {a.lesson_title ?? a.lesson_id}
                  </span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{a.kind}</span>
                  <span className="text-muted-foreground">{a.file_name ?? '（无文件名）'}</span>
                </div>

                <div className="break-all">
                  <span className="text-muted-foreground">file_url：</span>
                  {a.file_url ? (
                    <span className="font-mono">{a.file_url}</span>
                  ) : (
                    <span className="text-amber-700">空 — 上传未写 key</span>
                  )}
                </div>

                <div>
                  <span className="text-muted-foreground">签名：</span>
                  <SignLine a={a} />
                </div>

                <div>
                  <span className="text-muted-foreground">HEAD：</span>
                  <HeadLine a={a} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
