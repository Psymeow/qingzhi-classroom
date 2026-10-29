import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TableLayoutType,
  TextRun,
  VerticalAlign,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';
import type {
  AnalysisReport,
  DimensionResult,
  EssenceIndicatorResult,
  LessonTypeViewpointResult,
} from '@/lib/evaluation/types';
import { SOURCE_LABEL } from '@/lib/evaluation/types';
import { EVENT_CATEGORY_LABEL } from '@/lib/evaluation/annotation-types';
import type { TimelineEvent } from '@/lib/evaluation/annotation-types';
import type { DimMeta } from '@/components/annotation/DimensionScores';
import { METHODOLOGY_NOTE, collectBibliography } from '@/lib/report/theory-anchors';

/* ------------------------------------------------------------------ *
 * 报告 Word 导出（服务端生成 .docx）
 *
 * 为什么不复用页面 DOM：
 *   页面导出走「克隆 DOM + 内联样式」，但报告里所有折叠区（课型要点、内涵观察点、
 *   维度解读）都是条件渲染或 Radix unmount——closed 时内容根本不在 DOM 里，
 *   克隆出来的只剩一圈空卡片边框（用户看到的"白条"）。
 *   Word 版直接吃分析结果数据，与页面折叠状态无关，结构永远完整。
 *
 * 图表取舍：
 *   雷达图、座位关系图是运行时绘制的画布/SVG，无法进入 Word；
 *   对应位置改用等价的表格与文字刻度，信息不丢。
 * ------------------------------------------------------------------ */

/** 分数 → 十六进制色（与前端 scoreTextClass 同档位边界） */
function scoreHex(score: number | null | undefined): string {
  if (score === null || score === undefined) return '6B7280';
  if (score >= 8.1) return '059669';
  if (score >= 6.1) return '0284C7';
  if (score >= 4.1) return 'D97706';
  if (score >= 2.1) return 'EA580C';
  return 'E11D48';
}

const BRAND = '4F46E5'; // 主色（indigo-600）
const INK = '1F2937'; // 正文
const MUTED = '6B7280'; // 次要文字
const LINE = 'E5E7EB'; // 边框
const HEAD_BG = 'EEF2FF'; // 表头底纹
const ZEBRA_BG = 'F9FAFB'; // 斑马纹
const WARN_BG = 'FFFBEB'; // 提示底纹
const OK_BG = 'ECFDF5'; // 亮点底纹

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const fmt = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);

/** 正文 run */
function t(text: string, opts: Partial<IRunOptions> = {}): TextRun {
  return new TextRun({ text, color: INK, size: 21, ...opts });
}

/** 段落（接受单个 run/字符串或数组，调用处两种写法都有） */
function p(
  children: TextRun | string | (TextRun | string)[],
  opts: Partial<IParagraphOptions> = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: 100, line: 320 },
    children: (Array.isArray(children) ? children : [children]).map((c) =>
      typeof c === 'string' ? t(c) : c,
    ),
    ...opts,
  });
}

/** 章标题（Heading 1） */
function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 4 } },
    children: [t(text, { bold: true, size: 30, color: BRAND })],
  });
}

/** 节标题（Heading 2） */
function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [t(text, { bold: true, size: 24, color: INK })],
  });
}

/** 小标题（Heading 3） */
function h3(text: string, color: string = INK): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 80 },
    children: [t(text, { bold: true, size: 21, color })],
  });
}

/** 章节导语：先说这一节回答什么，再给数据 */
function hint(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160 },
    children: [t(text, { italics: true, color: MUTED, size: 19 })],
  });
}

/** 项目符号段（缩进 + 方块前缀，避免依赖 Word 自动列表在不同版本的表现不一致） */
function bullet(text: string, color: string = INK, indent = 360): Paragraph {
  return new Paragraph({
    indent: { left: indent },
    spacing: { after: 60, line: 300 },
    children: [
      t('■ ', { color: BRAND, size: 12 }),
      t(text, { color, size: 21 }),
    ],
  });
}

const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const CELL_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 2, color: LINE },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: LINE },
  left: { style: BorderStyle.SINGLE, size: 2, color: LINE },
  right: { style: BorderStyle.SINGLE, size: 2, color: LINE },
};

