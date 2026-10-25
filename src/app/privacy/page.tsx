import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

export const metadata: Metadata = { title: '数据与隐私说明 · 情智相长' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-10">
      <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <ShieldCheck className="h-5 w-5 text-primary" /> 数据与隐私说明
      </div>
      <p className="mt-1 text-xs text-muted-foreground">最后更新：2026 年 10 月</p>

      <div className="mt-6 space-y-5 text-sm leading-7 text-foreground/90">
        <section>
          <h2 className="text-sm font-semibold">一、我们收集什么</h2>
          <p className="mt-1">
            本工作台仅用于课堂教学的形成性评价，收集的内容包括：您上传的课堂转写文稿、观察员记录、学生任务单（经解析后的文本）、
            以及可选的课堂座位与互动标注。系统不主动采集学生姓名、身份证号、家庭住址等个人身份信息。
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold">二、数据如何使用</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>所有材料仅用于本节课例的多源分析、评分与评语生成，以及您本人查看历史课例。</li>
            <li>分析由平台内的规则模型与 AI 服务完成；AI 服务不会将您的内容用于模型训练。</li>
            <li>课例数据按账号隔离，只有课例创建者本人可见，不对其他教师或学校公开。</li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold">三、脱敏建议（上传前请阅读）</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>请将学生姓名替换为编号或代号（如「生 1」「生 2」），座位标注默认即使用编号。</li>
            <li>上传前请删除或遮盖文稿、任务单中与教学评价无关的个人信息（电话、家庭情况、健康信息等）。</li>
            <li>课堂录音/录像可在工作台一键识别为逐字稿（录像自动抽取音轨），识别后与文字转写同等参与分析。</li>
          </ul>
        </section>

        <section>
          <h2 className="text-sm font-semibold">四、存储与删除</h2>
          <p className="mt-1">
            数据存储于平台提供的加密云数据库。您可以随时在工作台删除任意课例，删除后不可恢复。
            如需批量删除或导出您的全部数据，请联系管理员协助处理。
          </p>
        </section>

        <section>
          <h2 className="text-sm font-semibold">五、评价结果的使用边界</h2>
          <p className="mt-1">
            AI 评分与评语为教学改进的参考，不构成对教师或学生的终结性鉴定。数据来源不完整时，报告会显著提示「评价依据不足」，
            此时分数应谨慎解读。
          </p>
        </section>
      </div>

      <div className="mt-8 text-xs text-muted-foreground">
        <Link href="/login" className="text-primary hover:underline">
          返回登录
        </Link>
      </div>
    </main>
  );
}
