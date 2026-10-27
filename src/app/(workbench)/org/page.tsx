'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Copy,
  Loader2,
  LogIn,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { orgApi, ApiError, type OrgPayload } from '@/lib/api/client';
import { statusMeta, formatDate } from '@/lib/lesson/constants';
import { ORG_ROLES, ORG_ROLE_LABEL, isOrgAdmin, orgRoleLabel } from '@/lib/constants/roles';

const ROLE_DESC: Record<string, string> = {
  admin: '管理成员与角色，可查看机构全部课例',
  leader: '可查看机构全部课例、参与协同评审，不能管理成员',
  teacher: '只看自己的课例与被分享的课例',
};

export default function OrgPage() {
  const router = useRouter();
  const [payload, setPayload] = useState<OrgPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayload(await orgApi.get());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
      toast.error(e instanceof ApiError ? e.message : '机构信息加载失败');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error('请填写机构名称');
      return;
    }
    setBusy(true);
    try {
      await orgApi.create(name.trim());
      toast.success('机构已创建，把邀请码发给同事即可加入');
      setName('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '创建机构失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!code.trim()) {
      toast.error('请填写邀请码');
      return;
    }
    setBusy(true);
    try {
      await orgApi.join(code.trim().toUpperCase());
      toast.success('已加入机构');
      setCode('');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '加入机构失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleRole(userId: string, role: string) {
    setBusy(true);
    try {
      await orgApi.setRole(userId, role);
      toast.success('角色已更新');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '调整角色失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(userId: string) {
    setBusy(true);
    try {
      await orgApi.remove(userId);
      toast.success('已移出机构（历史课例保留）');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '移除成员失败');
    } finally {
      setBusy(false);
    }
  }

  async function copyCode() {
    const c = payload?.org?.invite_code;
    if (!c) return;
    try {
      await navigator.clipboard.writeText(c);
      toast.success('邀请码已复制');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> 正在加载机构信息…
      </div>
    );
  }

  const org = payload?.org ?? null;
  const isAdmin = isOrgAdmin(org?.role);

  // ---------- 未加入机构：创建 / 邀请码加入 ----------
  if (!org) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Building2 className="h-5 w-5 text-primary" /> 机构
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            加入机构后，管理员可以统一查看本校课例与教研进展；教师个人的课例默认仍只对自己可见。
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="shadow-card">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Plus className="h-4 w-4 text-primary" /> 创建机构
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                你是机构的创建者，自动成为超级管理员：可以邀请同事、调整角色、查看全校课例。
              </p>
              <div className="space-y-1.5">
                <Label>机构名称</Label>
                <Input placeholder="如：上海市虹口区教育学院" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button className="w-full rounded-lg" onClick={handleCreate} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                创建并成为管理员
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <LogIn className="h-4 w-4 text-primary" /> 用邀请码加入
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                向机构管理员索取 8 位邀请码（形如 3F9A2C7D）。加入后你的课例仍归你自己，管理员可查看并参与评课。
              </p>
              <div className="space-y-1.5">
                <Label>邀请码</Label>
                <Input
                  placeholder="请输入邀请码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="font-mono tracking-widest"
                />
              </div>
              <Button variant="outline" className="w-full rounded-lg" onClick={handleJoin} disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                加入机构
              </Button>
            </CardContent>
          </Card>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          不想加入也可以继续单人使用，功能不受影响。
          <Link href="/help" className="ml-1 text-primary hover:underline">
            了解角色与权限
          </Link>
        </p>
      </div>
    );
  }

  // ---------- 已加入机构 ----------
  const stats = payload?.stats;
  const members = payload?.members ?? [];
  const lessons = payload?.lessons ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Building2 className="h-5 w-5 text-primary" /> {org.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            我的角色：
            <span className="ml-1 font-medium text-foreground">{orgRoleLabel(org.role)}</span>
            <span className="mx-1.5 text-muted-foreground/50">·</span>
            {ROLE_DESC[org.role] ?? ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <Loader2 className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : 'hidden'}`} />
          刷新
        </Button>
      </div>

      {/* 概览 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '机构成员', value: members.length },
          { label: '机构课例', value: stats?.lessons ?? 0 },
          { label: '已完成分析', value: stats?.analyzed ?? 0 },
          { label: '待分析', value: stats?.pending ?? 0 },
        ].map((s) => (
          <Card key={s.label} className="shadow-card">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 邀请码（仅管理员） */}
      {isAdmin && org.invite_code && (
        <Card className="border-primary/20 bg-primary/5 shadow-none">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" /> 机构邀请码
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                发给同事，他们注册后到「机构」页输入即可加入。邀请码长期有效，请只发给本校教师。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="rounded-lg border border-border bg-card px-3 py-1.5 font-mono text-sm tracking-[0.2em] text-foreground">
                {org.invite_code}
              </code>
              <Button variant="outline" size="sm" onClick={copyCode}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> 复制
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 成员 */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Users className="h-4 w-4 text-primary" /> 成员与权限
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <th className="px-2 py-2 text-left font-medium">成员</th>
                  <th className="px-2 py-2 text-left font-medium">角色</th>
                  <th className="px-2 py-2 text-left font-medium">加入时间</th>
                  {isAdmin && <th className="px-2 py-2 text-right font-medium">操作</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id} className="border-b border-border/40 last:border-0">
                    <td className="px-2 py-2 text-foreground/90">
                      {m.display_name || m.user_id.slice(0, 8)}
                    </td>
                    <td className="px-2 py-2">
                      {isAdmin ? (
                        <Select
                          value={m.role}
                          onValueChange={(v) => handleRole(m.user_id, v)}
                          disabled={busy}
                        >
                          <SelectTrigger className="h-7 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ORG_ROLES.map((r) => (
                              <SelectItem key={r} value={r}>
                                {ORG_ROLE_LABEL[r]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-foreground/80">{orgRoleLabel(m.role)}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{formatDate(m.created_at)}</td>
                    {isAdmin && (
                      <td className="px-2 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground/70 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleRemove(m.user_id)}
                          disabled={busy}
                          title="移出机构（历史课例保留）"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            角色说明：机构管理员可管理成员与角色、查看全部课例；教研组长可查看全部课例并参与协同评审；普通教师只看自己的课例和被分享的课例。
            管理员不能修改自己的角色，也不能移除机构创建者。
          </p>
        </CardContent>
      </Card>

      {/* 机构课例 */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <FileText className="h-4 w-4 text-primary" /> 机构课例
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              （按你的角色显示可见范围）
            </span>
          </div>
          {lessons.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              机构内还没有课例。教师新建课例会自动归属机构。
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {lessons.map((l) => {
                const st = statusMeta(l.status);
                return (
                  <li key={l.id}>
                    <Link
                      href={`/lessons/${l.id}`}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 transition-colors hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-foreground">{l.title}</div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {l.teacher_name || '未填教师'} · {l.grade_class || '未填班级'} · 更新于{' '}
                          {formatDate(l.updated_at)}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
