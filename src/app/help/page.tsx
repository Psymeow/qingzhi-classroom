import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, CheckCircle2, CircleHelp, FileText, Target } from 'lucide-react';

export const metadata: Metadata = { title: '使用指南 · 情智相长' };

// ============================================================
// 使用指南（V1.11）
// 目标：替代口头培训。新教师 3 分钟能自己走完「准备材料 → 跑分析 → 读报告 → 下一次怎么改」。
// 口径与评分引擎保持一致：缺材料不计分、多源加权、五维权重、两链对账。
// ============================================================

const TOC = [
  { id: 'before', label: '一、开始之前：先备哪几样材料' },
  { id: 'flow', label: '二、一节课的完整流程' },
  { id: 'read', label: '三、报告怎么读（情智相长视角）' },
  { id: 'score', label: '四、分数是怎么算出来的' },
  { id: 'faq', label: '五、常见问题' },
  { id: 'checklist', label: '六、材料准备清单' },
];

const MATERIALS = [
  {
    name: '课堂转写文稿',
    level: '必选（或用音视频自动识别）',
    why: '课堂里「老师说了什么、学生说了什么」的全部证据。没有它，绝大多数维度无法评价。',
    tip: '直接在「数据接入」上传录音/录像，系统自动抽取音轨识别为逐字稿；也可粘贴已有文稿。学生姓名请替换为「生1」「生2」。',
  },
  {
    name: '学生任务单',
    level: '推荐',
    why: '看学生真正写下了什么——思维过程、错误类型、分层达成，是「思维有没有发生」最硬的证据。',
    tip: '拍照或上传 Word/PDF，系统解析成文本后参与评分。',
  },
  {
    name: '观察记录',
    level: '推荐',
    why: '记录课堂里转写抓不到的东西：小组分工、学生表情与坚持、突发处理。',
    tip: '按时间点或环节写要点即可，不需要长文。',
  },
  {
    name: '教学设计（教案）',
    level: '可选',
    why: '用于判断「设计意图」类指标：目标是否情智双线、任务是否有梯度。',
    tip: '上传教案文档，仅参与有设计依据的指标，不影响课堂表现类指标。',
  },
];

const FLOW = [
  {
    title: '建课例',
    body: '填标题、授课教师、学校班级、课型（新授/复习/讲评/练习/专题）。课型决定加载哪一套课型要点模型，选错会导致要点评价偏题。',
  },
  {
    title: '传材料',
    body: '按上面四类上传。材料越全，「缺材料不评」的项越少，报告越完整；只有转写也能出报告，但会明确标注哪些项因缺材料未评。',
  },
  {
    title: '跑分析',
    body: '点击开始分析。系统先做多源解析，再按「五维 → 二级指标 → 观察点」三层评分，最后生成情智评语。通常 1–3 分钟，AI 繁忙时可重试。',
  },
  {
    title: '读报告',
    body: '先看顶部「一页速读」，再看五维与证据，需要复核时展开 57 个观察点与原文证据。',
  },
  {
    title: '导出与复用',
    body: '右上角可打印 / 存 PDF，或下载独立 HTML 报告（手机浏览器也可用）。下一节课只改「下一节课就能改」里的三条动作。',
  },
];

const DIMENSIONS = [
  { code: 'D1', name: '情智融合教学设计', weight: '0.20', focus: '目标与任务中的情智双线融合' },
  { code: 'D2', name: '数学高阶思维发展', weight: '0.25', focus: '策略型、批判型、创新型思维水平' },
  { code: 'D3', name: '数学情感素养培育', weight: '0.25', focus: '兴趣韧性、交流协作、理性与价值认同' },
  { code: 'D4', name: '情智共生课堂实施', weight: '0.20', focus: '教师融合实施与学生综合表现' },
  { code: 'D5', name: '反思反馈与素养生成', weight: '0.10', focus: '过程性证据、反馈调节与素养进阶' },
];