function cell(
  children: (Paragraph | TextRun)[],
  opts: { bg?: string; span?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; borders?: typeof CELL_BORDERS } = {},
): TableCell {
  return new TableCell({
    children: children.map((c) =>
      c instanceof Paragraph
        ? c
        : new Paragraph({ spacing: { after: 40, line: 280 }, children: [c] }),
    ),
    shading: opts.bg ? { type: ShadingType.SOLID, color: opts.bg } : undefined,
    columnSpan: opts.span,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    borders: opts.borders ?? CELL_BORDERS,
  });
}

/** 数据表：首行表头 + 斑马纹 */
/**
 * 版心宽度（DXA / twips）：docx 默认 A4 纵向 11906，减去本文件左右边距各 1000。
 * 列宽全部按这个宽度按比例换算，保证表格占满版心且各列边界与表头严格对齐。
 */
const CONTENT_WIDTH_TWIPS = 11906 - 1000 - 1000;

/**
 * 把「相对权重」换算成 DXA 绝对列宽。
 *
 * 调用点传的是相对值（多数表总和 10000，个别 9000/9400），不能直接当绝对宽度用——
 * 直接用会让表格宽度随总和浮动，且总和不等于版心时右侧留白。这里按比例归一到版心，
 * 余数补到最大的一列上，使总和严格等于 CONTENT_WIDTH_TWIPS。
 */
function normalizeWidths(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    const even = Math.floor(CONTENT_WIDTH_TWIPS / weights.length);
    return weights.map(() => even);
  }
  const widths = weights.map((w) => Math.floor((w / total) * CONTENT_WIDTH_TWIPS));
  let rest = CONTENT_WIDTH_TWIPS - widths.reduce((a, b) => a + b, 0);
  // 归一化取整吃掉了余数，补给最宽的列（权重最大 = 文字列），避免误差落到窄列上
  const widest = widths.indexOf(Math.max(...widths));
  widths[widest] += rest;
  rest = 0;
  return widths;
}

/**
 * @param weights 各列相对权重（不必归一化，函数内部按比例换算到版心宽度）。
 *   长度必须等于该表的实际列数（含 columnSpan 合并后的列）。
 * @param rows    表格行。表头行与每一条数据行共用同一套列宽——这是列边界对齐的关键。
 */
function table(weights: number[], rows: TableCell[][], opts: { header?: boolean } = {}): Table {
  const header = opts.header !== false;
  const widths = normalizeWidths(weights);
  // FIXED + 显式 columnWidths：每列表头与数据严格同宽。
  // 之前是 AUTOFIT 且不传列宽（首参 _widths 从未被使用），Word 逐行按内容猜宽度——
  // 「编号」列只有 1/2/3 却分到大量空间，长文字的「要点」列被挤压，表头与数据行的
  // 分列结果不一致，看起来就是表格错位、渲染坏了。
  //
  // 但只给 table 级 columnWidths 仍不够：那只是 w:tblGrid，Word 对没有 w:tcW 的
  // 单元格仍会按内容重算——表头「编号」两字窄、「要点」两字宽，于是表头行被压成
  // 一列独大、其余挤扁竖排。所以这里把 widths 按列序注入到每一个 TableCell。
  // 注入在本函数内完成，表头与数据走的是同一份 widths 的同一个下标，天然对齐。
  const trs = rows.map((row, rowIdx) => {
    let col = 0;
    const cells = row.map((cell) => {
      const span = Math.max(1, cell.options.columnSpan ?? 1);
      // 合并列占多格时宽度累加，保证整行仍然铺满版心
      const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
      col += span;
      // docx 的 properties 在类型上标为 private，但运行时是公开实例，且 setColumnWidth
      // 是官方暴露的列宽入口（会正确产出 w:tcW）。这里断言，避免为此复制一遍 TableCell。
      (
        cell as unknown as {
          properties: {
            setColumnWidth: (size: number, type: (typeof WidthType)[keyof typeof WidthType]) => void;
          };
        }
      ).properties.setColumnWidth(w, WidthType.DXA);
      return cell;
    });
    return new TableRow({ children: cells, tableHeader: header && rowIdx === 0 });
  });
  return new Table({
    width: { size: CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: trs,
  });
}

function headCell(text: string, span?: number, align?: (typeof AlignmentType)[keyof typeof AlignmentType]): TableCell {
  return cell([new Paragraph({ spacing: { after: 0, line: 280 }, alignment: align, children: [t(text, { bold: true, color: '3730A3', size: 19 })] })], { bg: HEAD_BG, span, align });
}

function bodyCell(text: string, opts: { bold?: boolean; color?: string; bg?: string; span?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): TableCell {
  return cell([new Paragraph({ spacing: { after: 0, line: 280 }, alignment: opts.align, children: [t(text, { bold: opts.bold, color: opts.color ?? INK, size: 19 })] })], { bg: opts.bg, span: opts.span, align: opts.align });
}

/** 档位文字色（中文档位名） */
function levelColor(level: string | null): string {
  if (!level) return MUTED;
  if (level.includes('优秀')) return '059669';
  if (level.includes('良好')) return '65A30D';
  if (level.includes('中等')) return 'D97706';
  if (level.includes('待提升')) return 'EA580C';
  if (level.includes('欠')) return 'E11D48';
  return INK;
}

/** 提示条：一行带底纹的说明（缺材料、依据不足、待复核等） */
function notice(text: string, bg: string = WARN_BG, color: string = '92400E'): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          cell(
            [new Paragraph({ spacing: { after: 0, line: 290 }, children: [t(text, { color, size: 19 })] })],
            { bg, borders: { top: { style: BorderStyle.SINGLE, size: 2, color: bg }, bottom: { style: BorderStyle.SINGLE, size: 2, color: bg }, left: { style: BorderStyle.SINGLE, size: 18, color: color }, right: { style: BorderStyle.SINGLE, size: 2, color: bg } } },
          ),
        ],
      }),
    ],
  });
}

