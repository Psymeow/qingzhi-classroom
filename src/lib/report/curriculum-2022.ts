// ============================================================
// 2022 版义务教育数学课程标准 · 核心素养对标
// 原文来源：教育部《义务教育数学课程标准（2022年版）》。
// 用途：报告「课标对标」视角——把五维评价挂回国家课程标准，
// 让教师看到每个维度/指标落在哪条核心素养上（麦盟借鉴点：框架挂课标原文）。
// 本文件只做展示与对标，不参与评分。
// ============================================================

export interface CurriculumCompetency {
  code: string;
  name: string;
  stage: '小学' | '初中' | '小学与初中';
  /** 课标原文（内涵），节选自表 1「核心素养的主要表现及其内涵」 */
  definition: string;
}

/** 初中阶段核心素养主要表现（含小学与初中通用项），节选课标原文。 */
export const COMPETENCIES_2022: CurriculumCompetency[] = [
  {
    code: 'abstract',
    name: '抽象能力',
    stage: '初中',
    definition:
      '抽象能力主要是指通过对现实世界中数量关系与空间形式的抽象，得到数学的研究对象，形成数学概念、性质、法则和方法的能力。能够从实际情境或跨学科的问题中抽象出核心变量、变量的规律及变量之间的关系，并能够用数学符号予以表达；能够从具体的问题解决中概括出一般结论，形成数学的方法与策略。',
  },
  {
    code: 'operation',
    name: '运算能力',
    stage: '小学与初中',
    definition:
      '运算能力主要是指根据法则和运算律进行正确运算的能力。能够明晰运算的对象和意义，理解算法与算理之间的关系；能够理解运算的问题，选择合理简洁的运算策略解决问题；能够通过运算促进数学推理能力的发展。',
  },
  {
    code: 'geo_intuition',
    name: '几何直观',
    stage: '小学与初中',
    definition:
      '几何直观主要是指运用图表描述和分析问题的意识与习惯。能够感知各种几何图形及其组成元素，依据图形的特征进行分类；根据语言描述画出相应的图形，分析图形的性质；建立形与数的联系，构建数学问题的直观模型；利用图表分析实际情境与数学问题，探索解决问题的思路。',
  },
  {
    code: 'space',
    name: '空间观念',
    stage: '小学与初中',
    definition:
      '空间观念主要是指对空间物体或图形的形状、大小及位置关系的认识。能够根据物体特征抽象出几何图形，根据几何图形想象出所描述的实际物体；想象并表达物体的空间方位和相互之间的位置关系；感知并描述图形的运动和变化规律。',
  },
  {
    code: 'reasoning',
    name: '推理能力',
    stage: '初中',
    definition:
      '推理能力主要是指从一些事实和命题出发，依据规则推出其他命题或结论的能力。理解逻辑推理在形成数学概念、法则、定理和解决问题中的重要性，初步掌握推理的基本形式和规则；对于一些简单问题，能通过特殊结果推断一般结论；理解命题的结构与联系，探索并表述论证过程；感悟数学的严谨性，初步形成逻辑表达与交流的习惯。',
  },
  {
    code: 'data',
    name: '数据观念',
    stage: '初中',
    definition:
      '数据观念主要是指对数据的意义和随机性有比较清晰的认识。知道数据蕴含着信息，需要根据问题的背景和所要研究的问题确定数据收集、整理和分析的方法；知道可以用定量的方法描述随机现象的变化趋势及随机事件发生的可能性大小。',
  },
  {
    code: 'model',
    name: '模型观念',
    stage: '初中',
    definition:
      '模型观念主要是指对运用数学模型解决实际问题有清晰的认识。知道数学建模是数学与现实联系的基本途径；初步感知数学建模的基本过程，从现实生活或具体情境中抽象出数学问题，用数学符号建立方程、不等式、函数等表示数学问题中的数量关系和变化规律，求出结果并讨论结果的意义。',
  },
  {
    code: 'application',
    name: '应用意识',
    stage: '小学与初中',
    definition:
      '应用意识主要是指有意识地利用数学的概念、原理和方法解释现实世界中的现象与规律，解决现实世界中的问题。能够感悟现实生活中蕴含着大量的与数量和图形有关的问题，可以用数学的方法予以解决；初步了解数学作为一种通用的科学语言在其他学科中的应用，通过跨学科主题学习建立不同学科之间的联系。',
  },
  {
    code: 'innovation',
    name: '创新意识',
    stage: '小学与初中',
    definition:
      '创新意识主要是指主动尝试从日常生活、自然现象或科学情境中发现和提出有意义的数学问题。初步学会通过具体的实例，运用归纳和类比发现数学关系与规律，提出数学命题与猜想，并加以验证；勇于探索一些开放性的、非常规的实际问题与数学问题。',
  },
];

/** 课程总目标「三会」。 */
export const CURRICULUM_GOALS_2022 = {
  eye: '会用数学的眼光观察现实世界',
  mind: '会用数学的思维思考现实世界',
  language: '会用数学的语言表达现实世界',
} as const;

/** 总目标 · 情感态度（对应 D3 数学情感素养的对标）。 */
export const EMOTION_GOAL_2022 =
  '对数学具有好奇心和求知欲，了解数学的价值，欣赏数学美，提高学习数学的兴趣，建立学好数学的信心，养成良好的学习习惯，形成质疑问难、自我反思和勇于探索的科学精神。';

/** 课程理念 · 评价（对应平台「以评促改」的定位）。 */
export const ASSESSMENT_GOAL_2022 =
  '评价不仅要关注学生数学学习结果，还要关注学生数学学习过程，激励学生学习，改进教师教学。';

/** 维度 → 核心素养对标（D3 情感素养走 EMOTION_GOAL_2022，不入核心素养表）。 */
export const DIMENSION_COMPETENCY: Record<string, string[]> = {
  D1: ['abstract', 'application', 'innovation'],
  D2: ['reasoning', 'operation', 'abstract', 'model', 'innovation'],
  D3: [],
  D4: ['application', 'geo_intuition'],
  D5: ['reasoning', 'data'],
};

export function competencyByCode(code: string): CurriculumCompetency | undefined {
  return COMPETENCIES_2022.find((c) => c.code === code);
}

export function competencyName(code: string): string {
  return competencyByCode(code)?.name ?? code;
}

// ============================================================
// 指标「硬 / 软」标注：区分可规则核验与纯 AI 研判。
// 现状：D2（高阶思维 11 项）与 D3（情感素养 8 项）有 signal-rules 的语义词表兜底，
// 可核验「命中哪句原话」；D1/D4/D5 无规则信号，完全由 LLM 语义研判。
// 报告据此诚实标注「规则可核」与「AI 研判」，避免把主观判断说成客观测量。
// ============================================================

export type EvidenceKind = 'rule' | 'llm';

export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  rule: '规则可核',
  llm: 'AI 研判',
};

export const EVIDENCE_KIND_HINT: Record<EvidenceKind, string> = {
  rule: '有词表信号兜底，可定位到课堂原话',
  llm: '由模型结合材料语义研判',
};

/** 按指标编码判断测量方式：D2/D3 有规则信号，其余纯 LLM。 */
export function evidenceKindOf(indicatorCode: string): EvidenceKind {
  return /^D[23]-/.test(indicatorCode) ? 'rule' : 'llm';
}
