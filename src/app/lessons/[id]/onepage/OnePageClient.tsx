'use client';

// ============================================================
// 一页速读（P0-3）
// 目的：给教师一张能单独打印的 A4——结论、情智判读、亮点与动作，
//       全量证据链留在完整报告里。教研会签到、档案袋、留给自己的便签，
//       都只需要这一张。
// 数据全部复用已有报告，不新增采集、不新增评分。
// ============================================================

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Printer, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  lessonsApi,
  analysisApi,
  ApiError,
  type LessonDetail,
  type StoredReport,
} from '@/lib/api/client';
import EssenceOnePager from '@/components/report/EssenceOnePager';

export default function OnePageClient() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [report, setReport] = useState<StoredReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [l, r] = await Promise.all([lessonsApi.get(id), analysisApi.get(id)]);
        if (cancelled) return;
        setLesson(l);
        setReport(r);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return;
        }
        if (e instanceof ApiError && e.status === 404) {
          setError('这节课不存在，或你没有查看它的权限。');
          return;
        }
        setError('单页版没能加载出来，请回完整报告页重试。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const handlePrint = () => window.print();

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      {/* 打印：A4 一页，去掉外壳留白 */}
      <style>{`@media print { @page { size: A4; margin: 12mm; } .onepage-noprint { display: none !important; } }`}</style>

      <div className="mx-auto w-full max-w-[210mm] px-4 py-4 print:max-w-none print:px-0 print:py-0">
        {/* 操作条（打印不出现） */}
        <div className="onepage-noprint mb-3 flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/lessons/${id}?tab=report`}>
              <ArrowLeft className="mr-2 h-4 w-4" /> 返回完整报告
            </Link>
          </Button>
          <Button size="sm" onClick={handlePrint} disabled={!report}>
            <Printer className="mr-2 h-4 w-4" /> 打印 / 存 PDF
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl bg-background px-6 py-16 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在整理这一页…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-dashed border-border bg-background px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" asChild className="mt-3">
              <Link href={`/lessons/${id}?tab=report`}>返回完整报告</Link>
            </Button>
          </div>
        ) : report ? (
          <div className="rounded-xl bg-background p-5 shadow-card print:rounded-none print:p-0 print:shadow-none">
            {/* 抬头 */}
            <header className="mb-3 border-b border-border pb-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="truncate text-base font-bold text-foreground">
                    {lesson?.title ?? '课堂分析'} · 一页速读
                  </h1>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {[lesson?.school, lesson?.grade_class, lesson?.teacher_name]
                      .filter(Boolean)
                      .join(' ｜ ') || '—'}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[10px] leading-relaxed text-muted-foreground">
                  {report.result.standard_name ?? '情智相长'} v{report.result.standard_version}
                  <br />
                  {new Date(report.result.generated_at).toLocaleDateString('zh-CN')}
                </div>
              </div>
            </header>

            <EssenceOnePager report={report.result} />

            {/* 落款与声明 */}
            <footer className="mt-3 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
              <p>
                <span className="font-medium text-foreground/80">报告性质：</span>
                本页用于教学改进与自我反思，不用于人事评价、职称评审或教师排名；是否分享给他人由授课教师决定。AI
                判定可能有偏差，任一维度分数均可由教研员人工终裁。
              </p>
              <p className="mt-1">
                评价标准：{report.result.standard_name ?? '情智相长课堂评价标准'} v
                {report.result.standard_version} ｜ 完整证据链见完整报告 ｜ 授课教师签名：＿＿＿＿＿
              </p>
            </footer>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-background px-6 py-12 text-center">
            <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">这节课还没有生成分析报告</p>
            <p className="mt-1 text-xs text-muted-foreground/80">
              完成数据接入与标注后，到「融合分析」运行引擎即可生成
            </p>
            <Button variant="outline" size="sm" asChild className="mt-3">
              <Link href={`/lessons/${id}?tab=analyze`}>去融合分析</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