export interface ExportDocxInput {
  report: AnalysisReport;
  /** StoredReport 上的总分（0-100）与等级 */
  totalScore: number;
  totalLevel: string | null;
  isCalibrated: boolean;
  lessonTitle: string;
  lessonMeta: { teacher_name?: string | null; school?: string | null; grade_class?: string | null } | null;
  dimensions: DimMeta[];
  indicatorNames?: Record<string, string>;
  events?: TimelineEvent[];
  seatingStudentCount?: number;
  interactionCount?: number;
  /** 导出人（登录教师名），用于落款 */
  exporterName?: string | null;
}

/**
 * 由分析结果构建完整 Word 报告。
 * 任何字段都可能缺失（旧快照无 AI 评语、无课型评估、无内涵观察点），全部容错跳过。
 */
export async function buildReportDocx(input: ExportDocxInput): Promise<Buffer> {
  const { report } = input;
  const children: (Paragraph | Table)[] = [];

  const dimName = (code: string) => input.dimensions.find((d) => d.code === code)?.name ?? code;
  const indicatorName = (code: string, fallback?: string) =>
    fallback ?? input.indicatorNames?.[code] ?? code;

  /* ---------------- 封面头 ---------------- */
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 80 },
      children: [t(input.lessonTitle || '课堂分析报告', { bold: true, size: 40, color: BRAND })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [t('课堂情智相长分析报告', { size: 26, color: INK, bold: true })],
    }),
  );

  // 落款信息表
  const metaRows: TableCell[][] = [
    [
      bodyCell('学校', { bold: true, bg: ZEBRA_BG }),
      bodyCell(input.lessonMeta?.school || '—'),
      bodyCell('班级', { bold: true, bg: ZEBRA_BG }),
      bodyCell(input.lessonMeta?.grade_class || '—'),
    ],
    [
      bodyCell('授课教师', { bold: true, bg: ZEBRA_BG }),
      bodyCell(input.lessonMeta?.teacher_name || '—'),
      bodyCell('评价人', { bold: true, bg: ZEBRA_BG }),
      bodyCell(input.exporterName || '—'),
    ],
    [
      bodyCell('评价标准', { bold: true, bg: ZEBRA_BG }),
      bodyCell(`${report.standard_name ?? report.standard_code} v${report.standard_version}`, { span: 3 }),
    ],
    [
      bodyCell('生成时间', { bold: true, bg: ZEBRA_BG }),
      bodyCell(new Date(report.generated_at).toLocaleString('zh-CN'), { span: 3 }),
    ],
  ];
  children.push(table([1600, 3400, 1600, 3400], metaRows, { header: false }));
  children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));

  /* ---------------- 综合得分 ---------------- */
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 60 },
      children: [t('综合得分', { size: 20, color: MUTED })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({ text: input.totalScore.toFixed(1), bold: true, size: 64, color: scoreHex(input.totalScore / 10) }),
        new TextRun({ text: '  / 100', size: 22, color: MUTED }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [t('满分 100 · 由五维加权平均 × 10 换算', { size: 18, color: MUTED })],
    }),
  );

  // 情智双侧速读：认知/情感取五维直评口径（D2 / D3）×10 → 0-100，与页面 EssenceOnePager 同口径。
  // 不做认知 vs 情感的高低比较：两者衡量不同向度，「智强情弱」这类结论本身不成立。
  const dimOf = (code: string) =>
    report.dimension_results.find((d) => d.dimension_code === code)?.score ?? null;
  const dim100 = (v: number | null) => (v === null ? null : v * 10);
  const cog100 = dim100(dimOf('D2'));
  const aff100 = dim100(dimOf('D3'));
  // V1.32 不再输出「融合落地」（D1 与 D4 的平均）：D1 量设计意图、D4 量课堂实然，
  // 平均既不代表设计水平也不代表实施水平，还会把「设计好但落地打折」的落差信号抹掉。
  // D1/D4 的完整展示仍在下方五维表。

  // 判读只看两个向度的共同水平（短板），不比较高下
  const stateLabel = (() => {
    if (cog100 === null || aff100 === null) return '材料不足';
    const floor = Math.min(cog100, aff100);
    if (floor >= 70) return '情智俱佳';
    if (floor >= 60) return '情智稳步';
    return '情智待启';
  })();

  children.push(
    table(
      // 列宽按 3 列分配：两列分数窄、判读列宽（文字更长）
      [3200, 2800, 4000],
      [
        [
          headCell('认知素养（高阶思维 D2）'),
          headCell('情感素养（D3）', undefined, AlignmentType.CENTER),
          headCell('判读', undefined, AlignmentType.CENTER),
        ],
        [
          bodyCell(cog100 === null ? '—' : `${cog100.toFixed(1)} / 100`, { bold: true, color: scoreHex((cog100 ?? 0) / 10), align: AlignmentType.CENTER }),
          bodyCell(aff100 === null ? '—' : `${aff100.toFixed(1)} / 100`, { bold: true, color: scoreHex((aff100 ?? 0) / 10), align: AlignmentType.CENTER }),
          bodyCell(stateLabel, { bold: true, color: BRAND, align: AlignmentType.CENTER }),
        ],
      ],
    ),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  );

  /* ---------------- AI 教学评语 ---------------- */
  const cm = report.ai_commentary;
  if (cm) {
    children.push(h2('AI 教学评语'));
    children.push(hint('由 AI 依据本次材料生成，仅作参考，不改变任何评分；任一分数均可人工终裁后重新生成。'));
    if (cm.summary) children.push(p(cm.summary));
    if (cm.highlights?.length) {
      children.push(h3('课堂亮点', '047857'));
      cm.highlights.forEach((x) => children.push(bullet(x, INK)));
    }
    if (cm.suggestions?.length) {
      children.push(h3('改进建议', 'B45309'));
      cm.suggestions.forEach((x) => children.push(bullet(x, INK)));
    }
    if (cm.essence_coupling) {
      children.push(h3('情智关系解读'));
      children.push(p(cm.essence_coupling));
    }
    if (cm.action_items?.length) {
      children.push(h3('下一节课可以这样改'));
      cm.action_items.forEach((x, i) => children.push(bullet(`${CN_NUM[i] ?? i + 1}. ${x}`, INK)));
    }
  }

  const needReviewCount = report.dimension_results.filter((d) => d.need_review).length;
  if (needReviewCount > 0) {
    children.push(
      new Paragraph({ spacing: { before: 160, after: 0 }, children: [] }),
      notice(`本报告有 ${needReviewCount} 个维度存在多源分歧，已在各维度标注「待复核」，可由教研员人工终裁后重新生成。`),
      new Paragraph({ spacing: { after: 120 }, children: [] }),
    );
  }

  /* ================= 第一章 五维拆开看 ================= */
  children.push(h1('一、五维拆开看'));
  children.push(hint('这一节回答「五个维度各几分、这一维到底表现得怎么样、下一步怎么改」；标「待复核」的维度还需老师人工再确认一遍。'));

  // 材料依据
  const availSources = (Object.keys(SOURCE_LABEL) as Array<keyof typeof SOURCE_LABEL>).filter(
    (k) => report.source_availability?.[k],
  );
  children.push(
    p([
      t('评价依据：', { bold: true, size: 19 }),
      t(availSources.length ? availSources.map((k) => SOURCE_LABEL[k]).join('、') : '无', { size: 19, color: MUTED }),
      t('　·　系统综合多源材料评分，材料不足的来源自动降权。', { size: 19, color: MUTED }),
    ]),
  );

  if (report.calibrations?.length) {
    children.push(h3('人工终裁留痕', '047857'));
    const calRows: TableCell[][] = [[headCell('维度'), headCell('AI 原分'), headCell('终裁分'), headCell('终裁人 / 日期'), headCell('理由')]];
    report.calibrations.forEach((c) => {
      const dr = report.dimension_results.find((x) => x.dimension_code === c.dimension_code);
      calRows.push([
        bodyCell(dimName(c.dimension_code)),
        bodyCell(dr?.ai_score === null || dr?.ai_score === undefined ? '—' : dr.ai_score.toFixed(1), { align: AlignmentType.CENTER }),
        bodyCell(c.final_score === null || c.final_score === undefined ? '—' : c.final_score.toFixed(1), { bold: true, align: AlignmentType.CENTER }),
        bodyCell([c.reviewer, c.reviewed_at ? new Date(c.reviewed_at).toLocaleDateString('zh-CN') : ''].filter(Boolean).join(' · ') || '—'),
        bodyCell(c.review_note || '—'),
      ]);
    });
    children.push(table([1800, 1200, 1200, 2400, 3400], calRows));
  }

  report.dimension_results.forEach((d, i) => {
    children.push(...renderDimension(d, i, dimName, indicatorName));
  });

  /* ================= 第二章 课型专属要点 ================= */
  const lt = report.lesson_type_eval;
  children.push(h1('二、课型专属要点分析'));
  if (lt && lt.llm_used) {
    children.push(
      p([
        t(`${lt.lesson_type_name}`, { bold: true, size: 22, color: BRAND }),
        t(`　手册小节 ${lt.manual_section}`, { size: 19, color: MUTED }),
      ]),
      p(lt.summary),
      table(
        [2500, 2500, 2500, 2500],
        [
          [
            headCell('课型均分', undefined, AlignmentType.CENTER),
            headCell('折算百分制', undefined, AlignmentType.CENTER),
            headCell('已评要点', undefined, AlignmentType.CENTER),
            headCell('课型来源', undefined, AlignmentType.CENTER),
          ],
          [
            bodyCell(`${fmt(lt.total_score)} / 10`, { bold: true, color: scoreHex(lt.total_score), align: AlignmentType.CENTER }),
            bodyCell(fmt(lt.total_score_100), { bold: true, align: AlignmentType.CENTER }),
            bodyCell(`${lt.scored_points} / ${lt.total_points}`, { align: AlignmentType.CENTER }),
            bodyCell(lt.source === 'manual' ? '人工指定' : `自动识别${lt.confidence !== null && lt.confidence !== undefined ? `（置信 ${Math.round(lt.confidence * 100)}%）` : ''}`, { align: AlignmentType.CENTER }),
          ],
        ],
      ),
      new Paragraph({ spacing: { after: 120 }, children: [] }),
    );
    lt.viewpoints.forEach((vp) => children.push(...renderViewpoint(vp)));
  } else {
    children.push(notice('本课例未生成课型要点评价：未指定课型，或运行分析时未开启 AI 深度分析。'));
  }

  /* ================= 第三章 表一内涵观察点 ================= */
  children.push(h1('三、表一内涵观察点'));
  children.push(hint('认知侧为数学高阶思维 11 项二级指标，情感侧为数学情感素养 8 项二级指标，合计 57 个细化观察点。'));
  const ee = report.essence_eval;
  if (ee && ee.llm_used) {
    children.push(
      table(
        [2500, 2500, 2500, 2500],
        [
          [
            headCell('观察点已评', undefined, AlignmentType.CENTER),
            headCell('观察点总数', undefined, AlignmentType.CENTER),
            headCell('认知侧', undefined, AlignmentType.CENTER),
            headCell('情感侧', undefined, AlignmentType.CENTER),
          ],
          [
            bodyCell(`${ee.scored_points}`, { bold: true, align: AlignmentType.CENTER }),
            bodyCell(`${ee.total_points}`, { align: AlignmentType.CENTER }),
            bodyCell(`${fmt(ee.cognitive.score)} / 10`, { bold: true, color: scoreHex(ee.cognitive.score), align: AlignmentType.CENTER }),
            bodyCell(`${fmt(ee.affective.score)} / 10`, { bold: true, color: scoreHex(ee.affective.score), align: AlignmentType.CENTER }),
          ],
        ],
      ),
      new Paragraph({ spacing: { after: 160 }, children: [] }),
    );
    children.push(...renderEssenceDomain(ee.cognitive, '认知 · 数学高阶思维'));
    children.push(...renderEssenceDomain(ee.affective, '情感 · 数学情感素养'));
  } else {
    children.push(notice('本课例未生成认知·情感观察点：需包含课堂转写文稿并开启 AI 深度分析后运行。'));
  }

  /* ================= 第四章 每条分的出处 ================= */
  children.push(h1('四、每条分的出处'));
  children.push(hint('按来源列出支撑分数的原文与标注；看过上下文再判断分数是否公道，不认同可直接改判。'));
  let hasEvidence = false;
  report.dimension_results.forEach((d, i) => {
    const groups = (d.source_scores ?? []).filter((s) => (s.evidences?.length ?? 0) > 0);
    const dimEv = (d.evidences ?? []).filter(Boolean);
    if (!groups.length && !dimEv.length) return;
    hasEvidence = true;
    children.push(h3(`${CN_NUM[i] ?? i + 1}. ${dimName(d.dimension_code)}（${d.score === null ? '未评' : `${d.score.toFixed(1)} 分`}）`));
    if (dimEv.length) {
      dimEv.forEach((e) => children.push(bullet(`维度证据：${e}`, MUTED)));
    }
    groups.forEach((s) => {
      children.push(
        p([
          t(`${SOURCE_LABEL[s.source] ?? s.source}`, { bold: true, size: 19, color: BRAND }),
          t(`　${fmt(s.score)} / 10　置信 ${Math.round((s.confidence ?? 0) * 100)}%`, { size: 19, color: MUTED }),
        ]),
      );
      s.evidences.forEach((e) => children.push(bullet(e)));
    });
  });
  if (!hasEvidence) {
    children.push(notice('本次分析未留下可引用的原文证据：可能只有人工标注，或各来源材料均无有效摘录。'));
  }

  /* ================= 第五章 课堂现场与材料 ================= */
  children.push(h1('五、课堂现场与材料'));

  const events = [...(input.events ?? [])].sort((a, b) => (a.time_sec ?? 0) - (b.time_sec ?? 0));
  if (events.length) {
    children.push(h3(`关键事件打点（${events.length}）`));
    const evRows: TableCell[][] = [[headCell('时间', undefined, AlignmentType.CENTER), headCell('类别', undefined, AlignmentType.CENTER), headCell('说明')]];
    events.forEach((e) => {
      const mm = Math.floor((e.time_sec ?? 0) / 60).toString().padStart(2, '0');
      const ss = ((e.time_sec ?? 0) % 60).toString().padStart(2, '0');
      evRows.push([
        bodyCell(`${mm}:${ss}`, { bold: true, color: BRAND, align: AlignmentType.CENTER }),
        bodyCell(EVENT_CATEGORY_LABEL[e.category] ?? e.category, { align: AlignmentType.CENTER }),
        bodyCell(e.note || '—'),
      ]);
    });
    children.push(table([1400, 1800, 6800], evRows));
  }

  const seatN = input.seatingStudentCount ?? 0;
  const intN = input.interactionCount ?? 0;
  children.push(
    new Paragraph({ spacing: { before: 160, after: 80 }, children: [] }),
    table(
      [3300, 3300, 3400],
      [
        [
          headCell('座位标注学生数', undefined, AlignmentType.CENTER),
          headCell('互动连线数', undefined, AlignmentType.CENTER),
          headCell('关键事件数', undefined, AlignmentType.CENTER),
        ],
        [
          bodyCell(seatN > 0 ? `${seatN} 人` : '未标注', { bold: seatN > 0, align: AlignmentType.CENTER }),
          bodyCell(intN > 0 ? `${intN} 条` : '未标注', { bold: intN > 0, align: AlignmentType.CENTER }),
          bodyCell(events.length > 0 ? `${events.length} 条` : '无', { align: AlignmentType.CENTER }),
        ],
      ],
    ),
  );
  if (!seatN) {
    children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    children.push(notice('本节课尚未进行座位与互动标注；补做后重新生成分析即可纳入。'));
  }

  /* ================= 第六章 理论依据与参考文献 ================= */
  children.push(h1('六、理论依据与参考文献'));
  children.push(
    p('本评价模型的五个维度并非经验性设定，其构念效度与权重依据可追溯至下列文献。'),
  );
  collectBibliography(report.dimension_results.map((d) => d.dimension_code)).forEach((r, i) =>
    children.push(bullet(`${i + 1}. ${r}`, MUTED)),
  );
  children.push(h3('方法学说明'));
  children.push(p(METHODOLOGY_NOTE));

  children.push(
    new Paragraph({ spacing: { before: 200, after: 0 }, children: [] }),
    notice(
      '报告性质：本报告用于教学改进与自我反思，不用于人事评价、职称评审或教师排名；是否分享给他人、何时查阅，由授课教师决定。AI 判定可能有偏差，任一维度分数均可由教研员人工终裁后重新生成。',
      'F3F4F6',
      '374151',
    ),
  );

  /* ---------------- 落款 ---------------- */
  children.push(
    new Paragraph({
      spacing: { before: 320, after: 0 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 8 } },
      children: [
        t(`学校：${input.lessonMeta?.school || '＿＿＿＿＿'}　　班级：${input.lessonMeta?.grade_class || '＿＿＿＿＿'}　　授课教师：${input.lessonMeta?.teacher_name || '＿＿＿＿＿'}`, { size: 18, color: MUTED }),
      ],
    }),
    new Paragraph({
      spacing: { before: 60, after: 0 },
      children: [
        t(`评价人（签名）：＿＿＿＿＿＿＿＿　　日期：＿＿＿＿年＿＿月＿＿日`, { size: 18, color: MUTED }),
      ],
    }),
    new Paragraph({
      spacing: { before: 60, after: 0 },
      children: [
        t(`评价标准：${report.standard_name ?? '情智相长课堂评价标准'} v${report.standard_version}　·　报告生成时间：${new Date(report.generated_at).toLocaleString('zh-CN')}`, { size: 16, color: MUTED }),
      ],
    }),
  );

  const doc = new Document({
    creator: '情智相长课堂分析工作台',
    title: `${input.lessonTitle} · 课堂情智相长分析报告`,
    description: '课堂多源材料融合分析报告（Word 版）',
    styles: {
      default: {
        document: {
          run: { font: { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '微软雅黑', cs: 'Calibri' }, size: 21, color: INK },
          paragraph: { spacing: { line: 300 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1100, right: 1000, bottom: 1100, left: 1000 },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: '情智相长课堂分析报告 · 第 ', size: 16, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTED }),
                  new TextRun({ text: ' 页', size: 16, color: MUTED }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return (await Packer.toBuffer(doc)) as Buffer;
}

/* ------------------------------------------------------------------ *
 * 维度块：得分 + 二级指标表 + 维度级 AI 解读
 * ------------------------------------------------------------------ */
function renderDimension(
  d: DimensionResult,
  index: number,
  dimName: (code: string) => string,
  indicatorName: (code: string, fallback?: string) => string,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const label = `${CN_NUM[index] ?? index + 1}. ${dimName(d.dimension_code)}`;

  out.push(
    new Paragraph({
      spacing: { before: 280, after: 80 },
      keepNext: true,
      children: [
        t(label, { bold: true, size: 24, color: INK }),
        t(`　${fmt(d.score)} / 10`, { bold: true, size: 24, color: scoreHex(d.score) }),
        d.level_label ? t(`　${d.level_label}`, { bold: true, size: 21, color: levelColor(d.level_label) }) : t(''),
        d.need_review ? t(`　【待复核】`, { bold: true, size: 19, color: 'B45309' }) : t(''),
      ],
    }),
  );

  // 二级指标表
  const inds = d.indicators ?? [];
  if (inds.length) {
    const rows: TableCell[][] = [[headCell('二级指标'), headCell('得分', undefined, AlignmentType.CENTER), headCell('状态', undefined, AlignmentType.CENTER)]];
    inds.forEach((ind) => {
      rows.push([
        bodyCell(indicatorName(ind.indicator_code, ind.name)),
        bodyCell(fmt(ind.score), { bold: true, color: scoreHex(ind.score), align: AlignmentType.CENTER }),
        bodyCell(ind.score === null ? '无评分依据' : ind.need_review ? '待复核' : '正常', {
          color: ind.score === null ? MUTED : ind.need_review ? 'B45309' : '047857',
          align: AlignmentType.CENTER,
        }),
      ]);
    });
    out.push(table([5200, 1800, 3000], rows));
  }

  // 维度级证据
  const evs = (d.evidences ?? []).filter(Boolean);
  if (evs.length) {
    out.push(h3('证据摘要', MUTED));
    evs.slice(0, 6).forEach((e) => out.push(bullet(e, MUTED)));
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * 课型视角块（策略型 / 批判型 / 创新型 …）
 * ------------------------------------------------------------------ */
function renderViewpoint(vp: LessonTypeViewpointResult): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  out.push(
    new Paragraph({
      spacing: { before: 220, after: 80 },
      keepNext: true,
      children: [
        t(vp.name, { bold: true, size: 22, color: BRAND }),
        t(`　均分 ${fmt(vp.score)} / 10`, { bold: true, size: 20, color: scoreHex(vp.score) }),
      ],
    }),
  );

  const scored = vp.points.filter((x) => x.score !== null).length;
  const rows: TableCell[][] = [[headCell('编号', undefined, AlignmentType.CENTER), headCell('要点'), headCell('得分', undefined, AlignmentType.CENTER), headCell('等级', undefined, AlignmentType.CENTER)]];
  vp.points.forEach((pt) => {
    rows.push([
      bodyCell(String(pt.no), { align: AlignmentType.CENTER, color: MUTED }),
      bodyCell(pt.name),
      bodyCell(fmt(pt.score), { bold: true, color: scoreHex(pt.score), align: AlignmentType.CENTER }),
      bodyCell(pt.level_label ?? '—', { color: levelColor(pt.level_label), align: AlignmentType.CENTER }),
    ]);
  });
  // 编号列只有 1/2/3，权重给足即可——但不能太低，太低会被归一化压到 900 以下，
  // 中文表头「编号」两个字会被挤成竖排。950/9100 ≈ 1034 twips，约容 4 个汉字。
  out.push(table([950, 5550, 1100, 1500], rows));

  // 有理有据：只列有理由或有证据的要点，避免整表冗长
  const explained = vp.points.filter((x) => x.reason || (x.evidences?.length ?? 0) > 0);
  if (explained.length) {
    out.push(h3('判定理由与依据', MUTED));
    explained.forEach((pt) => {
      out.push(
        p([
          t(`${pt.no}. ${pt.name}`, { bold: true, size: 19 }),
          t(pt.score === null ? '　（未找到表现依据）' : `　${fmt(pt.score)} 分`, { size: 19, color: MUTED }),
        ]),
      );
      if (pt.reason) out.push(bullet(`理由：${pt.reason}`, MUTED));
      (pt.evidences ?? []).slice(0, 3).forEach((e) => out.push(bullet(`证据：${e}`, MUTED)));
    });
  }

  if (scored === 0) {
    out.push(notice(`「${vp.name}」本次未找到任何要点的表现依据，均分为空不代表零分。`));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 内涵域块（认知 / 情感）：指标 + 观察点
 * ------------------------------------------------------------------ */
function renderEssenceDomain(
  domain: { domain: 'cognitive' | 'affective'; name: string; indicators: EssenceIndicatorResult[]; score: number | null; score_100: number | null; scored_indicators: number; total_indicators: number; scored_points: number; total_points: number },
  fallbackName: string,
): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  const label = domain.domain === 'cognitive' ? '认知 · 数学高阶思维' : '情感 · 数学情感素养';

  out.push(
    new Paragraph({
      spacing: { before: 260, after: 80 },
      keepNext: true,
      children: [
        t(label, { bold: true, size: 24, color: domain.domain === 'cognitive' ? BRAND : '047857' }),
        t(`　${fmt(domain.score)} / 10`, { bold: true, size: 22, color: scoreHex(domain.score) }),
        t(`　（${fmt(domain.score_100)} / 100 · 已评指标 ${domain.scored_indicators}/${domain.total_indicators} · 已评观察点 ${domain.scored_points}/${domain.total_points}）`, { size: 19, color: MUTED }),
      ],
    }),
  );

  const rows: TableCell[][] = [[headCell('二级指标'), headCell('类别'), headCell('均分', undefined, AlignmentType.CENTER)]];
  domain.indicators.forEach((ind) => {
    rows.push([
      bodyCell(ind.name || ind.code),
      bodyCell(ind.category || '—', { color: MUTED }),
      bodyCell(fmt(ind.score), { bold: true, color: scoreHex(ind.score), align: AlignmentType.CENTER }),
    ]);
  });
  out.push(table([5000, 2500, 1800], rows));

  // 观察点明细：只列有分或有说明的，缺失材料单独提示
  const missing = domain.indicators.flatMap((i) => i.points).filter((x) => x.missing_material);
  if (missing.length) {
    out.push(new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }));
    out.push(notice(`${missing.length} 个观察点因本次未提交对应材料而无法评价（如仅交转写文稿时，任务单/观察表专属点不可评），已从均分中剔除。`, 'EFF6FF', '1D4ED8'));
  }

  return out;
}
