/**
 * 完整版 Word 报告量级自测脚本（程序化，禁目测）。
 * 用 SAMPLE_REPORT（造数 fixture，非真实课例）生成 docx 并解包统计各项指标，
 * 对照规格 §6 量级基线输出「实测 vs 目标」。
 *
 * 运行：pnpm exec tsx scripts/measure-report-metrics.ts
 */
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildReportDocx } from '../src/lib/report/export-docx';
import {
  SAMPLE_REPORT,
  SAMPLE_LESSON_TITLE,
  SAMPLE_DIMENSIONS,
  SAMPLE_STUDENTS,
  SAMPLE_INTERACTIONS,
  SAMPLE_EVENTS,
} from '../src/lib/sample/sample-report';

async function main(): Promise<void> {
  const buffer = await buildReportDocx({
    variant: 'full',
    report: SAMPLE_REPORT.result,
    totalScore: SAMPLE_REPORT.total_score,
    totalLevel: SAMPLE_REPORT.total_level,
    isCalibrated: SAMPLE_REPORT.is_calibrated,
    lessonTitle: SAMPLE_LESSON_TITLE,
    lessonMeta: { teacher_name: '示例教师', school: '样例中学', grade_class: '七年级（3）班' },
    dimensions: SAMPLE_DIMENSIONS as never,
    events: SAMPLE_EVENTS as never,
    seating: { layout_type: 'rows', rows: 6, cols: 6, students: SAMPLE_STUDENTS },
    interactions: SAMPLE_INTERACTIONS as never,
    bands: null,
    bandsMissing: true,
    materials: null,
  });

  const dir = mkdtempSync(join(tmpdir(), 'report-metrics-'));
  const docxPath = join(dir, 'report.docx');
  writeFileSync(docxPath, buffer);
  execSync(`unzip -o -q ${docxPath} -d ${join(dir, 'extract')}`, { stdio: 'ignore' });
  const xmlPath = join(dir, 'extract', 'word', 'document.xml');
  if (!existsSync(xmlPath)) {
    console.error('document.xml 未找到，解包失败');
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  const xml = readFileSync(xmlPath, 'utf8');

  // 提取所有文本节点内容
  const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  const allText = texts.join('');

  const hanzi = (allText.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const nonSpaceChars = (allText.match(/[^\s]/g) ?? []).length;
  const paragraphs = (xml.match(/<w:p[\s>]/g) ?? []).length;
  const tables = (xml.match(/<w:tbl>/g) ?? []).length;
  const timecodes = (allText.match(/\b\d{1,2}:\d{2}\b/g) ?? []).length;
  const quotesOpen = (allText.match(/「/g) ?? []).length;

  // 观察点明细行数：来自数据源（确定性），并对 docx 里观察点名出现次数做交叉验证
  const ess = SAMPLE_REPORT.result.essence_eval;
  const indicators = [...(ess?.cognitive?.indicators ?? []), ...(ess?.affective?.indicators ?? [])];
  const pointCount = indicators.reduce((n, ind) => n + (ind.points?.length ?? 0), 0);
  const pointNames = indicators.flatMap((ind) => (ind.points ?? []).map((p) => p.name));
  const pointNameHits = pointNames.filter((n) => allText.includes(n)).length;

  // 7 章顺序（出现位置，-1 表示缺失）
  const chapterNames = [
    '一、一眼看这课',
    '二、五维拆开看',
    '三、每条分的出处',
    '四、课堂现场与材料',
    '附录 A\u3000评分档位说明',
    '附录 B\u3000理论依据与参考文献',
  ];
  const chapterPositions = chapterNames.map((c) => allText.indexOf(c));
  const chaptersInOrder = chapterPositions.every((p, i) => p >= 0 && (i === 0 || p > chapterPositions[i - 1]));

  // 表号连续性：提取「表 N-M」编号，检查同章内 n 连续、跨章 M 递增
  const tableNos = [...allText.matchAll(/表\s*(\d+)-(\d+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  let tableSeqOk = true;
  let prevChap = 0;
  let prevNo = 0;
  for (const [chap, no] of tableNos) {
    if (chap < prevChap) {
      tableSeqOk = false;
      break;
    }
    if (chap === prevChap) {
      if (no !== prevNo + 1) tableSeqOk = false;
    } else if (no !== 1) {
      tableSeqOk = false;
    }
    prevChap = chap;
    prevNo = no;
  }

  const result = {
    fixture: 'SAMPLE_REPORT（造数 fixture，非真实课例）',
    docxBytes: buffer.length,
    正文字数_中文字符: hanzi,
    正文_非空白字符: nonSpaceChars,
    段落数: paragraphs,
    表数: tables,
    时间码数: timecodes,
    原话引号数_左引号: quotesOpen,
    观察点明细行数_数据源: pointCount,
    观察点明细行数_docx名命中: pointNameHits,
    七章顺序: {
      positions: chapterPositions,
      inOrder: chaptersInOrder,
    },
    表号列表: tableNos,
    表号连续: tableSeqOk,
  };

  console.log(JSON.stringify(result, null, 2));
  rmSync(dir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
