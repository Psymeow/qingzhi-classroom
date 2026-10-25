'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, ArrowLeft, Save, Upload, ClipboardList, Sparkles, BarChart3, Film, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { lessonsApi, standardsApi, ApiError, type LessonDetail } from '@/lib/api/client';
import AnnotationWorkbench from '@/components/lesson/AnnotationWorkbench';
import type { DimMeta } from '@/components/annotation/DimensionScores';
import DataIntake from '@/components/lesson/DataIntake';
import AnalysisPanel from '@/components/lesson/AnalysisPanel';
import ReportView from '@/components/report/ReportView';
import LessonTimeline from '@/components/lesson/LessonTimeline';
import LessonPlayer from '@/components/lesson/LessonPlayer';
import AskAssistant from '@/components/assistant/AskAssistant';
import type { StoredReport } from '@/lib/api/client';
import { LOCATE_EVENT } from '@/lib/report/locate';
import { LESSON_TYPES, lessonTypeLabel, statusMeta, formatDate, formatRelativeTime } from '@/lib/lesson/constants';
import { LessonDetailSkeleton, BlockSkeleton, ErrorPanel, friendlyError } from '@/components/feedback/StateBlocks';

/** 详情页板块标签（V1.9：分模块标签模式，替代一栏拉到底） */
type DetailTab = 'intake' | 'annotate' | 'timeline' | 'analyze' | 'report';
const TAB_META: Array<{ value: DetailTab; label: string; hint: string; icon: LucideIcon }> = [
  { value: 'intake', label: '数据接入', hint: '上传素材、转写文稿与文本材料', icon: Upload },
  { value: 'annotate', label: '人工标注', hint: '按维度记录课堂观察与评分', icon: ClipboardList },
  { value: 'analyze', label: '融合分析', hint: '运行多源融合分析引擎', icon: Sparkles },
  { value: 'timeline', label: '课堂切片', hint: '视频与各指标对应的时间点', icon: Film },
  { value: 'report', label: '分析报告', hint: '可视化报告与结论建议', icon: BarChart3 },
];
function isDetailTab(v: string | null): v is DetailTab {
  return v === 'intake' || v === 'annotate' || v === 'timeline' || v === 'analyze' || v === 'report';
}