const FAQ = [
  {
    q: '为什么某个维度显示「—」？',
    a: '该维度下所有指标在本次材料里都没有找到表现依据，或者所需材料本次没提交。系统不会把「没材料」当 0 分，这类项不计入均分，只会在报告里提示补材料。',
  },
  {
    q: '为什么总分大多在 5–7 分之间？',
    a: '五维是 0–10 分制，且每档都有行为锚点：9–10 是典范、7–8 良好、5–6 中等、3–4 薄弱、0–2 缺失。常规课落在 5–7 是正常区间。这个分数用来和自己比、和同类课比，不做评优排名。',
  },
  {
    q: '「一页速读」里的认知侧、情感侧是什么意思？',
    a: '认知侧取「数学高阶思维」（D2）维度分，情感侧取「数学情感素养」（D3）维度分，都以 0–100 展示，与下方五维素养表同源同尺。两者衡量的是不同向度，分别看水平，不作高低比较。融合落地是「情智融合设计」（D1）与「情智共生实施」（D4）两个维度的均值。',
  },
  {
    q: '情智判读有哪几种状态？',
    a: '情智俱佳（两个向度都在良好以上）、情智稳步（都在中段）、情智待启（都还有距离）、材料不足（缺转写等关键材料）。判读取两个向度的共同水平，不比较认知与情感的高下。',
  },
  {
    q: 'AI 评语会改变分数吗？',
    a: '不会。评分由规则模型与多源加权给出，AI 只负责解读与给建议。评语里标了「AI 生成 · 仅作参考」。',
  },
  {
    q: '为什么没有课型要点评价？',
    a: '建课例时没指定课型，或分析时没开启 AI 深度分析。补上后重新分析即可。',
  },
  {
    q: '分数被质疑怎么办？',
    a: '报告里每个分数都能下钻：维度 → 指标 → 观察点 → 引用原文。点证据会跳到「数据接入」的原文并高亮。需要人工拍板时，教研员可做人工终裁，报告会保留 AI 分 → 终裁分的双列留痕。',
  },
  {
    q: '能重跑吗？删掉课例会怎样？',
    a: '可以随时重新运行分析，报告按最新一次生成结果展示。删除课例会连同其材料、标注、报告一起删除，且不可恢复。',
  },
];

