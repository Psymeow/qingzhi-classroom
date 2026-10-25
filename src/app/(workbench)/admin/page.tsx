'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, ShieldCheck, Users, Building2, FileText, RefreshCw, Search, Lock } from 'lucide-react';
import { platformApi, ApiError, type PlatformPayload } from '@/lib/api/client';

type TabKey = 'orgs' | 'users' | 'lessons';

const TABS: { key: TabKey; label: string; icon: typeof Building2 }[] = [
  { key: 'orgs', label: '机构', icon: Building2 },
  { key: 'users', label: '账号', icon: Users },
  { key: 'lessons', label: '课例', icon: FileText },
];

/** 分数档位着色，与报告页的五档一致 */
function scoreClass(v: number | null): string {
  if (v === null) return 'text-muted-foreground';
  if (v >= 8.1) return 'text-emerald-600';
  if (v >= 6.1) return 'text-teal-600';
  if (v >= 4.1) return 'text-amber-600';
  return 'text-rose-600';
}

export default function AdminPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<PlatformPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [tab, setTab] = useState<TabKey>('orgs');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayload(await platformApi.get());
      setForbidden(false);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        setForbidden(true);
        return;
      }
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

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

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在加载平台数据…
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
  const rows = tab === 'orgs' ? orgs.length : tab === 'users' ? users.length : lessons.length;

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
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : 'hidden'}`} />
          刷新
        </Button>
      </div>

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
              <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{c.value}</div>
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
                  {orgs.map((o) => (
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
                      <td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">
                        没有匹配的机构
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
                  {users.map((u) => (
                    <tr key={u.user_id} className="border-b border-border/40 last:border-0">
                      <td className="px-2 py-2 font-medium text-foreground/90">{u.email || '（无邮箱）'}</td>
                      <td className="px-2 py-2 text-muted-foreground">{u.org_name || '未加入机构'}</td>
                      <td className="px-2 py-2 text-foreground/80">
                        {u.role === 'admin' ? '机构管理员' : u.role === 'leader' ? '教研组长' : u.role === 'teacher' ? '普通教师' : '—'}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-foreground/80">{u.lesson_count}</td>
                      <td className="px-2 py-2 text-muted-foreground">{u.joined_at}</td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-8 text-center text-muted-foreground">
                        没有匹配的账号
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
                  {lessons.map((l) => (
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
                      <td colSpan={6} className="px-2 py-8 text-center text-muted-foreground">
                        没有匹配的课例
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              「报告」为该课例已生成的报告数；总分取最近一份报告。最多显示最近 500 条课例。
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground/70">
        当前筛选结果 {rows} 条 · 数据只读，总台不做任何写操作
      </p>
    </div>
  );
}
