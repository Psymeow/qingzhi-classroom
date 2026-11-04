import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
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
  ScoreBand,
} from '@/lib/evaluation/types';
import { SOURCE_LABEL } from '@/lib/evaluation/types';
import {
  EVENT_CATEGORY_LABEL,
  INTERACTION_TYPE_LABEL,
  SEAT_LAYOUT_LABEL,
  STUDENT_ROLE_META,
} from '@/lib/evaluation/annotation-types';
import type {
  InteractionEdge,
  SeatLayoutType,
  SeatingPlan,
  SeatStudent,
  TimelineEvent,
} from '@/lib/evaluation/annotation-types';
import type { DimMeta } from '@/components/annotation/DimensionScores';
import { deriveEssenceHeadline, STATE_META } from '@/lib/report/essence-headline';
import { METHODOLOGY_NOTE, collectBibliography } from '@/lib/report/theory-anchors';
import { nearestTimestamp, speakerAt } from '@/lib/report/locate';

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

/** 四档通用的防误读说明：关系形态是重心位置，不是好坏判断（与页面 STATE_META 同句） */
const NOT_A_VERDICT_TEXT =
  '这只是说明这节课的重心在哪一侧，不是好坏判断。两个向度衡量的是不同的东西，不该比高低。';

/** 系统通用五档：绑定标准未提供档位数据时的回退（附录 A 使用；与 bandLabel10 同边界） */
const GENERIC_BANDS: ScoreBand[] = [
  { level: 1, label: '起步阶段', min: 0.0, max: 2.0, description: '情智两端几乎未出现，课堂以单向传授为主。' },
  { level: 2, label: '可精进', min: 2.1, max: 4.0, description: '有零星情感回应与认知互动，尚未形成稳定结构。' },
  { level: 3, label: '中等', min: 4.1, max: 6.0, description: '情感与认知均有呈现，融合点较少且多为偶发。' },
  { level: 4, label: '良好', min: 6.1, max: 8.0, description: '多数环节可见情感与认知相互支撑，结构较完整。' },
  { level: 5, label: '优秀', min: 8.1, max: 10.0, description: '情感与认知在各环节稳定互促，形成可迁移的课堂结构。' },
];

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

/**
 * 判定姓名字段是否形如登录账号（全 ASCII 且无空格，如 xujingwei0602 / user@example.com）。
 * 中文姓名含非 ASCII 字符不匹配该正则，会原样显示，不会误伤。
 * 导出件里凡出现评价人/终裁人一类姓名的地方，命中则以占位下划线代替，与页脚签名栏口径一致。
 */
const looksLikeAccount = (v?: string | null): boolean =>
  !!v && /^[\x20-\x7E]+$/.test(v) && !/\s/.test(v);

/** 姓名展示：空值显示 —；形如账号时脱敏为占位下划线；中文姓名原样返回 */
const displayNameOrMask = (v?: string | null): string => {
  if (!v) return '—';
  return looksLikeAccount(v) ? '＿＿＿＿＿' : v;
};

/** 正文 run。size 单位为半磅，24 = 12pt（§4 正文 12pt） */
function t(text: string, opts: Partial<IRunOptions> = {}): TextRun {
  return new TextRun({ text, color: INK, size: 24, ...opts });
}

/** 段落（接受单个 run/字符串或数组，调用处两种写法都有）。line 单位为 1/240 行，360 = 1.5 倍行距（§4） */
function p(
  children: TextRun | string | (TextRun | string)[],
  opts: Partial<IParagraphOptions> = {},
): Paragraph {
  return new Paragraph({
    spacing: { after: 100, line: 360 },
    children: (Array.isArray(children) ? children : [children]).map((c) =>
      typeof c === 'string' ? t(c) : c,
    ),
    ...opts,
  });
}

/** 章标题（Heading 1） */
/** 章标题（Heading 1）。pageBreak：每个一级章节强制新起一页（§4） */
function h1(text: string, opts: { pageBreak?: boolean } = {}): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: opts.pageBreak ?? false,
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 4 } },
    // §4 标题黑体
    children: [t(text, { bold: true, size: 30, color: BRAND, font: '黑体' })],
  });
}

/** 节标题（Heading 2） */
function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [t(text, { bold: true, size: 26, color: INK, font: '黑体' })],
  });
}

/** 小标题（Heading 3） */
function h3(text: string, color: string = INK): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 80 },
    children: [t(text, { bold: true, size: 24, color, font: '黑体' })],
  });
}

/** 章节导语：先说这一节回答什么，再给数据 */
function hint(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160 },
    children: [t(text, { italics: true, color: MUTED, size: 19 })],
  });
}

/**
 * 表题（§4：每张表有表号与表题，表号按章节连续，如「表 2-1」）。
 * chapter 传章号（1/2/4）或附录字母（'A'）；序号由 TableSeq 按章自增。
 */
