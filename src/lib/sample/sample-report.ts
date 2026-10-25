// ============================================================
// 内置离线样例报告（P0-4 断网/无数据兜底）
// 纯静态、无任何网络/鉴权依赖，用于：
//  1) 会场网络环境不确定时，让教研员随时预览「完整报告长什么样」；
//  2) 新用户在还没有课例时理解产品价值。
// 数据为一节虚构的七年级《有理数的乘方》新授课，覆盖全部报告区块：
// 五维结果与证据、AI 教学评语、课型专属要点、认知/情感内涵观察点、
// 数据来源齐备性、座位互动与关键事件。
// ============================================================

import type { StoredReport } from '@/lib/api/client';
import type {
  AnalysisReport,
  DimensionResult,
  SourceScore,
} from '@/lib/evaluation/types';
import type {
  InteractionEdge,
  SeatStudent,
  TimelineEvent,
} from '@/lib/evaluation/annotation-types';

function src(source: SourceScore['source'], score: number | null, evidences: string[], confidence: number): SourceScore {
  return { source, score, evidences, confidence };
}

const dimensionResults: DimensionResult[] = [
  {
    dimension_code: 'D1',
    score: 8.2,
    level_label: '良好',
    need_review: false,
    evidences: [
      '以「拉面对折」真实情境引出乘方意义，把思维发展与积极情感体验整合在同一任务中。',
      '教学目标明确区分「知识技能」与「高阶思维/情感」两类，环节设计服务于素养生成。',
    ],
    source_scores: [
      src('av_transcript', 8.4, ['师：拉面师傅每对折一次面条数翻倍，对折 6 次会有多少根？'], 0.9),
      src('task_sheet', 8.0, ['任务单设置「情境—列式—归纳」三台阶，体现进阶设计。'], 0.8),
      src('observer_note', 8.2, ['观察员：导入即激发好奇，情境与目标高度一致。'], 0.7),
      src('manual_annotation', null, [], 0),
    ],
    indicators: [],
  },
  {
    dimension_code: 'D2',
    score: 7.4,
    level_label: '中等',
    need_review: true,
    evidences: [
      '学生能从 2¹, 2², 2³ 归纳出 aⁿ 的结构，出现抽象概括表现。',
      '但开放性探究时间偏短，批判质疑与多角度论证的机会不足。',
    ],
    source_scores: [
      src('av_transcript', 7.0, ['生 5：指数其实就是相同因数相乘的个数。'], 0.85),
      src('task_sheet', 8.2, ['任务单要求学生比较 (-2)³ 与 -2³ 的区别，触及批判性辨析。'], 0.8),
      src('observer_note', 6.8, ['观察员：归纳环节由教师带得较快，学生独立猜想空间有限。'], 0.7),
      src('manual_annotation', null, [], 0),
    ],
    indicators: [],
  },
  {
    dimension_code: 'D3',
    score: 8.0,
    level_label: '良好',
    need_review: false,
    evidences: [
      '多组学生主动举手并在小组内互相讲解，数学兴趣与交流协作表现明显。',
      '对答错学生采用追问而非否定，保护了学习自信心。',
    ],
    source_scores: [
      src('av_transcript', 8.2, ['师：这个想法很大胆，能说说你是怎么想到的吗？'], 0.85),
      src('task_sheet', null, [], 0),
      src('observer_note', 8.0, ['观察员：第 3 组两名内向学生也参与了讲解。'], 0.75),
      src('manual_annotation', 7.8, ['座位图标注：6 处生生互助互动。'], 0.6),
    ],
    indicators: [],
  },
  {
    dimension_code: 'D4',
    score: 7.6,
    level_label: '中等',
    need_review: false,
    evidences: [
      '课堂节奏清晰，讲练结合，能根据学生作答即时调整例题难度。',
      '小组讨论规则明确，但个别环节过渡语略显仓促。',
    ],
    source_scores: [
      src('av_transcript', 7.5, ['师：很多同学在这里出错，我们再回到情境看一遍。'], 0.85),
      src('task_sheet', 7.8, ['任务单分层练习 A/B 组，支持弹性实施。'], 0.8),
      src('observer_note', 7.4, ['观察员：时间分配合理，收束稍快。'], 0.7),
      src('manual_annotation', null, [], 0),
    ],
    indicators: [],
  },
  {
    dimension_code: 'D5',
    score: 7.0,
    level_label: '中等',
    need_review: false,
    evidences: [
      '结课有「一句话收获」反思环节，部分学生能联系生活举例。',
      '反馈以对错判断为主，面向素养的描述性反馈还可加强。',
    ],
    source_scores: [
      src('av_transcript', 7.0, ['生：原来细胞分裂也是乘方，数学就在生活里。'], 0.8),
      src('task_sheet', 7.2, ['任务单末尾设置自评量规。'], 0.75),
      src('observer_note', 6.8, ['观察员：反思时间仅 2 分钟，反馈深度有限。'], 0.7),
      src('manual_annotation', null, [], 0),
    ],
    indicators: [],
  },
];