export default function HelpPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <BookOpen className="h-5 w-5 text-primary" /> 使用指南
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        3 分钟看懂：材料怎么准备、报告怎么读、分数怎么来、下一节课改什么。
      </p>

      {/* 目录 */}
      <nav className="mt-5 rounded-xl border border-border/70 bg-card/60 p-3">
        <div className="text-[11px] font-medium text-muted-foreground">目录</div>
        <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {TOC.map((t) => (
            <li key={t.id}>
              <a href={`#${t.id}`} className="text-xs text-primary hover:underline">
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-8 space-y-9 text-sm leading-7 text-foreground/90">
        {/* 一、材料 */}
        <section id="before" className="scroll-mt-20">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <FileText className="h-4 w-4 text-primary" /> 一、开始之前：先备哪几样材料
          </h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            材料不是越多越好，而是「越对越好」。缺材料不会扣分，只会让对应项不参与评价——所以宁可少交，也不要交无关内容。
          </p>
          <div className="mt-3 space-y-2.5">
            {MATERIALS.map((m) => (
              <div key={m.name} className="rounded-xl border border-border/70 bg-card/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-foreground">{m.name}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{m.level}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">{m.why}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">怎么准备：{m.tip}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 二、流程 */}
        <section id="flow" className="scroll-mt-20">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" /> 二、一节课的完整流程
          </h2>
          <ol className="mt-2 space-y-2.5">
            {FLOW.map((s, i) => (
              <li key={s.title} className="flex gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[11px] font-medium text-white">
                  {i + 1}
                </span>
                <div>
                  <div className="text-[13px] font-medium text-foreground">{s.title}</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* 三、读报告 */}
        <section id="read" className="scroll-mt-20">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Target className="h-4 w-4 text-primary" /> 三、报告怎么读（情智相长视角）
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            这份报告不是「给老师打分」，而是回答一个问题：<span className="text-foreground/80">这节课里，情感体验和思维发展是怎样互相支撑的？</span>
            所以先看关系，再看分数。
          </p>
          <div className="mt-3 space-y-2.5 text-xs leading-relaxed">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3">
              <div className="font-medium text-primary">第 1 步：顶部「情智相长 · 一页速读」</div>
              <p className="mt-1 text-foreground/85">
                看三个数：认知侧（高阶思维）、情感侧（情感素养）、融合落地（设计与实施均值）。再看徽章给的情智判读，以及「情智怎么互相作用」那一句。
                最下面两栏，是本课立住了什么（2 条）和下一节课就能改（3 条）。
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/60 p-3">
              <div className="font-medium text-foreground">第 2 步：五维雷达与得分条</div>
              <p className="mt-1 text-foreground/80">
                看形状而不是看面积：哪一维明显凹进去，就是这节课的结构性短板。权重见下表。
              </p>
              <div className="mt-2 overflow-hidden rounded-lg border border-border/60">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">维度</th>
                      <th className="px-2 py-1 text-left font-medium">名称</th>
                      <th className="px-2 py-1 text-left font-medium">权重</th>
                      <th className="px-2 py-1 text-left font-medium">看什么</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIMENSIONS.map((d) => (
                      <tr key={d.code} className="border-t border-border/50">
                        <td className="px-2 py-1 text-muted-foreground">{d.code}</td>
                        <td className="px-2 py-1 text-foreground/90">{d.name}</td>
                        <td className="px-2 py-1 tabular-nums text-foreground/90">{d.weight}</td>
                        <td className="px-2 py-1 text-muted-foreground">{d.focus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/60 p-3">
              <div className="font-medium text-foreground">第 3 步：点证据，回到原话</div>
              <p className="mt-1 text-foreground/80">
                每个维度、指标的判定都挂着原文证据。点一下会跳到「数据接入」里的对应原句并选中；找不到原文时会以琥珀色提示「未匹配」，
                这通常意味着证据来自任务单或观察记录，而不是转写。
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-card/60 p-3">
              <div className="font-medium text-foreground">第 4 步：57 个观察点（需要复核时再看）</div>
              <p className="mt-1 text-foreground/80">
                认知 11 个指标、情感 8 个指标，共 57 个观察点，是打分的最底层依据。日常看报告不必逐条读；要跟老师解释分数、或有人质疑时，
                从这里往下钻最有力。
              </p>
            </div>
          </div>
        </section>

        {/* 四、口径 */}
        <section id="score" className="scroll-mt-20">
          <h2 className="text-sm font-semibold text-foreground">四、分数是怎么算出来的</h2>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-foreground/85">
            <p>
              <span className="font-medium">① 三层结构。</span>五维（权重合计 1）→ 二级指标（维度内等权）→ 观察点（指标内等权）。
              维度分由其下二级指标聚合，老师可以自己拿计算器验算。
            </p>
            <p>
              <span className="font-medium">② 多源加权。</span>转写 0.4、任务单 0.25、观察记录 0.2、教案 0.15、人工标注 0.15。
              某一源没有数据时会自动按剩余来源归一化，不会因为少交材料而压低分数。
            </p>
            <p>
              <span className="font-medium">③ 缺材料不评，不等于 0 分。</span>没有材料支撑的观察点留空、不进分母；材料齐备但没找到表现证据的，才是真实的低表现。
              两者在报告里用不同提示区分。
            </p>
            <p>
              <span className="font-medium">④ 两链对账。</span>同一批指标既由「维度直评」给出分数，也由「57 观察点聚合」给出分数，两者差距超过阈值会标「待复核」，
              提示这份报告需要人工看一眼。目标平均差控制在 1.0 分以内。
            </p>
            <p>
              <span className="font-medium">⑤ 人工终裁。</span>教研员可以覆盖维度分并写理由，报告同时保留 AI 分与终裁分，任何人回看都知道改了什么、为什么改。
            </p>
          </div>
        </section>

        {/* 五、FAQ */}
        <section id="faq" className="scroll-mt-20">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CircleHelp className="h-4 w-4 text-primary" /> 五、常见问题
          </h2>
          <div className="mt-2 space-y-2">
            {FAQ.map((f) => (
              <div key={f.q} className="rounded-xl border border-border/70 bg-card/60 p-3">
                <div className="text-[13px] font-medium text-foreground">{f.q}</div>
                <p className="mt-1 text-xs leading-relaxed text-foreground/80">{f.a}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 六、清单 */}
        <section id="checklist" className="scroll-mt-20">
          <h2 className="text-sm font-semibold text-foreground">六、材料准备清单（可打印）</h2>
          <div className="mt-2 rounded-xl border border-border/70 bg-card/60 p-3">
            <ul className="space-y-1.5 text-xs text-foreground/85">
              <li>□ 课堂转写文稿（或录音/录像原文件）已上传</li>
              <li>□ 学生姓名已替换为编号</li>
              <li>□ 学生任务单已拍照/上传（含典型错误样例更好）</li>
              <li>□ 观察记录已写（小组分工、学生反应、突发处理）</li>
              <li>□ 教案已上传（可选，用于设计类指标）</li>
              <li>□ 课型已选对（新授/复习/讲评/练习/专题）</li>
              <li>□ 授课教师、学校、班级信息已填（用于报告落款）</li>
            </ul>
          </div>
        </section>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3 text-xs">
        <Link href="/" className="text-primary hover:underline">
          返回工作台
        </Link>
        <Link href="/privacy" className="text-muted-foreground hover:underline">
          数据与隐私说明
        </Link>
      </div>
    </main>
  );
}
