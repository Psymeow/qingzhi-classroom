'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import {
  platformApi,
  ApiError,
  type PlatformPayload,
  type SchemaHealthPayload,
} from '@/lib/api/client';
import { orgRoleLabel } from '@/lib/constants/roles';

type TabKey = 'orgs' | 'users' | 'lessons';

const TABS: { key: TabKey; label: string; icon: typeof Building2 }[] = [
  { key: 'orgs', label: '机构', icon: Building2 },
  { key: 'users', label: '账号', icon: Users },
  { key: 'lessons', label: '课例', icon: FileText },
];

/** 前端分页：课例可能几百条，一次渲染全量会卡住低配电脑 */
const PAGE_SIZE = 50;

/** 分块降级时给运营看的人话名 */
const BLOCK_LABEL: Record<string, string> = {
  stats: '概览统计',
  orgs: '机构列表',
  users: '账号列表',
  lessons: '课例列表',
};

/** 分数档位着色，与报告页的五档一致 */
function scoreClass(v: number | null): string {
  if (v === null) return 'text-muted-foreground';
  if (v >= 8.1) return 'text-emerald-600';
  if (v >= 6.1) return 'text-teal-600';
  if (v >= 4.1) return 'text-amber-600';
  return 'text-rose-600';
}

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 加载骨架：后台第一屏不该是一行灰字 */
function AdminSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-muted" />
        <div className="h-3.5 w-80 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="shadow-card">
            <CardContent className="space-y-2 p-4">
              <div className="h-3 w-12 animate-pulse rounded bg-muted/70" />
              <div className="h-7 w-16 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className="shadow-card">
        <CardContent className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-6 w-full animate-pulse rounded bg-muted/50" />
          ))}
        </CardContent>
      </Card>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在加载平台数据…
      </p>
    </div>
  );
}