const tableSeq = { chapter: '1', n: 0 };
function setTableChapter(chapter: string | number): void {
  tableSeq.chapter = String(chapter);
  tableSeq.n = 0;
}
function caption(title: string): Paragraph {
  tableSeq.n += 1;
  return new Paragraph({
    keepNext: true,
    spacing: { before: 160, after: 60 },
    children: [t(`表 ${tableSeq.chapter}-${tableSeq.n}　${title}`, { bold: true, size: 21, color: INK, font: '黑体' })],
  });
}

/** 项目符号段（缩进 + 方块前缀，避免依赖 Word 自动列表在不同版本的表现不一致） */
function bullet(text: string, color: string = INK, indent = 360): Paragraph {
  return new Paragraph({
    indent: { left: indent },
    spacing: { after: 60, line: 360 },
    children: [
      t('■ ', { color: BRAND, size: 12 }),
      t(text, { color, size: 24 }),
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
    // cantSplit：单元格不跨页断裂（§4 表格形态要求）
    return new TableRow({ children: cells, tableHeader: header && rowIdx === 0, cantSplit: true });
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
  // 旧报告落库的仍是「待提升」「需重点改进」，新旧词一并匹配
  if (level.includes('可精进') || level.includes('待提升')) return 'EA580C';
  if (level.includes('起步') || level.includes('需重点改进')) return 'E11D48';
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

/** 导出版本：brief 精简版（日常教研快读）/ full 完整版（全量内容） */
export type ExportVariant = 'brief' | 'full';

export interface ExportDocxInput {
  /** 导出版本；缺省按 full（兼容旧调用） */
  variant?: ExportVariant;
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
  /** 完整座位数据（布局、行列、学生坐标/姓名/角色/分组）；缺失时只出统计 */
  seating?: SeatingPlan | null;
  /** 完整互动连线（起止座位、类型、方向、时间、说明） */
  interactions?: InteractionEdge[];
  /** 绑定标准的档位数据（0-10 区间）；缺失时整体回退系统通用五档 */
  bands?: ScoreBand[] | null;
  /** 档位来源说明（标准名称与版本），使用绑定档位时注明来源 */
  bandSourceNote?: string | null;
  /** 档位数据是否缺失（true 时整体回退通用档位并注明） */
  bandsMissing?: boolean;
  /** 自动补齐 AI 解读的提示文案（完整版导出前补齐时写入第一章） */
  autoFillNotes?: string[];
  /** 材料原文（供旧报告证据补时间码与说话人） */
  materials?: { transcript?: string | null; observer?: string | null; taskSheet?: string | null; lessonPlan?: string | null } | null;
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
  const variant: ExportVariant = input.variant ?? 'full';
  const isFull = variant === 'full';
  const { report } = input;

  /** 正文（第二节，带页眉页脚） */
  const children: (Paragraph | Table)[] = [];
  /** 封面（独立分节，不显示页码） */
  const cover: (Paragraph | Table)[] = [];

  const dimName = (code: string) => input.dimensions.find((d) => d.code === code)?.name ?? code;
  const indicatorName = (code: string, fallback?: string) =>
    fallback ?? input.indicatorNames?.[code] ?? code;

  /* ---------------- 封面 ---------------- */
  cover.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 80 },
      children: [t('情智相长 · 数学课堂分析报告', { bold: true, size: 44, color: BRAND, font: '黑体' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [t(input.lessonTitle || '课堂分析报告', { bold: true, size: 32, color: INK, font: '黑体' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 360 },
      children: [t(`报告版本：${isFull ? '完整版' : '精简版'}`, { size: 24, color: MUTED })],
    }),
  );

  const genDate = new Date(report.generated_at);
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
      bodyCell('报告生成人', { bold: true, bg: ZEBRA_BG }),
      bodyCell(displayNameOrMask(input.exporterName)),
    ],
    [
      bodyCell('评价标准', { bold: true, bg: ZEBRA_BG }),
      bodyCell(`${report.standard_name ?? report.standard_code} v${report.standard_version}`, { span: 3 }),
    ],
    [
      bodyCell('生成日期', { bold: true, bg: ZEBRA_BG }),
      bodyCell(genDate.toLocaleDateString('zh-CN')),
      bodyCell('生成时间', { bold: true, bg: ZEBRA_BG }),
      bodyCell(genDate.toLocaleTimeString('zh-CN')),
    ],
    [
      bodyCell('报告状态', { bold: true, bg: ZEBRA_BG }),
      bodyCell(input.isCalibrated ? '已人工终裁' : 'AI 生成（未经人工终裁）', { span: 3 }),
    ],
  ];
  cover.push(table([1600, 3400, 1600, 3400], metaRows, { header: false }));
  cover.push(new Paragraph({ spacing: { after: 240 }, children: [] }));
  cover.push(
    p([
      t('使用范围声明：本报告用于教学改进与教师自我反思，不用于人事评价、职称评审或教师排名；是否分享给他人、何时查阅，由授课教师决定。', {
        size: 20,
        color: MUTED,
      }),
    ]),
  );

  /* ================================================================= *
   * 一、一眼看这课
   * ================================================================= */
  setTableChapter(1);
  children.push(h1('一、一眼看这课'));

  if (input.autoFillNotes?.length) {
    input.autoFillNotes.forEach((n) => children.push(notice(n, 'EFF6FF', '1D4ED8')));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }

  const cm = report.ai_commentary;
  // 一句话结论：取 summary 首句，缺则退回整段
  const firstSentence = (s?: string): string => {
    if (!s) return '';
    const cut = s.split(/(?<=。)/)[0] ?? '';
    return (cut || s).trim();
  };
  const conclusion = firstSentence(cm?.summary);
  if (conclusion) {
    children.push(
      p([
        t('一句话结论：', { bold: true, size: 24, color: BRAND, font: '黑体' }),
        t(conclusion, { size: 24 }),
      ]),
    );
  }
  // 先改这一处：action_items 首条，缺则退回 suggestions 首条
  const firstAction = cm?.action_items?.[0] ?? cm?.suggestions?.[0];
  if (firstAction) {
    children.push(
      p([
        t('先改这一处：', { bold: true, size: 24, color: 'B45309', font: '黑体' }),
        t(firstAction, { size: 24 }),
      ]),
    );
  }

  /* ---------------- 综合得分 ---------------- */
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 160, after: 60 },
      children: [t('综合得分', { size: 22, color: MUTED })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({ text: input.totalScore.toFixed(1), bold: true, size: 64, color: scoreHex(input.totalScore / 10) }),
        new TextRun({ text: '  / 100', size: 24, color: MUTED }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      // §4：摘要区显示综合等级；人工终裁须标明
      children: [
        t(`综合等级：${input.totalLevel ?? '—'}`, { bold: true, size: 24, color: levelColor(input.totalLevel), font: '黑体' }),
        ...(input.isCalibrated ? [t('　·　已人工终裁', { bold: true, size: 22, color: '047857' })] : []),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [t('满分 100 · 由五维加权平均 × 10 换算', { size: 19, color: MUTED })],
    }),
  );

  // 情智双侧速读：直接复用页面的派生函数，判定逻辑与文案只有一处来源，
  // 避免 Word 与页面各写一遍阈值导致口径漂移（曾出现 70/60 与 85/70/55/35 两套尺子）。
  const headline = deriveEssenceHeadline(report);
  const stateLabel = STATE_META[headline.state].label;

  children.push(caption('情智双侧速读'));
  children.push(
    table(
      // 列宽按 3 列分配：两列分数窄、判读列宽（文字更长）
      [3200, 2800, 4000],
      [
        [
          headCell('认知素养（高阶思维 D2）'),
          headCell('情感素养（D3）', undefined, AlignmentType.CENTER),
          headCell('关系形态', undefined, AlignmentType.CENTER),
        ],
        [
          bodyCell(
            `${headline.cognitive_100 === null ? '—' : (headline.cognitive_100 / 10).toFixed(1) + ' / 10'}${headline.cognitive_band ? ' · ' + headline.cognitive_band : ''}`,
            { bold: true, color: scoreHex((headline.cognitive_100 ?? 0) / 10), align: AlignmentType.CENTER },
          ),
          bodyCell(
            `${headline.affective_100 === null ? '—' : (headline.affective_100 / 10).toFixed(1) + ' / 10'}${headline.affective_band ? ' · ' + headline.affective_band : ''}`,
            { bold: true, color: scoreHex((headline.affective_100 ?? 0) / 10), align: AlignmentType.CENTER },
          ),
          bodyCell(stateLabel, { bold: true, color: BRAND, align: AlignmentType.CENTER }),
        ],
      ],
    ),
    p([t(STATE_META[headline.state].desc, { size: 20, color: MUTED })]),
    p([t(NOT_A_VERDICT_TEXT, { size: 19, color: MUTED, italics: true })]),
    new Paragraph({ spacing: { after: 160 }, children: [] }),
  );

  /* ---------------- AI 教学评语（完整版保留全量；精简版只留结论与建议各一条已在上方） ---------------- */
  if (isFull && cm) {
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

  /* ================================================================= *
   * 二、五维拆开看
   * ================================================================= */
  setTableChapter(2);
  children.push(h1('二、五维拆开看', { pageBreak: true }));
  children.push(hint('这一节回答「五个维度各几分、这一维到底表现得怎么样、下一步怎么改」；标「待复核」的维度还需老师人工再确认一遍。'));

  // 材料依据
  const availSources = (Object.keys(SOURCE_LABEL) as Array<keyof typeof SOURCE_LABEL>).filter(
    (k) => report.source_availability?.[k],
  );
  children.push(
    p([
      t('评价依据：', { bold: true, size: 21 }),
      t(availSources.length ? availSources.map((k) => SOURCE_LABEL[k]).join('、') : '无', { size: 21, color: MUTED }),
      t('　·　系统综合多源材料评分，材料不足的来源自动降权。', { size: 21, color: MUTED }),
    ]),
  );

  // 五维评分总表
  children.push(caption('五维评分总表'));
  const dimRows: TableCell[][] = [
    [
      headCell('维度'),
      headCell('权重', undefined, AlignmentType.CENTER),
      headCell('得分', undefined, AlignmentType.CENTER),
      headCell('等级', undefined, AlignmentType.CENTER),
      headCell('待复核', undefined, AlignmentType.CENTER),
    ],
  ];
  report.dimension_results.forEach((d) => {
    dimRows.push([
      bodyCell(dimName(d.dimension_code)),
      bodyCell(`${Math.round((report.source_weights?.[d.dimension_code as never] ?? 0) * 100)}%`, { align: AlignmentType.CENTER }),
      bodyCell(d.score === null ? '—' : d.score.toFixed(1), { bold: true, color: scoreHex(d.score), align: AlignmentType.CENTER }),
      bodyCell(d.level_label ?? '—', { color: levelColor(d.level_label), align: AlignmentType.CENTER }),
      bodyCell(d.need_review ? '待复核' : '—', { color: d.need_review ? 'B45309' : MUTED, align: AlignmentType.CENTER }),
    ]);
  });
  dimRows.push([
    bodyCell('综合（加权 ×10）', { bold: true, bg: ZEBRA_BG }),
    bodyCell('100%', { bold: true, bg: ZEBRA_BG, align: AlignmentType.CENTER }),
    bodyCell(input.totalScore.toFixed(1), { bold: true, bg: ZEBRA_BG, color: scoreHex(input.totalScore / 10), align: AlignmentType.CENTER }),
    bodyCell(input.totalLevel ?? '—', { bold: true, bg: ZEBRA_BG, color: levelColor(input.totalLevel), align: AlignmentType.CENTER }),
    bodyCell('—', { bg: ZEBRA_BG, align: AlignmentType.CENTER }),
  ]);
  children.push(table([3000, 1100, 1300, 2200, 2400], dimRows));
  children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));

  // 人工终裁留痕（完整版）
  if (isFull && report.calibrations?.length) {
    children.push(h3('人工终裁留痕', '047857'));
    const calRows: TableCell[][] = [[headCell('维度'), headCell('AI 原分'), headCell('终裁分'), headCell('终裁人 / 日期'), headCell('理由')]];
    report.calibrations.forEach((c) => {
      const dr = report.dimension_results.find((x) => x.dimension_code === c.dimension_code);
      calRows.push([
        bodyCell(dimName(c.dimension_code)),
        bodyCell(dr?.ai_score === null || dr?.ai_score === undefined ? '—' : dr.ai_score.toFixed(1), { align: AlignmentType.CENTER }),
        bodyCell(c.final_score === null || c.final_score === undefined ? '—' : c.final_score.toFixed(1), { bold: true, align: AlignmentType.CENTER }),
        bodyCell(
          [
            c.reviewer ? (looksLikeAccount(c.reviewer) ? '＿＿＿＿＿' : c.reviewer) : '',
            c.reviewed_at ? new Date(c.reviewed_at).toLocaleDateString('zh-CN') : '',
          ]
            .filter(Boolean)
            .join(' · ') || '—',
        ),
        bodyCell(c.review_note || '—'),
      ]);
    });
    children.push(table([1800, 1200, 1200, 2400, 3400], calRows));
  }

  // 逐维：精简版只出「得分 + 等级」；完整版出二级指标表 + 理论依据 + 四段解读
  report.dimension_results.forEach((d, i) => {
    if (isFull) {
      children.push(...renderDimension(d, i, dimName, indicatorName));
      return;
    }
    children.push(
      p([
        t(`${CN_NUM[i] ?? i + 1}. ${dimName(d.dimension_code)}`, { bold: true, size: 22, color: BRAND, font: '黑体' }),
        t(`　${d.score === null ? '未评' : d.score.toFixed(1) + ' / 10'}`, { bold: true, size: 22, color: scoreHex(d.score) }),
        t(d.level_label ? `　${d.level_label}` : '', { size: 20, color: levelColor(d.level_label) }),
      ]),
    );
  });

  /* ---------------- 课型专属要点 ---------------- */
  const lt = report.lesson_type_eval;
  children.push(h3('课型专属要点'));
  if (lt && lt.llm_used) {
    children.push(
      p([
        t(`${lt.lesson_type_name}`, { bold: true, size: 22, color: BRAND }),
        t(`　手册小节 ${lt.manual_section}`, { size: 20, color: MUTED }),
      ]),
      ...(isFull ? [p(lt.summary)] : []),
      caption('课型要点总览'),
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
    // 精简版只保留要点表（不含逐点证据与观察点明细）
    if (isFull) {
      lt.viewpoints.forEach((vp) => children.push(...renderViewpoint(vp)));
    } else {
      lt.viewpoints.forEach((vp) => {
        children.push(h3(vp.name, '047857'));
        const rows: TableCell[][] = [[headCell('要点'), headCell('得分', undefined, AlignmentType.CENTER), headCell('等级', undefined, AlignmentType.CENTER)]];
        vp.points.forEach((pt) => {
          rows.push([
            bodyCell(pt.name),
            bodyCell(pt.score === null ? '—' : pt.score.toFixed(1), { bold: true, color: scoreHex(pt.score), align: AlignmentType.CENTER }),
            bodyCell(pt.level_label ?? '—', { color: levelColor(pt.level_label), align: AlignmentType.CENTER }),
          ]);
        });
        children.push(table([6600, 1700, 1700], rows));
      });
    }
  } else {
    children.push(notice('本课例未生成课型要点评价：未指定课型，或运行分析时未开启 AI 深度分析。'));
  }

  /* ---------------- 认知/情感观察点（完整版） ---------------- */
  if (isFull) {
    children.push(h3('表一内涵观察点', '047857'));
    children.push(hint('认知侧为数学高阶思维 11 项二级指标，情感侧为数学情感素养 8 项二级指标，合计 57 个细化观察点。'));
    const ee = report.essence_eval;
    if (ee && ee.llm_used) {
      children.push(
        caption('观察点总体覆盖'),
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
  }

  /* ================================================================= *
   * 三、每条分的出处
   * ================================================================= */
  setTableChapter(3);
  children.push(h1('三、每条分的出处', { pageBreak: true }));
  children.push(
    hint(
      isFull
        ? '按来源列出支撑分数的原文与标注；看过上下文再判断分数是否公道，不认同可直接改判。'
        : '每个维度精选 2–3 条关键证据，保留来源与一句解读；完整清单见完整版报告。',
    ),
  );

  const readingOf = (dimCode: string, quote: string): string | undefined =>
    report.evidence_readings?.find((r) => r.dimension_code === dimCode && r.quote === quote)?.reading;

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
          t(`${SOURCE_LABEL[s.source] ?? s.source}`, { bold: true, size: 21, color: BRAND }),
          t(`　${fmt(s.score)} / 10　置信 ${Math.round((s.confidence ?? 0) * 100)}%`, { size: 21, color: MUTED }),
        ]),
      );
      // 精简版每维只留前 3 条；完整版全量
      const evs = isFull ? s.evidences : s.evidences.slice(0, 3);
      evs.forEach((e) => {
        const rd = readingOf(d.dimension_code, e);
        children.push(bullet(e));
        if (rd) children.push(bullet(`解读：${rd}`, MUTED, 720));
      });
      if (!isFull && s.evidences.length > 3) {
        children.push(bullet(`（该来源另有 ${s.evidences.length - 3} 条证据，见完整版报告）`, MUTED, 720));
      }
    });
  });
  if (!hasEvidence) {
    children.push(notice('本次分析未留下可引用的原文证据：可能只有人工标注，或各来源材料均无有效摘录。'));
  }

  /* ================================================================= *
   * 四、课堂现场与材料
   * ================================================================= */
  setTableChapter(4);
  children.push(h1('四、课堂现场与材料', { pageBreak: true }));

  const seating = input.seating ?? null;
  const interactions = input.interactions ?? [];

  /* ---- 表 4-1 座位布局 ---- */
  if (seating && seating.students.length) {
    children.push(h3('座位与互动关系'));
    children.push(
      p([
        t(`布局：${SEAT_LAYOUT_LABEL[seating.layout_type] ?? seating.layout_type}`, { size: 21 }),
        t(`　${seating.rows} 行 × ${seating.cols} 列`, { size: 21 }),
        t(`　共 ${seating.students.length} 名学生`, { size: 21 }),
        t(seating.group_count ? `　${seating.group_count} 组` : '', { size: 21 }),
      ]),
    );
    children.push(
      p(
        (['leader', 'participant', 'observer'] as const).map((r) =>
          t(`${STUDENT_ROLE_META[r].symbol} ${STUDENT_ROLE_META[r].name}　`, { size: 19, color: MUTED }),
        ).concat([t('空白格为未安排座位', { size: 19, color: MUTED })]),
      ),
    );

    const gridCols = Math.max(1, seating.cols);
    const gridHead: TableCell[] = [headCell('排／列', undefined, AlignmentType.CENTER)];
    for (let c = 0; c < gridCols; c++) gridHead.push(headCell(`第${c + 1}列`, undefined, AlignmentType.CENTER));
    const gridRows: TableCell[][] = [gridHead];
    for (let r = 0; r < seating.rows; r++) {
      const rowCells: TableCell[] = [bodyCell(`第${r + 1}排`, { bold: true, align: AlignmentType.CENTER })];
      for (let c = 0; c < gridCols; c++) {
        const s = seating.students.find((x) => x.row === r && x.col === c);
        if (!s) {
          rowCells.push(bodyCell('空位', { align: AlignmentType.CENTER, color: 'D1D5DB' }));
        } else {
          const meta = s.role ? STUDENT_ROLE_META[s.role] : null;
          rowCells.push(
            bodyCell(`${meta ? `${meta.symbol} ` : ''}${s.name ?? s.student_no ?? '未命名'}`, {
              align: AlignmentType.CENTER,
              color: meta ? INK : MUTED,
            }),
          );
        }
      }
      gridRows.push(rowCells);
    }
    const gridWidths = [1000, ...Array.from({ length: gridCols }, () => Math.floor(9000 / gridCols))];
    children.push(caption('座位布局'));
    children.push(table(gridWidths, gridRows));
  }

  /* ---- 表 4-2 互动连线清单 ---- */
  if (interactions.length) {
    children.push(h3('互动连线清单（从哪张座位连到哪张座位）'));
    const seatById = new Map((seating?.students ?? []).map((s) => [s.seat_id, s]));
    const seatLabel = (id: string): string => {
      const s = seatById.get(id);
      if (!s) return id;
      if (s.name) return s.name;
      return s.student_no ?? id;
    };
    children.push(caption('互动连线清单'));
    const intRows: TableCell[][] = [
      [
        headCell('序号', undefined, AlignmentType.CENTER),
        headCell('发起方', undefined, AlignmentType.CENTER),
        headCell('指向', undefined, AlignmentType.CENTER),
        headCell('类型', undefined, AlignmentType.CENTER),
        headCell('方向', undefined, AlignmentType.CENTER),
        headCell('时间', undefined, AlignmentType.CENTER),
        headCell('说明'),
      ],
    ];
    interactions.forEach((e, i) => {
      const mm = Math.floor((e.time_sec ?? 0) / 60).toString().padStart(2, '0');
      const ss = ((e.time_sec ?? 0) % 60).toString().padStart(2, '0');
      intRows.push([
        bodyCell(String(i + 1), { align: AlignmentType.CENTER }),
        bodyCell(seatLabel(e.from_seat_id), { align: AlignmentType.CENTER }),
        bodyCell(seatLabel(e.to_seat_id), { align: AlignmentType.CENTER }),
        bodyCell(INTERACTION_TYPE_LABEL[e.type] ?? e.type, { align: AlignmentType.CENTER }),
        bodyCell(e.bidirectional ? '双向' : '单向', { align: AlignmentType.CENTER }),
        bodyCell(e.time_sec === null || e.time_sec === undefined ? '未标' : `${mm}:${ss}`, { align: AlignmentType.CENTER }),
        bodyCell(e.note || '—'),
      ]);
    });
    children.push(table([700, 1500, 1500, 1400, 900, 900, 3100], intRows));
  }

  /* ---- 关键事件（精简版最多 10 条）---- */
  const events = [...(input.events ?? [])].sort((a, b) => (a.time_sec ?? 0) - (b.time_sec ?? 0));
  const shownEvents = isFull ? events : events.slice(0, 10);
  if (shownEvents.length) {
    children.push(h3(`关键事件打点（${events.length} 条）`));
    const evRows: TableCell[][] = [[headCell('时间', undefined, AlignmentType.CENTER), headCell('类别', undefined, AlignmentType.CENTER), headCell('说明')]];
    shownEvents.forEach((e) => {
      const mm = Math.floor((e.time_sec ?? 0) / 60).toString().padStart(2, '0');
      const ss = ((e.time_sec ?? 0) % 60).toString().padStart(2, '0');
      evRows.push([
        bodyCell(`${mm}:${ss}`, { bold: true, color: BRAND, align: AlignmentType.CENTER }),
        bodyCell(EVENT_CATEGORY_LABEL[e.category] ?? e.category, { align: AlignmentType.CENTER }),
        bodyCell(e.note || '—'),
      ]);
    });
    children.push(caption('关键事件打点'));
    children.push(table([1400, 1800, 6800], evRows));
    if (!isFull && events.length > 10) {
      children.push(hint(`精简版仅列出前 10 条，其余 ${events.length - 10} 条见完整版报告。`));
    }
  }

  /* ---- 表 4-3 课堂现场标注统计 ---- */
  const seatN = seating?.students.length ?? input.seatingStudentCount ?? 0;
  const intN = interactions.length || input.interactionCount || 0;
  children.push(caption('课堂现场标注统计'));
  children.push(
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

  /* ---- 表 4-4 材料与数据覆盖 + AI 参与情况（完整版）---- */
  if (isFull) {
    const srcCount = new Map<string, number>();
    report.dimension_results.forEach((d) =>
      (d.source_scores ?? []).forEach((s) =>
        srcCount.set(s.source, (srcCount.get(s.source) ?? 0) + (s.evidences?.length ?? 0)),
      ),
    );
    children.push(caption('材料与数据覆盖'));
    const covRows: TableCell[][] = [
      [
        headCell('材料类型', undefined, AlignmentType.CENTER),
        headCell('是否提供', undefined, AlignmentType.CENTER),
        headCell('引用证据', undefined, AlignmentType.CENTER),
        headCell('说明'),
      ],
    ];
    (['av_transcript', 'observer_note', 'task_sheet', 'lesson_plan', 'manual_annotation'] as const).forEach((k) => {
      const provided = !!report.source_availability?.[k];
      const n = srcCount.get(k) ?? 0;
      covRows.push([
        bodyCell(SOURCE_LABEL[k] ?? k, { align: AlignmentType.CENTER }),
        bodyCell(provided ? '已提供' : '未提供', { align: AlignmentType.CENTER, color: provided ? INK : 'B91C1C' }),
        bodyCell(n > 0 ? `${n} 条` : '无', { align: AlignmentType.CENTER }),
        bodyCell(provided ? '参与本次评分' : '未参与评分，相关指标自动降权'),
      ]);
    });
    children.push(table([1700, 1400, 1400, 5500], covRows));

    children.push(h3('AI 参与情况'));
    const dimInterpN = report.dimension_interpretations?.length ?? 0;
    const dimExpected = report.dimension_results.filter((d) => d.score !== null).length;
    const essInterpN = report.essence_interpretations?.length ?? 0;
    const readingN = report.evidence_readings?.length ?? 0;
    const status = (n: number, exp: number): string =>
      exp === 0 ? '不适用' : n >= exp ? '已生成' : n > 0 ? '部分生成' : '未生成';
    children.push(
      table(
        [2600, 1600, 4800],
        [
          [headCell('AI 项', undefined, AlignmentType.CENTER), headCell('状态', undefined, AlignmentType.CENTER), headCell('说明')],
          [
            bodyCell('分析引擎', { align: AlignmentType.CENTER }),
            bodyCell(report.ai_meta?.used ? '已启用' : '未启用', { align: AlignmentType.CENTER, color: report.ai_meta?.used ? INK : 'B91C1C' }),
            bodyCell(report.ai_meta?.model ?? '—'),
          ],
          [
            bodyCell('五维维度解读', { align: AlignmentType.CENTER }),
            bodyCell(status(dimInterpN, dimExpected), { align: AlignmentType.CENTER }),
            bodyCell(`${dimInterpN} / ${dimExpected} 个维度`),
          ],
          [
            bodyCell('内涵观察点解读', { align: AlignmentType.CENTER }),
            bodyCell(status(essInterpN, report.essence_eval ? 2 : 0), { align: AlignmentType.CENTER }),
            bodyCell(report.essence_eval ? `${essInterpN} / 2 个域` : '本课未生成观察点'),
          ],
          [
            bodyCell('证据逐条解读', { align: AlignmentType.CENTER }),
            bodyCell(readingN > 0 ? '已生成' : '未生成', { align: AlignmentType.CENTER }),
            bodyCell(`${readingN} 条`),
          ],
        ],
      ),
    );
    if (report.ai_meta?.error) {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      children.push(notice(`AI 降级说明：${report.ai_meta.error}`, 'FEF3C7', '92400E'));
    }
  }

  /* ================================================================= *
   * 附录 A / 附录 B（完整版）
   * ================================================================= */
  if (isFull) {
    setTableChapter('A');
    children.push(h1('附录 A　评分档位说明', { pageBreak: true }));
    const bands: ScoreBand[] = input.bands?.length ? input.bands : GENERIC_BANDS;
    if (input.bandsMissing) {
      children.push(notice('绑定标准未提供档位数据，以下为系统通用五档。'));
    } else if (input.bandSourceNote) {
      children.push(hint(input.bandSourceNote));
    }
    children.push(caption('评分档位说明'));
    const bandRows: TableCell[][] = [
      [
        headCell('档位', undefined, AlignmentType.CENTER),
        headCell('0–10 分区间', undefined, AlignmentType.CENTER),
        headCell('0–100 分区间', undefined, AlignmentType.CENTER),
        headCell('档位描述'),
      ],
    ];
    bands.forEach((b) => {
      bandRows.push([
        bodyCell(b.label, { bold: true, align: AlignmentType.CENTER }),
        bodyCell(`${b.min} – ${b.max}`, { align: AlignmentType.CENTER }),
        bodyCell(`${Math.round(b.min * 10)} – ${Math.round(b.max * 10)}`, { align: AlignmentType.CENTER }),
        bodyCell(b.description || '—'),
      ]);
    });
    children.push(table([1500, 1800, 1800, 4900], bandRows));

    setTableChapter('B');
    children.push(h1('附录 B　理论依据与参考文献', { pageBreak: true }));
    children.push(p('本评价模型的五个维度并非经验性设定，其构念效度与权重依据可追溯至下列文献。'));
    collectBibliography(report.dimension_results.map((d) => d.dimension_code)).forEach((r, i) =>
      children.push(bullet(`${i + 1}. ${r}`, MUTED)),
    );
    children.push(h3('方法学说明'));
    children.push(p(METHODOLOGY_NOTE));
  }

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
    description: `课堂多源材料融合分析报告（Word 版 · ${isFull ? '完整版' : '精简版'}）`,
    styles: {
      default: {
        document: {
          run: { font: { ascii: '宋体', hAnsi: '宋体', eastAsia: '宋体', cs: '宋体' }, size: 24, color: INK },
          paragraph: { spacing: { line: 360 } },
        },
      },
    },
    sections: [
      {
        // 封面：独立分页，不显示页码（§4）
        properties: {
          page: { margin: { top: 1100, right: 1000, bottom: 1100, left: 1000 } },
        },
        children: cover,
      },
      {
        properties: {
          page: {
            margin: { top: 1100, right: 1000, bottom: 1100, left: 1000 },
            pageNumbers: { start: 1 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } },
                children: [
                  t(input.lessonTitle ? `${input.lessonTitle} · 课堂情智相长分析报告` : '情智相长 · 数学课堂分析报告', {
                    size: 16,
                    color: MUTED,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  t('第 ', { size: 18, color: MUTED }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 18, color: MUTED }),
                  t(' 页 / 共 ', { size: 18, color: MUTED }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: MUTED }),
                  t(' 页', { size: 18, color: MUTED }),
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
    const rows: TableCell[][] = [[headCell('二级指标'), headCell('得分', undefined, AlignmentType.CENTER), headCell('评分状态', undefined, AlignmentType.CENTER)]];
    inds.forEach((ind) => {
      rows.push([
        bodyCell(indicatorName(ind.indicator_code, ind.name)),
        bodyCell(fmt(ind.score), { bold: true, color: scoreHex(ind.score), align: AlignmentType.CENTER }),
        // 「评分状态」说的是这份分数的处理状态，不是课堂表现好坏。
        // 四态优先级：缺材料 → 有材料但无表现证据 → 多源分歧待复核 → 已评估。
        // score 为 null 但两个标记都没有时（旧报告数据）兜底为材料待补，保持旧行为。
        bodyCell(
          ind.missing_material
            ? '材料待补'
            : ind.no_evidence
              ? '无相关表现'
              : ind.need_review
                ? '待复核'
                : '已评估',
          {
            color: ind.missing_material || ind.no_evidence ? MUTED : ind.need_review ? 'B45309' : '047857',
            align: AlignmentType.CENTER,
          },
        ),
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

  // 观察点未评有两种成因，分开说明：只合并成一句会让教师对不上数
  // （例：57 点里 10 个未评，却只被告知 5 个缺材料，另 5 个去向不明）
  const allPoints = domain.indicators.flatMap((i) => i.points);
  const missingMaterial = allPoints.filter((x) => x.missing_material).length;
  const noEvidence = allPoints.filter((x) => x.score === null && !x.missing_material).length;
  if (missingMaterial > 0 || noEvidence > 0) {
    out.push(new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }));
    if (missingMaterial > 0) {
      out.push(notice(`${missingMaterial} 个观察点因本次未提交对应材料而无法评价（如仅交转写文稿时，任务单/观察表专属点不可评），已从均分中剔除。`, 'EFF6FF', '1D4ED8'));
    }
    if (noEvidence > 0) {
      out.push(new Paragraph({ spacing: { before: 60, after: 0 }, children: [] }));
      out.push(notice(`${noEvidence} 个观察点本次未发现相关课堂表现，已留空并从均分中剔除。`, 'EFF6FF', '1D4ED8'));
    }
  }

  return out;
}