const report: AnalysisReport = {
  lesson_id: 'sample-lesson',
  standard_code: 'qzxc-math',
  standard_name: '数学情智相长评价模型（课型分型版）',
  standard_version: '5',
  total_score: 77.6,
  total_level: '中等',
  dimension_results: dimensionResults,
  source_weights: {
    av_transcript: 0.4,
    task_sheet: 0.25,
    observer_note: 0.2,
    lesson_plan: 0.15,
    manual_annotation: 0.15,
  },
  source_availability: {
    av_transcript: true,
    task_sheet: true,
    observer_note: true,
    lesson_plan: true,
    manual_annotation: true,
  },
  calibrations: [],
  generated_at: '2026-10-20T03:30:00.000Z',
  ai_meta: {
    enabled: true,
    used: true,
    model: 'sample',
    error: null,
  },
  ai_commentary: {
    summary:
      '本节课以「拉面对折」的真实情境引入有理数的乘方，较好地把数学抽象、归纳推理与积极情感体验融合在一起，学生参与度高、课堂氛围安全开放。五维综合表现处于「中等偏上」，情智融合设计与情感培育是突出亮点；高阶思维中的批判质疑与开放探究、以及面向素养的描述性反馈是下一步最值得加强的方向。',
    highlights: [
      '情境真实且贯穿始终，学生从「面条翻倍」自然建构乘方意义，抽象概括有具体支架。',
      '对错误回答采用鼓励式追问，营造了敢想敢说的课堂心理安全环境。',
      '任务单分层清晰，A/B 组练习照顾差异，支持课堂弹性实施。',
    ],
    suggestions: [
      '在归纳 aⁿ 后增加一个开放辨析任务（如 (-2)ⁿ 与 -2ⁿ），给学生更多批判与论证的时间。',
      '把对错式反馈升级为描述性反馈，具体指出学生「好在哪里、如何更进一步」。',
      '适当延长结课反思环节，引导学生用乘方解释更多生活现象，促进迁移与价值认同。',
    ],
    essence_coupling:
      '「拉面对折」这个真实情境同时激活了好奇与抽象：情感上的安全感让学生敢于试错，试错失败后的成功归纳又反过来强化了「我能学好数学」的信念，形成正向回路；不足在于这条回路主要靠情境与鼓励维系，还缺一个把情感体验沉淀为理性认同的反思环节。',
    action_items: [
      '导入改为先请一名学生用一句话描述「对折 10 次会怎样」，再由教师抛出拉面情境',
      '在归纳 aⁿ 之后插入 1 分钟「错误辨析」，请学生互评 (-2)ⁿ 与 -2ⁿ 的差异',
      '结课前留 2 分钟书面反思：今天哪个瞬间让你觉得数学有意思，为什么',
    ],
    model: 'sample',
    generated_at: '2026-10-20T03:30:00.000Z',
  },
  lesson_type_eval: {
    lesson_type: 'new',
    lesson_type_name: '新授课',
    manual_section: '2.1',
    summary:
      '本节新授课遵循「情境激疑—自主建构—归纳概括—迁移应用」的典型路径，概念形成环节扎实；在「自主探究的充分性」与「迁移任务的开放性」上仍有提升空间。',
    llm_enabled: true,
    llm_used: true,
    viewpoints: [
      {
        code: 'new-v1',
        name: '情境创设与问题驱动',
        score: 8.4,
        points: [
          {
            code: 'new-1-1',
            no: 1,
            name: '情境真实且指向核心概念',
            definition: '情境应贴近学生经验，并能自然引出本节课的核心数学概念。',
            score: 8.5,
            level_label: '良好',
            reason: '拉面对折情境直观呈现「相同因数连乘」，直指乘方本质。',
            evidences: ['师：每对折一次面条数翻倍，对折 6 次是多少根？'],
          },
          {
            code: 'new-1-2',
            no: 2,
            name: '问题链具有驱动性',
            definition: '以有层次的问题链推动学生持续思考。',
            score: 8.2,
            level_label: '良好',
            reason: '从「多少根」到「怎么写更简洁」形成递进问题链。',
            evidences: ['师：一直写 2×2×2 太麻烦，数学家想了个什么办法？'],
          },
        ],
      },
      {
        code: 'new-v2',
        name: '概念建构与归纳',
        score: 7.4,
        points: [
          {
            code: 'new-2-1',
            no: 3,
            name: '给学生留足自主归纳时间',
            definition: '概念应由学生在充分举例、观察后自主归纳，而非教师直接给出。',
            score: 6.8,
            level_label: '中等',
            reason: '归纳环节教师引导偏多，学生独立表达机会有限。',
            evidences: ['观察员记录：归纳 aⁿ 结构用时约 40 秒，即由教师小结。'],
          },
          {
            code: 'new-2-2',
            no: 4,
            name: '对易错概念进行辨析',
            definition: '针对 (-a)ⁿ 与 -aⁿ 等易混点组织对比辨析。',
            score: 8.0,
            level_label: '良好',
            reason: '任务单设置了对比辨析题，但课堂上展开讨论不足。',
            evidences: ['任务单：比较 (-2)³ 与 -2³ 的底数、意义与结果。'],
          },
        ],
      },
    ],
    total_score: 7.9,
    total_score_100: 79,
    scored_points: 4,
    total_points: 4,
    source: 'auto',
    confidence: 0.88,
    detection_basis: '课堂以新概念建构为主，含情境导入、归纳概括与迁移练习，判定为新授课。',
    model: 'sample',
  },
  essence_eval: {
    llm_enabled: true,
    llm_used: true,
    model: 'sample',
    cognitive: {
      domain: 'cognitive',
      name: '数学高阶思维',
      indicators: [
        {
          code: 'ES-A1',
          name: '抽象概括',
          category: '策略型',
          domain: 'cognitive',
          score: 8.0,
          points: [
            {
              code: 'ES-A1-P1',
              name: '能从具体实例抽象出数学结构',
              definition: '从多个特例中剥离非本质属性，概括出一般结构。',
              sources: ['av', 'task_sheet'],
              score: 8.0,
              reason: '学生能从 2 的连乘概括出 aⁿ 的一般形式。',
              evidences: ['生 5：指数就是相同因数相乘的个数。'],
            },
            {
              code: 'ES-A1-P2',
              name: '能用符号准确表达一般规律',
              definition: '使用字母/符号表达概括出的规律。',
              sources: ['av'],
              score: 7.9,
              reason: '多数学生能正确书写底数、指数与幂。',
              evidences: ['板演：a×a×…×a（n 个）= aⁿ。'],
            },
          ],
        },
        {
          code: 'ES-A2',
          name: '批判质疑',
          category: '批判型',
          domain: 'cognitive',
          score: 6.6,
          points: [
            {
              code: 'ES-A2-P1',
              name: '主动质疑结论或提出反例',
              definition: '对结论保持审慎，能提出疑问或反例检验。',
              sources: ['observer'],
              score: 6.6,
              reason: '课堂以教师设问为主，学生主动质疑较少。',
              evidences: ['观察员：未观察到学生主动提出反例。'],
            },
            {
              code: 'ES-A2-P2',
              name: '对易混情形进行辨析',
              definition: '能辨别形似质异的概念或结果。',
              sources: ['task_sheet'],
              score: null,
            },
          ],
        },
      ],
      score: 7.3,
      score_100: 73,
      scored_indicators: 2,
      total_indicators: 2,
      scored_points: 3,
      total_points: 4,
    },
    affective: {
      domain: 'affective',
      name: '数学情感素养',
      indicators: [
        {
          code: 'ES-E1',
          name: '数学兴趣与投入',
          category: '信念内省',
          domain: 'affective',
          score: 8.3,
          points: [
            {
              code: 'ES-E1-P1',
              name: '主动参与并表达想法',
              definition: '乐于举手、发言、板演，投入探究活动。',
              sources: ['av', 'observer'],
              score: 8.3,
              reason: '多组学生主动举手，小组讲解投入。',
              evidences: ['观察员：举手覆盖率约 70%，第 3 组全员发言。'],
            },
          ],
        },
        {
          code: 'ES-E2',
          name: '交流协作',
          category: '交流协作',
          domain: 'affective',
          score: 8.0,
          points: [
            {
              code: 'ES-E2-P1',
              name: '同伴间有效互助讲解',
              definition: '在小组中倾听、解释、帮助同伴理解。',
              sources: ['observer', 'av'],
              score: 8.0,
              reason: '出现多次生生互助，讲解能围绕概念展开。',
              evidences: ['生 3 向同桌解释：底数是负数要加括号。'],
            },
            {
              code: 'ES-E2-P2',
              name: '面对错误保持积极态度',
              definition: '答错不沮丧，愿意在反馈后修正。',
              sources: ['av'],
              score: 8.1,
              reason: '教师鼓励式追问使答错学生愿意继续尝试。',
              evidences: ['师：这个想法很大胆，说说你是怎么想到的？'],
            },
          ],
        },
      ],
      score: 8.15,
      score_100: 82,
      scored_indicators: 2,
      total_indicators: 2,
      scored_points: 3,
      total_points: 3,
    },
    scored_points: 6,
    total_points: 7,
  },
};