export default function LessonDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = String(params.id);

  const [detail, setDetail] = useState<LessonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 404 场景（课例不存在/无权）：错误面板不给「重试」，只引导返回列表。
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ teacher_name: '', school: '', grade_class: '', lesson_type: '' });
  const [dimensions, setDimensions] = useState<DimMeta[]>([]);
  // V1.13：旧报告的 indicators 未存 name，用标准内容补一份 code → name 映射给指标地图用
  const [indicatorNames, setIndicatorNames] = useState<Record<string, string>>({});
  const [latestReport, setLatestReport] = useState<StoredReport | null>(null);

  // V1.9 板块标签：URL ?tab= 同步（刷新/分享保持）；未指定时有报告看报告、无报告进数据接入
  const [activeTab, setActiveTab] = useState<DetailTab>(() => {
    const t = searchParams.get('tab');
    if (isDetailTab(t)) return t;
    return 'intake';
  });
  const switchTab = useCallback((t: DetailTab) => {
    setActiveTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.replaceState(null, '', url.toString());
  }, []);

  // 报告首次就绪时若正停在数据接入，自动切到报告（分析完成 → 看结果的最短路径）
  const reportActivatedRef = useMemo(() => ({ current: false }), []);
  useEffect(() => {
    if (latestReport && !reportActivatedRef.current) {
      reportActivatedRef.current = true;
      const t = new URLSearchParams(window.location.search).get('tab');
      if (!isDetailTab(t)) switchTab('report');
    }
  }, [latestReport, reportActivatedRef, switchTab]);

  // 报告证据点击定位：目标原文区块可能在别的标签里——先切标签，再重放一次定位事件，
  // 让目标区块在可见状态下完成滚动与选中（区块内部的 handler 在隐藏态执行 scrollIntoView 无效）。
  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<{ source?: string; __reloc?: boolean }>).detail;
      if (d?.__reloc) return; // 重放事件只交给区块内部处理，不再切标签
      switchTab(d?.source === 'manual_annotation' ? 'annotate' : 'intake');
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(LOCATE_EVENT, { detail: { ...(d ?? {}), __reloc: true } }));
      }, 60);
    };
    window.addEventListener(LOCATE_EVENT, handler);
    return () => window.removeEventListener(LOCATE_EVENT, handler);
  }, [switchTab]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const d = await lessonsApi.get(id);
      setDetail(d);
      setForm({
        teacher_name: d.teacher_name ?? '',
        school: d.school ?? '',
        grade_class: d.grade_class ?? '',
        lesson_type: d.lesson_type ?? '',
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace('/login');
        return;
      }
      if (e instanceof ApiError && e.status === 404) {
        setError('这节课不存在，或你没有查看它的权限。');
        setNotFound(true);
        setLoading(false);
        return;
      }
      setError(friendlyError(e, '课例详情没能加载出来，可能是网络不稳定或登录状态过期。'));
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  // 加载五维元信息：优先课例绑定的标准，否则回退第一个可用标准。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const all = await standardsApi.list();
        if (cancelled || all.length === 0) return;
        const targetId = detail?.standard_set_id;
        const chosen = all.find((x) => x.id === targetId) ?? all[0];
        const detailStd = await standardsApi.get(chosen.id);
        const dims = (detailStd.content?.dimensions ?? []) as DimMeta[];
        // 指标名映射：标准定义里每个二级指标都有 code + name，报告侧只在有 name 时优先用它
        const rawDims = (detailStd.content?.dimensions ?? []) as unknown as Array<{
          indicators?: Array<{ code?: string; name?: string }>;
        }>;
        const nameMap: Record<string, string> = {};
        for (const dim of rawDims) {
          for (const ind of dim.indicators ?? []) {
            if (ind.code && ind.name) nameMap[ind.code] = ind.name;
          }
        }
        if (!cancelled) setIndicatorNames(nameMap);
        if (!cancelled && Array.isArray(dims)) {
          setDimensions(
            dims
              .filter((d) => d && d.code)
              .map((d) => ({
                code: d.code,
                order: d.order,
                name: d.name,
                weight: d.weight,
                observation_focus: d.observation_focus ?? '',
              })),
          );
        }
      } catch {
        // 维度加载失败不阻塞页面，评分页给出空态由上层处理
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail?.standard_set_id]);

  async function saveMeta() {
    setSaving(true);
    try {
      const updated = await lessonsApi.update(id, {
        teacher_name: form.teacher_name.trim() || null,
        school: form.school.trim() || null,
        grade_class: form.grade_class.trim() || null,
        lesson_type: form.lesson_type || null,
      });
      setEditing(false);
      // 用 PATCH 回包直接回填界面，不再保存后立刻 GET：
      // 立刻 GET 可能命中缓存/瞬时态的旧值，表现为「保存成功但基本信息仍显示未填写」。
      if (updated) {
        setDetail((prev) => (prev ? { ...prev, ...updated } : prev));
        setForm({
          teacher_name: updated.teacher_name ?? '',
          school: updated.school ?? '',
          grade_class: updated.grade_class ?? '',
          lesson_type: updated.lesson_type ?? '',
        });
      }
      toast.success('基本信息已保存', { description: '课例信息已更新，列表页也会同步显示。' });
    } catch (e) {
      // 保存失败：不退出编辑态、不清空输入，提示原因与下一步，已填内容不丢。
      toast.error('基本信息没有保存成功', {
        description: `${friendlyError(e, '可能是网络波动或登录状态过期').replace(/[。.]+$/, '')}。当前编辑的内容都还在，稍后可再点「保存基本信息」重试。`,
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LessonDetailSkeleton />;
  }

  if (!detail) {
    return (
      <ErrorPanel
        title={notFound ? '找不到这节课' : '课例详情加载失败'}
        reason={error ?? '课例暂时不可用。'}
        onRetry={notFound ? undefined : load}
        retryLabel="重新加载"
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/">
            <ArrowLeft className="h-4 w-4" /> 返回课例列表
          </Link>
        </Button>
      </ErrorPanel>
    );
  }

  const st = statusMeta(detail.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link
          href="/"
          className="inline-flex items-center rounded-full py-0.5 transition hover:text-primary"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> 我的课例
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold text-foreground">{detail.title}</h1>
            <Badge className={st.cls}>{st.label}</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {detail.school || '学校未填'} · {detail.grade_class || '班级未填'} ·{' '}
            {lessonTypeLabel(detail.lesson_type)}
          </p>
        </div>
        {!editing ? (
          <Button variant="outline" className="rounded-lg" onClick={() => setEditing(true)}>
            编辑信息
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" className="rounded-lg" onClick={() => setEditing(false)} disabled={saving}>
              取消
            </Button>
            <Button className="rounded-lg" onClick={saveMeta} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? '保存中…' : '保存基本信息'}
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">课堂基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>授课教师</Label>
                <Input value={form.teacher_name} onChange={(e) => setForm({ ...form, teacher_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>年级班级</Label>
                <Input value={form.grade_class} onChange={(e) => setForm({ ...form, grade_class: e.target.value })} />
              </div>
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
          </CardContent>
        </Card>
      )}

      {/* 层级化布局：桌面端 左侧模块导航 + 中间常驻播放器 + 右侧内容区；窄屏降级为摘要条 + 横向标签 */}
      <div className="grid items-start gap-4 md:grid-cols-[224px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[200px_352px_minmax(0,1fr)] lg:gap-5 2xl:grid-cols-[216px_400px_minmax(0,1fr)] 2xl:gap-6">
        <aside className="hidden md:block">
          <div className="sticky top-20 space-y-3">
            <nav aria-label="课例模块导航" className="rounded-xl border border-border/70 bg-card/70 p-1.5 shadow-xs">
              <p className="px-2.5 pb-1 pt-2 text-[11px] font-medium tracking-wider text-muted-foreground">
                课例模块
              </p>
              {TAB_META.map((t) => {
                const on = activeTab === t.value;
                const Icon = t.icon;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => switchTab(t.value)}
                    aria-current={on ? 'page' : undefined}
                    title={t.hint}
                    className={`relative flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      on ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    {on && (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden />
                    )}
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-5">{t.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{t.hint}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="rounded-xl border border-border/70 bg-card/70 p-3 shadow-xs">
              <p className="text-[11px] font-medium tracking-wider text-muted-foreground">课堂信息</p>
              <dl className="mt-2 space-y-1.5">
                <NavInfo label="教师" value={detail.teacher_name} />
                <NavInfo label="班级" value={detail.grade_class} />
                <NavInfo label="学校" value={detail.school} />
                <NavInfo label="课型" value={lessonTypeLabel(detail.lesson_type)} />
                <NavInfo label="日期" value={formatDate(detail.lesson_date)} />
                <NavInfo
                  label="时长"
                  value={detail.duration_sec ? `${Math.round(detail.duration_sec / 60)} 分钟` : undefined}
                />
                <NavInfo label="素材" value={`${detail.assets?.length ?? 0} 个`} />
                <NavInfo
                  label="标注"
                  title={
                    detail.annotation
                      ? `标注保存计数 v${detail.annotation.version}（内部乐观锁递增，仅供排障）`
                      : undefined
                  }
                  value={detail.annotation ? annotationStatusText(detail.annotation.updated_at) : undefined}
                />
                <NavInfo label="报告" value={detail.report ? `${detail.report.total_score} 分` : undefined} />
              </dl>
            </div>
          </div>
        </aside>

        {/* 中间栏（lg+ 常驻）：课堂录像 + 实时字幕。切任何板块都在，右侧证据/问答引用一键跳转。
            窄屏不进这条轨道（避免挤压内容区），改为在「课堂切片」标签里补一个实例。 */}
        <div className="hidden lg:block">
          <div className="sticky top-20">
            <LessonPlayer lessonId={id} />
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          {/* 窄屏：一行摘要 + 横向标签（桌面端信息在左栏、导航在左侧） */}
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border/70 bg-muted/30 px-4 py-2.5 md:hidden">
            <Info label="教师" value={detail.teacher_name} />
            <Info label="班级" value={detail.grade_class} />
            <Info label="学校" value={detail.school} />
            <Info label="课型" value={lessonTypeLabel(detail.lesson_type)} />
            <Info label="日期" value={formatDate(detail.lesson_date)} />
            <Info
              label="时长"
              value={detail.duration_sec ? `${Math.round(detail.duration_sec / 60)} 分钟` : undefined}
            />
            <Info label="素材" value={`${detail.assets?.length ?? 0} 个`} />
            <Info
              label="标注"
              title={
                detail.annotation
                  ? `标注保存计数 v${detail.annotation.version}（内部乐观锁递增，仅供排障）`
                  : undefined
              }
              value={detail.annotation ? annotationStatusText(detail.annotation.updated_at) : undefined}
            />
            <Info label="报告" value={detail.report ? `${detail.report.total_score} 分` : undefined} />
          </dl>

          <div className="border-b border-border/70 md:hidden">
            <div role="tablist" aria-label="课例详情板块" className="flex gap-1 overflow-x-auto">
              {TAB_META.map((t) => {
                const on = activeTab === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="tab"
                    id={`tab-${t.value}`}
                    aria-selected={on}
                    aria-controls={`panel-${t.value}`}
                    title={t.hint}
                    onClick={() => switchTab(t.value)}
                    className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      on
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div role="tabpanel" id="panel-intake" aria-labelledby="tab-intake" hidden={activeTab !== 'intake'}>
            <DataIntake lessonId={id} onUnauthorized={() => router.replace('/login')} />
          </div>

          <div role="tabpanel" id="panel-annotate" aria-labelledby="tab-annotate" hidden={activeTab !== 'annotate'}>
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">人工标注工作台</CardTitle>
              </CardHeader>
              <CardContent>
                {dimensions.length > 0 ? (
                  <AnnotationWorkbench
                    lessonId={id}
                    dimensions={dimensions}
                    onUnauthorized={() => router.replace('/login')}
                  />
                ) : (
                  <BlockSkeleton />
                )}
              </CardContent>
            </Card>
          </div>

          <div role="tabpanel" id="panel-analyze" aria-labelledby="tab-analyze" hidden={activeTab !== 'analyze'}>
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="text-base">多源融合分析</CardTitle>
              </CardHeader>
              <CardContent>
                <AnalysisPanel
                  lessonId={id}
                  dimensions={dimensions}
                  onUnauthorized={() => router.replace('/login')}
                  onReportChange={setLatestReport}
                />
              </CardContent>
            </Card>
          </div>

          <div role="tabpanel" id="panel-timeline" aria-labelledby="tab-timeline" hidden={activeTab !== 'timeline'}>
            {/* lg+ 播放器在中间栏常驻，这里只在窄屏补一个实例，保证小屏也能边看边对时间轴 */}
            <div className="mb-4 lg:hidden">
              <LessonPlayer lessonId={id} />
            </div>
            <LessonTimeline lessonId={id} result={latestReport?.result ?? null} />
          </div>

          <div role="tabpanel" id="panel-report" aria-labelledby="tab-report" hidden={activeTab !== 'report'}>
            {latestReport ? (
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="text-base">课堂分析报告</CardTitle>
                </CardHeader>
                <CardContent>
                  <ReportView
                    report={latestReport}
                    lessonId={id}
                    dimensions={dimensions}
                    indicatorNames={indicatorNames}
                    lessonTitle={detail.title}
                    lessonMeta={{
                      teacher_name: detail.teacher_name,
                      school: detail.school,
                      grade_class: detail.grade_class,
                    }}
                    onUnauthorized={() => router.replace('/login')}
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center">
                <p className="text-sm text-muted-foreground">尚未生成分析报告</p>
                <p className="mt-1 text-xs text-muted-foreground/80">
                  完成数据接入与标注后，到「融合分析」运行引擎即可生成可视化报告
                </p>
                <Button variant="outline" className="mt-4 rounded-lg" onClick={() => switchTab('analyze')}>
                  去融合分析
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* 「情智相长」问答助手：右下角浮动入口，抽屉展开不挤占版面 */}
      <AskAssistant lessonId={id} />
    </div>
  );
}

/** 人工标注状态文案：有保存时间就带上相对时间；version 是内部保存计数，只放 title 供排障 */
function annotationStatusText(updatedAt?: string | null): string {
  const rel = formatRelativeTime(updatedAt);
  return rel ? `已标注 · ${rel}保存` : '已标注';
}

/** 左侧导航里的信息条目：标签左、值右，超长省略 */
function NavInfo({ label, value, title }: { label: string; value?: string | null; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2" title={title}>
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-xs font-medium text-foreground">{value || '—'}</dd>
    </div>
  );
}

function Info({ label, value, title }: { label: string; value?: string | null; title?: string }) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value || '—'}</dd>
    </div>
  );
}
