'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api/client';

interface AssetRow {
  id: string;
  kind: string | null;
  file_name: string | null;
  file_url: string | null;
  created_at: string | null;
}

interface MigratePayload {
  bucket_key_count: number;
  bucket_keys: string[];
  bucket_error: string | null;
  assets: AssetRow[];
}

/**
 * 旧桶签名地址，24 小时内有效，只用于把这几条历史素材搬进生产桶。
 * 迁移完成后应把本页与这段常量一起删掉——签名地址不该长期留在代码里。
 */
const PRESET_SOURCES: Array<{ match: string; url: string }> = [
  {
    match: 'file_be60773b.mp4',
    url: 'https://coze-coding-project.tos.coze.site/coze_storage_7700539814080315411/u_1f04082a-032f-4332-91b8-d68582b4d953/l_b077dc87-8077-4aef-a8b3-42ee78500061/av_video/file_be60773b.mp4?sign=1793198541-91b7f2d3a1-0-9c6269732dca08e277f5eefdbd1610da154d8b92cc4ea30a7e160bc84d8d2e18',
  },
  {
    match: 'file_83019a7e.mp4',
    url: 'https://coze-coding-project.tos.coze.site/coze_storage_7700539814080315411/u_1f04082a-032f-4332-91b8-d68582b4d953/l_b8152d2f-040d-4a16-a0f3-d6195f5e0d7e/av_video/file_83019a7e.mp4?sign=1793198541-8968534d61-0-a1a71750701212fdee6e0bed6197f72edb45dc47c2aea988847f10114afc20e9',
  },
  {
    match: '20261015_05b84ed6.docx',
    url: 'https://coze-coding-project.tos.coze.site/coze_storage_7700539814080315411/u_1f04082a-032f-4332-91b8-d68582b4d953/l_b077dc87-8077-4aef-a8b3-42ee78500061/lesson_plan/20261015_05b84ed6.docx?sign=1793198542-ab047195a1-0-a9a580a61f5e502fa19f463519d3a345cc9c332ef211c59dd014b6339b02e281',
  },
];

/**
 * 历史素材跨桶迁移控制台。
 *
 * 只对平台管理员开放：迁移会真的复制对象并改写 lesson_assets.file_url，
 * 属不可逆的写操作，所以做成「一个素材一次点击」，不做批量自动跑。
 */
export default function MediaMigratePage() {
  const [payload, setPayload] = useState<MigratePayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLoadError('');
      setPayload(await api.get<MigratePayload>('/api/admin/media-migrate'));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 记录加载后按旧 key 尾部文件名自动填入预置源地址，省掉手贴超长 URL。 */
  useEffect(() => {
    if (!payload) return;
    setUrls((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const asset of payload.assets) {
        if (next[asset.id]) continue;
        const key = asset.file_url ?? '';
        const hit = PRESET_SOURCES.find((p) => key.endsWith(p.match));
        if (hit) {
          next[asset.id] = hit.url;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [payload]);

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${line}`, ...prev].slice(0, 40));
  }, []);

  const migrate = useCallback(
    async (asset: AssetRow) => {
      const sourceUrl = (urls[asset.id] ?? '').trim();
      if (!sourceUrl) {
        pushLog(`请先填入 ${asset.file_name ?? asset.id} 的源地址`);
        return;
      }
      setBusyId(asset.id);
      try {
        const res = await api.post<{ newKey: string }>('/api/admin/media-migrate', {
          assetId: asset.id,
          sourceUrl,
        });
        pushLog(`成功 ${asset.file_name ?? asset.id} → ${res.newKey}`);
        await load();
      } catch (e) {
        pushLog(`失败 ${asset.file_name ?? asset.id}：${e instanceof Error ? e.message : '迁移失败'}`);
      } finally {
        setBusyId('');
      }
    },
    [urls, pushLog, load],
  );

  const assets = useMemo(() => payload?.assets ?? [], [payload]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin">
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回后台
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">历史素材跨桶迁移</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
          刷新
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4 text-[13px] leading-6 text-muted-foreground">
          <p>
            沙箱期上传的素材留在旧存储桶，生产部署指向另一个桶，所以这些老课例的音视频会取流失败。
            把旧桶对象的签名地址填进下方对应素材，点「迁移」即可复制到生产桶并更新记录。
          </p>
          <p>迁移不可逆（会改写素材记录），是写操作，请确认后再点。</p>
        </CardContent>
      </Card>

      {loadError && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 p-4 text-[13px] text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </CardContent>
        </Card>
      )}

      {payload && (
        <Card>
          <CardContent className="space-y-2 p-4 text-[13px]">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span>
                生产桶当前对象数：<b>{payload.bucket_key_count}</b>
              </span>
            </div>
            {payload.bucket_error && (
              <div className="text-destructive">列桶失败：{payload.bucket_error}</div>
            )}
            {payload.bucket_keys.length > 0 && (
              <ul className="max-h-40 space-y-0.5 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-5">
                {payload.bucket_keys.map((k) => (
                  <li key={k} className="break-all">
                    {k}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {assets.map((asset) => (
          <Card key={asset.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {asset.file_name ?? '（未命名）'}
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {asset.kind ?? '未知类型'}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {asset.file_url ?? '（无对象 key）'}
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => void migrate(asset)}
                  disabled={busyId === asset.id}
                  className="shrink-0"
                >
                  {busyId === asset.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                  迁移
                </Button>
              </div>
              <Input
                placeholder="粘贴该素材在旧桶的签名下载地址（http/https）"
                value={urls[asset.id] ?? ''}
                onChange={(e) => setUrls((prev) => ({ ...prev, [asset.id]: e.target.value }))}
                className="font-mono text-[12px]"
              />
            </CardContent>
          </Card>
        ))}
        {!loading && assets.length === 0 && (
          <Card>
            <CardContent className="p-4 text-[13px] text-muted-foreground">没有可迁移的素材记录。</CardContent>
          </Card>
        )}
      </div>

      {logs.length > 0 && (
        <Card>
          <CardContent className="space-y-1 p-4 font-mono text-[12px] leading-5">
            {logs.map((line, i) => (
              <div key={`${line}-${i}`} className="break-all">
                {line}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