export const SAMPLE_REPORT: StoredReport = {
  id: 'sample-report',
  result: report,
  total_score: report.total_score,
  total_level: report.total_level,
  need_review_count: report.dimension_results.filter((d) => d.need_review).length,
  is_calibrated: false,
  source_weights: report.source_weights,
  created_at: report.generated_at,
  updated_at: report.generated_at,
};

/** 样例课例标题 */
export const SAMPLE_LESSON_TITLE = '样例课例：七年级《有理数的乘方》新授课';

/** 样例五维元信息（供报告雷达与维度名展示），code 与内置标准一致 */
export const SAMPLE_DIMENSIONS = [
  { code: 'D1', name: '情智融合教学设计' },
  { code: 'D2', name: '数学高阶思维发展' },
  { code: 'D3', name: '数学情感素养培育' },
  { code: 'D4', name: '情智共生课堂实施' },
  { code: 'D5', name: '反思反馈与素养生成' },
];

/** 样例座位排布：6 排 × 6 列里的部分学生 */
export const SAMPLE_STUDENTS: SeatStudent[] = [
  { seat_id: 's1', student_no: '01', row: 0, col: 0, group: 'G1' },
  { seat_id: 's2', student_no: '02', row: 0, col: 1, group: 'G1' },
  { seat_id: 's3', student_no: '03', row: 0, col: 3, group: 'G2' },
  { seat_id: 's4', student_no: '04', row: 0, col: 4, group: 'G2' },
  { seat_id: 's5', student_no: '05', row: 1, col: 0, group: 'G1', role: 'speaker' as never },
  { seat_id: 's6', student_no: '06', row: 1, col: 1, group: 'G1' },
  { seat_id: 's7', student_no: '07', row: 1, col: 3, group: 'G2' },
  { seat_id: 's8', student_no: '08', row: 1, col: 4, group: 'G2' },
  { seat_id: 's9', student_no: '09', row: 2, col: 0, group: 'G3' },
  { seat_id: 's10', student_no: '10', row: 2, col: 1, group: 'G3' },
  { seat_id: 's11', student_no: '11', row: 2, col: 3, group: 'G4' },
  { seat_id: 's12', student_no: '12', row: 2, col: 4, group: 'G4' },
  { seat_id: 's13', student_no: '13', row: 3, col: 0, group: 'G3' },
  { seat_id: 's14', student_no: '14', row: 3, col: 1, group: 'G3' },
  { seat_id: 's15', student_no: '15', row: 3, col: 3, group: 'G4' },
  { seat_id: 's16', student_no: '16', row: 3, col: 4, group: 'G4' },
];

