'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Loader2, Plus, Trash2, ArrowRight, Inbox, FileText, BookOpen, X } from 'lucide-react';
import { toast } from 'sonner';
import { lessonsApi, standardsApi, ApiError, type Lesson, type StandardSummary } from '@/lib/api/client';
import { LESSON_TYPES, lessonTypeLabel, statusMeta, formatDate } from '@/lib/lesson/constants';
import { LessonListSkeleton, ErrorPanel, friendlyError } from '@/components/feedback/StateBlocks';

export default function LessonsPage() {
  const router = useRouter();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [standards, setStandards] = useState<StandardSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', teacher_name: '', school: '', grade_class: '', lesson_type: '', standard_set_id: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<Lesson | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 首次使用引导：只在本机显示一次，关闭后不再打扰
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem('qz_guide_seen_v1')) setShowGuide(true);
    } catch {
      /* 隐私模式下不可用，忽略 */
    }
  }, []);
  const dismissGuide = () => {
    try {
      localStorage.setItem('qz_guide_seen_v1', '1');
    } catch {
      /* ignore */
    }
    setShowGuide(false);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ls, ss] = await Promise.all([lessonsApi.list(), standardsApi.list()]);
      setLessons(ls);
      setStandards(ss);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
      setLoadError(friendlyError(e, '课例列表暂时加载不出来，可能是网络不稳定或登录状态过期。'));
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    setFormError(null);
    if (!form.title.trim()) {
      setFormError('请填写课例标题');
      return;
    }
    setSaving(true);
    try {
      const created = await lessonsApi.create({
        title: form.title.trim(),
        teacher_name: form.teacher_name.trim() || null,
        school: form.school.trim() || null,
        grade_class: form.grade_class.trim() || null,
        lesson_type: form.lesson_type || null,
        standard_set_id: form.standard_set_id || null,
      });
      setCreateOpen(false);
      setForm({ title: '', teacher_name: '', school: '', grade_class: '', lesson_type: '', standard_set_id: '' });
      toast.success(`课例「${created.title}」已创建`, {
        description: '正在进入课例工作台，接下来可以接入课堂数据并运行分析。',
      });
      router.push(`/lessons/${created.id}`);
    } catch (e) {
      setFormError(
        friendlyError(e, '课例没有创建成功，可能是网络波动或登录状态过期。请稍后重试，已填写的内容不会丢失。'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    const target = toDelete;
    setDeleting(true);
    try {
      await lessonsApi.remove(target.id);
      setLessons((prev) => prev.filter((l) => l.id !== target.id));
      setToDelete(null);
      toast.success(`课例「${target.title}」已删除`, {
        description: '相关素材、人工标注与分析报告已一并移除。',
      });
    } catch (e) {
      // 删除失败不进全局错误态、不清空列表：课例还在原地，toast 提示后可继续操作。
      setToDelete(null);
      toast.error('删除课例失败', {
        description: `${friendlyError(e, '可能是网络波动或登录状态过期').replace(/[。.]+$/, '')}。课例「${target.title}」仍然保留，稍后可再试一次。`,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">我的课例</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            新建课例，接入数据、人工标注并生成情智相长分析报告
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="rounded-lg shadow-sm shadow-primary/20">
          <Plus className="h-4 w-4" />
          新建课例
        </Button>
      </div>

      {/* 首次使用引导：三步走，可一键关闭 */}
      {showGuide && (
        <Card className="mb-5 border-primary/20 bg-primary/5 shadow-none">
          <CardContent className="relative p-4">
            <button
              type="button"
              onClick={dismissGuide}
              aria-label="不再显示"
              className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <BookOpen className="h-4 w-4 text-primary" />
              第一次用？三步就能出一份报告
            </div>
            <ol className="mt-2 grid gap-2 text-xs text-foreground/85 sm:grid-cols-3">
              <li className="rounded-lg border border-border/60 bg-card/70 px-3 py-2">
                <span className="font-medium text-primary">① 备材料</span>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">课堂转写（或录音自动识别）+ 任务单 + 观察记录</p>
              </li>
              <li className="rounded-lg border border-border/60 bg-card/70 px-3 py-2">
                <span className="font-medium text-primary">② 建课例</span>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">填基本信息，课型一定要选对</p>
              </li>
              <li className="rounded-lg border border-border/60 bg-card/70 px-3 py-2">
                <span className="font-medium text-primary">③ 跑分析</span>
                <p className="mt-0.5 leading-relaxed text-muted-foreground">报告先看顶部「一页速读」，再看五维与证据</p>
              </li>
            </ol>
            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
              <Link href="/help" className="text-primary hover:underline">
                打开完整使用指南
              </Link>
              <Link href="/sample" className="text-muted-foreground hover:underline">
                先看一份样例报告
              </Link>
              <button type="button" onClick={dismissGuide} className="text-muted-foreground/70 hover:underline">
                知道了，不再显示
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <LessonListSkeleton />
      ) : loadError ? (
        <ErrorPanel
          title="课例列表加载失败"
          reason={`${loadError.replace(/[。.]+$/, '')}。你可以直接重试；若反复失败，请退出登录后重新登录，或联系管理员。`}
          onRetry={load}
        />
      ) : lessons.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card py-20 text-center shadow-card">
          <div className="bg-brand-gradient mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg shadow-primary/20">
            <Inbox className="h-6 w-6" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">还没有课例</p>
          <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
            从一节数学课堂开始，建立第一份情智相长分析
          </p>
          <Button className="mt-5 rounded-lg" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            新建课例
          </Button>
          <Link
            href="/sample"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary transition-colors hover:text-primary/80"
          >
            <FileText className="h-4 w-4" />
            先看一份完整样例报告（无需网络）
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {lessons.map((l) => {
            const st = statusMeta(l.status);
            return (
              <Link
                key={l.id}
                href={`/lessons/${l.id}`}
                className="group relative flex flex-col rounded-2xl border border-border/80 bg-card p-5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-1 text-[15px] font-semibold text-foreground">{l.title}</h3>
                  <Badge className={`shrink-0 ${st.cls}`}>{st.label}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                  <div className="truncate">教师：{l.teacher_name || '—'}</div>
                  <div className="truncate">班级：{l.grade_class || '—'}</div>
                  <div className="truncate">学校：{l.school || '—'}</div>
                  <div className="truncate">课型：{lessonTypeLabel(l.lesson_type)}</div>
                </dl>
                <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3.5">
                  <span className="text-xs text-muted-foreground">更新于 {formatDate(l.updated_at)}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/20"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setToDelete(l);
                      }}
                      aria-label={`删除课例 ${l.title}`}
                      title="删除课例（会连同素材与报告一并删除）"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/40 transition-all group-hover:bg-primary/10 group-hover:text-primary">
                      <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* 新建课例 */}
      <Dialog open={createOpen} onOpenChange={(o) => !saving && setCreateOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建课例</DialogTitle>
            <DialogDescription>填写课堂基本信息，评价标准可稍后在课例中调整。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {formError && (
              <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>
                课例标题 <span aria-hidden className="text-destructive">*</span>
                <span className="sr-only">（必填）</span>
              </Label>
              <Input
                placeholder="如：七年级《有理数的乘方》新授课"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>授课教师</Label>
                <Input value={form.teacher_name} onChange={(e) => setForm({ ...form, teacher_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>年级班级</Label>
                <Input
                  placeholder="如：七(3)班"
                  value={form.grade_class}
                  onChange={(e) => setForm({ ...form, grade_class: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>学校</Label>
                <Input value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>课型</Label>
                <Select value={form.lesson_type} onValueChange={(v) => setForm({ ...form, lesson_type: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择课型" />
                  </SelectTrigger>
                  <SelectContent>
                    {LESSON_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>评价标准</Label>
              <Select value={form.standard_set_id} onValueChange={(v) => setForm({ ...form, standard_set_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="使用默认内置标准（可稍后调整）" />
                </SelectTrigger>
                <SelectContent>
                  {standards.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}（v{s.version}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? '正在创建…' : '创建并进入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除课例「{toDelete?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              将一并删除该课例的素材、人工标注与分析报告，且无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleting ? '正在删除…' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