/** 环境自检卡：部署后第一眼看这里，全绿说明迁移都跑过了 */
function HealthCard({
  health,
  loading,
  onReload,
}: {
  health: SchemaHealthPayload | null;
  loading: boolean;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (loading && !health) {
    return (
      <Card className="shadow-card">
        <CardContent className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在检查数据库结构…
        </CardContent>
      </Card>
    );
  }
  if (!health) return null;

  const failed = health.items.filter((i) => !i.ok);
  const allOk = health.ok && !health.error;

  return (
    <Card className={`shadow-card ${allOk ? '' : 'border-amber-300/70 bg-amber-50/40'}`}>
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            {allOk ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-600" />
            )}
            <span className="font-medium text-foreground">环境自检</span>
            <span className="tabular-nums text-muted-foreground">
              {health.total > 0 ? `${health.passed}/${health.total} 项通过` : '未检查'}
            </span>
            {health.error && <span className="text-amber-700">{health.error}</span>}
            {!health.error && failed.length > 0 && (
              <span className="text-amber-700">{failed.length} 项缺失</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(failed.length > 0 || health.error) && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-xs text-primary hover:underline"
              >
                {open ? '收起明细' : '查看缺失项'}
              </button>
            )}
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onReload}>
              <RefreshCw className="mr-1 h-3 w-3" /> 重检
            </Button>
          </div>
        </div>

        {open && (failed.length > 0 || health.error) && (
          <ul className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
            {health.error && (
              <li className="flex items-start gap-1.5 text-[11px] text-amber-800">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0" /> {health.error}
              </li>
            )}
            {failed.map((f) => (
              <li key={f.name} className="flex items-start gap-1.5 text-[11px] text-amber-800">
                <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  <span className="font-medium">{f.name}</span>
                  {f.detail && <span className="text-amber-700/80"> —— {f.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {allOk && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            关键表、列与后台函数均存在，说明迁移已先于代码执行。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<PlatformPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('orgs');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [health, setHealth] = useState<SchemaHealthPayload | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      setHealth(await platformApi.health());
    } catch (e) {
      // 自检失败不打扰主面板，但要让运营看得见
      const msg =
        e instanceof ApiError ? e.message : '环境自检请求失败，可稍后点「重检」';
      setHealth({ ok: false, passed: 0, total: 0, items: [], error: msg });
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(null);
    try {
      const data = await platformApi.get();
      setPayload(data);
      setForbidden(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        setForbidden(true);
        setPayload(null);
        return;
      }
      // 接口故障不能谎报成「没有权限」——这是两件完全不同的事
      setForbidden(false);
      setPayload(null);
      setFailed(e instanceof ApiError ? e.message : '网络异常，请检查连接后重试');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  // 只有管理员身份确认后才去拉自检，避免非白名单账号白打一次请求
  useEffect(() => {
    if (payload) loadHealth();
  }, [payload, loadHealth]);

  // 切页签 / 改搜索时回到第一页，避免停在越界页码
  useEffect(() => {
    setPage(1);
  }, [tab, query]);

  const refreshAll = useCallback(() => {
    load();
    loadHealth();
  }, [load, loadHealth]);

  const q = query.trim().toLowerCase();

  const orgs = useMemo(() => {
    const list = payload?.orgs ?? [];
    if (!q) return list;
    return list.filter((o) => o.name.toLowerCase().includes(q) || o.owner_email.toLowerCase().includes(q));
  }, [payload, q]);

  const users = useMemo(() => {
    const list = payload?.users ?? [];
    if (!q) return list;
    return list.filter(
      (u) => u.email.toLowerCase().includes(q) || u.org_name.toLowerCase().includes(q) || u.role.includes(q),
    );
  }, [payload, q]);

  const lessons = useMemo(() => {
    const list = payload?.lessons ?? [];
    if (!q) return list;
    return list.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.teacher_name.toLowerCase().includes(q) ||
        l.owner_email.toLowerCase().includes(q),
    );
  }, [payload, q]);

  const current = tab === 'orgs' ? orgs.length : tab === 'users' ? users.length : lessons.length;
  const totalPages = Math.max(1, Math.ceil(current / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const from = (safePage - 1) * PAGE_SIZE;
  const pagedOrgs = orgs.slice(from, from + PAGE_SIZE);
  const pagedUsers = users.slice(from, from + PAGE_SIZE);
  const pagedLessons = lessons.slice(from, from + PAGE_SIZE);

  if (loading && !payload && !forbidden && !failed) return <AdminSkeleton />;

  // ---------- 加载失败（不是权限问题） ----------
  if (failed) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-6 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">平台数据加载失败</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              这不是权限问题，是数据没能取回来。稍后重试即可；若持续失败，把下面的原文转给运维。
            </p>
            <p className="rounded-md bg-muted/60 px-3 py-2 text-left font-mono text-[11px] leading-relaxed text-muted-foreground">
              {failed}
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <Button size="sm" onClick={refreshAll} disabled={loading}>
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> 重试
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/">返回我的课例</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---------- 无权限 ----------
  if (forbidden || !payload) {
    return (
      <div className="mx-auto max-w-lg py-16">
        <Card className="shadow-card">
          <CardContent className="space-y-3 p-6 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <Lock className="h-5 w-5 text-muted-foreground" />
            </div>
            <h1 className="text-lg font-semibold text-foreground">没有平台管理权限</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              平台总控台只对平台白名单账号开放，与你在机构里的「机构管理员」身份无关。
              如果你是平台运营，请联系运维把你加入 <code className="font-mono text-xs">platform_admins</code> 白名单。
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <Button variant="outline" size="sm" asChild>
                <Link href="/">返回我的课例</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/org">我的机构</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const s = payload.stats;
  const degraded = payload.degraded ?? [];
  const degradedText = degraded.map((d) => BLOCK_LABEL[d.key] ?? d.key).join('、');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <ShieldCheck className="h-5 w-5 text-primary" /> 平台总控台
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            全平台的机构、账号与课例只读总览。这里不做任何写操作，也不会改变任何人的可见范围。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 分块降级提示：部分统计挂了也要把话说清楚，不能静默少数据 */}
      {degraded.length > 0 && (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50/60 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <span className="font-medium">部分统计暂不可用：{degradedText}。</span>
            <span className="text-amber-700/90">
              其余数据照常显示；这几块可能是迁移未跑或函数异常，可点「刷新」重试，持续出现请查环境自检。
            </span>
          </div>
        </div>
      )}

      {/* 环境自检 */}
      <HealthCard health={health} loading={healthLoading} onReload={loadHealth} />

      {/* 概览 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: '机构', value: s.org_count },
          { label: '账号', value: s.user_count },
          { label: '课例', value: s.lesson_count },
          { label: '已出报告', value: s.report_count },
          { label: '报告平均分', value: s.avg_score },
        ].map((c) => (
          <Card key={c.label} className="shadow-card">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{c.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {degraded.some((d) => d.key === 'stats') ? (
                  <span className="text-base font-normal text-muted-foreground">暂不可用</span>
                ) : (
                  c.value
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 页签 + 搜索 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-lg border border-border/70 bg-card/60 p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  active ? 'bg-background font-medium text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称、邮箱、角色筛选"
            className="h-8 w-56 pl-8 text-xs"
          />
        </div>
      </div>

      {/* 机构表 */}
      {tab === 'orgs' && (
        <Card className="shadow-card">
          <CardContent className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-2 py-2 text-left font-medium">机构</th>
                    <th className="px-2 py-2 text-left font-medium">创建者</th>
                    <th className="px-2 py-2 text-right font-medium">成员</th>
                    <th className="px-2 py-2 text-right font-medium">课例</th>
                    <th className="px-2 py-2 text-left font-medium">邀请码</th>
                    <th className="px-2 py-2 text-left font-medium">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedOrgs.map((o) => (
                    <tr key={o.id} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-2 font-medium text-foreground/90">{o.name}</td>
                      <td className="px-2 py-2 text-muted-foreground">{o.owner_email || '—'}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground/80">{o.member_count}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground/80">{o.lesson_count}</td>
                      <td className="px-2 py-2 font-mono text-[11px] tracking-widest text-muted-foreground">
                        {o.invite_code}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{o.created_at}</td>
                    </tr>
                  ))}
                  {orgs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-8 text-center">
                        {q ? (
                          <span className="text-muted-foreground">
                            没有匹配「{query.trim()}」的机构，换个关键词或清空筛选。
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            全平台还没有任何机构。教师在「我的机构」页创建机构后才会出现在这里。
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              「成员」为该机构当前在职成员数（不含已移出）。0 成员的机构通常是创建中断留下的空壳，创建者再次用同名创建会自动复用。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 账号表 */}
      {tab === 'users' && (
        <Card className="shadow-card">
          <CardContent className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-2 py-2 text-left font-medium">邮箱</th>
                    <th className="px-2 py-2 text-left font-medium">机构</th>
                    <th className="px-2 py-2 text-left font-medium">机构角色</th>
                    <th className="px-2 py-2 text-right font-medium">课例数</th>
                    <th className="px-2 py-2 text-left font-medium">注册时间</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map((u) => (
                    <tr key={u.user_id} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-2 font-medium text-foreground/90">{u.email || '（无邮箱）'}</td>
                      <td className="px-2 py-2 text-muted-foreground">{u.org_name || '未加入机构'}</td>
                      <td className="px-2 py-2 text-foreground/80">
                        {orgRoleLabel(u.role)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground/80">{u.lesson_count}</td>
                      <td className="px-2 py-2 text-muted-foreground">{u.joined_at}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-8 text-center">
                        {q ? (
                          <span className="text-muted-foreground">
                            没有匹配「{query.trim()}」的账号，换个关键词或清空筛选。
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            全平台还没有注册账号。这里只统计已注册成功的账号，不含邀请未接受的人。
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              未加入机构的账号默认只能看到自己的课例；加入机构后可见范围由机构角色决定。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 课例表 */}
      {tab === 'lessons' && (
        <Card className="shadow-card">
          <CardContent className="p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="px-2 py-2 text-left font-medium">课例</th>
                    <th className="px-2 py-2 text-left font-medium">所属账号</th>
                    <th className="px-2 py-2 text-left font-medium">可见性</th>
                    <th className="px-2 py-2 text-right font-medium">总分</th>
                    <th className="px-2 py-2 text-right font-medium">报告</th>
                    <th className="px-2 py-2 text-left font-medium">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedLessons.map((l) => (
                    <tr key={l.id} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-2">
                        <Link href={`/lessons/${l.id}`} className="font-medium text-foreground/90 hover:text-primary hover:underline">
                          {l.title || '（未命名课例）'}
                        </Link>
                        {l.teacher_name && (
                          <span className="ml-2 text-[11px] text-muted-foreground">{l.teacher_name}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{l.owner_email || '—'}</td>
                      <td className="px-2 py-2 text-foreground/80">
                        {l.visibility === 'org' ? '机构可见' : '仅自己'}
                      </td>
                      <td className={`px-2 py-2 text-right font-semibold tabular-nums ${scoreClass(l.total_score)}`}>
                        {l.total_score === null || l.total_score === undefined ? '—' : Number(l.total_score).toFixed(1)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{l.report_count}</td>
                      <td className="px-2 py-2 text-muted-foreground">{l.created_at}</td>
                    </tr>
                  ))}
                  {lessons.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-2 py-8 text-center">
                        {q ? (
                          <span className="text-muted-foreground">
                            没有匹配「{query.trim()}」的课例，换个关键词或清空筛选。
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            全平台还没有课例。教师新建课例后才会出现在这里。
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              「报告」为该课例已生成的报告数；总分取最近一份报告。最多加载最近 500 条课例。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 分页 */}
      {current > PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            第 {safePage}/{totalPages} 页 · 共 {current} 条
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <Activity className="h-3 w-3" />
        当前筛选结果 {current} 条 · 数据只读，总台不做任何写操作 · 数据取回于 {fmtTime(payload.fetched_at)}
      </p>
    </div>
  );
}