export const SAMPLE_INTERACTIONS: InteractionEdge[] = [
  { id: 'i1', from_seat_id: 's5', to_seat_id: 's6', bidirectional: true, type: 'collaborate', phase: '探究' },
  { id: 'i2', from_seat_id: 's3', to_seat_id: 's4', bidirectional: true, type: 'share', phase: '探究' },
  { id: 'i3', from_seat_id: 's9', to_seat_id: 's10', bidirectional: false, type: 'ask_help', phase: '练习' },
  { id: 'i4', from_seat_id: 's15', to_seat_id: 's16', bidirectional: true, type: 'collaborate', phase: '练习' },
];

export const SAMPLE_EVENTS: TimelineEvent[] = [
  { id: 'e1', time_sec: 180, category: 'thinking_highlight', note: '学生从面条翻倍归纳出乘方结构', dimension_codes: ['D2'] },
  { id: 'e2', time_sec: 420, category: 'qz_integration', note: '情境探究中思维与兴趣同时被激活', dimension_codes: ['D1', 'D4'] },
  { id: 'e3', time_sec: 760, category: 'emotion_event', note: '答错学生在鼓励追问后重新作答成功', dimension_codes: ['D3'] },
  { id: 'e4', time_sec: 1500, category: 'to_improve', note: '开放辨析时间不足，批判质疑机会偏少', dimension_codes: ['D4'] },
];
