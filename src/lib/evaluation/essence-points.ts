// ============================================================
// 情智相长内涵框架 · 二级指标细化观察点（表一蓝本）
// 数学高阶思维（认知）3 类 11 个二级指标 + 数学情感素养（情感）4 类 8 个二级指标。
// 每个二级指标细化为 2-4 个可观察、可取证的观察点，并标注主要证据来源：
//   av         课堂音视频转写（师生话语、互动过程）
//   observer   人工观察表（质性记录、参与面、情绪与角色行为）
//   task_sheet 学生任务单（作答痕迹、方法多样性、完成质量）
// 观察点为评分清单叶子节点；无证据时不出分，不臆造。
// ============================================================

import type { ObservationPoint, PointSource } from '@/lib/evaluation/types';

export const POINT_SOURCE_LABEL: Record<PointSource, string> = {
  av: '课堂音视频',
  observer: '人工观察表',
  task_sheet: '学生任务单',
};

interface SeedPoint {
  name: string;
  definition: string;
  sources: PointSource[];
}

const P = (indicatorCode: string, idx: number, p: SeedPoint): ObservationPoint => ({
  code: `${indicatorCode}-P${idx}`,
  indicator_code: indicatorCode,
  name: p.name,
  description: p.definition,
  sources: p.sources,
});

// 认知 · 策略型思维
const COG_STRATEGY: Record<string, SeedPoint[]> = {
  'D2-1': [
    {
      name: '具体材料归纳与共性提炼',
      definition: '学生在多个具体例子、操作或数据中发现共同特征，用自己的话说出“它们都……”式的归纳，而非教师直接给结论。',
      sources: ['av', 'observer'],
    },
    {
      name: '概念/法则的抽象表述',
      definition: '学生能用数学语言、符号或图形表述概念、法则、公式，表述剔除了具体情境的非本质属性。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '结论的普遍性检验',
      definition: '对归纳出的结论追问“是不是都成立/换个数还成立吗”，有举例验证或反例检验的行为。',
      sources: ['av', 'task_sheet'],
    },
  ],
  'D2-2': [
    {
      name: '一题多解的真实呈现',
      definition: '课堂出现两种及以上有实质差异的解法或思路（如画图、列算式、方程、倒推等），由学生提出而非仅教师罗列。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '多角度解释同一数学对象',
      definition: '学生能从数与形、正向与逆向、不同表征（文字/符号/图表）之间转换，解释同一事实。',
      sources: ['av', 'observer'],
    },
    {
      name: '表征转换解释同一对象',
      definition: '学生能用文字、符号、图形、操作等不同表征表达同一数学对象，并在表征间转换而不改变数学含义。',
      sources: ['av', 'task_sheet'],
    }
  ],
  'D2-3': [
    {
      name: '方法比较与说理',
      definition: '对不同解法进行比较，说出各自特点、适用条件或繁简优劣，而不是只给一个“答案”。',
      sources: ['av'],
    },
    {
      name: '择优判断与标准形成',
      definition: '学生依据合理性、一般性、简洁性等标准做出“哪种更好”的判断，并说明依据。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '解法适用范围的反思',
      definition: '学生能说明某种解法在什么条件下适用、何时会失效，形成对方法边界的认识。',
      sources: ['av', 'task_sheet'],
    }
  ],
  'D2-4': [
    {
      name: '新情境识别与模型套用',
      definition: '面对未直接练习过的新情境，学生能识别其中的数学结构并调用已学概念、方法或模型解决。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '跨课题/跨学科迁移表达',
      definition: '学生主动把本课方法与其他课题或生活、其他学科情境联系（如“这跟上学期的××是一样的道理”）。',
      sources: ['av', 'observer'],
    },
    {
      name: '迁移方法的主动调用',
      definition: '面对新任务学生主动检索并调用已学策略（如画图、化归、举例），而非等待教师提示解法。',
      sources: ['av', 'observer'],
    }
  ],
};

// 认知 · 批判型思维
const COG_CRITICAL: Record<string, SeedPoint[]> = {
  'D2-5': [
    {
      name: '主动提出有价值的疑问',
      definition: '学生对题目条件、解法、结论或同伴发言主动提出“为什么/一定吗/如果……会怎样”等有数学含量的疑问。',
      sources: ['av', 'observer'],
    },
    {
      name: '质疑基于证据而非挑错',
      definition: '疑问建立在计算、图形、定义或反例等证据之上，能指出具体哪里不对，而非笼统否定。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '对教材/教师结论的审辨',
      definition: '学生不盲从教材或教师给出的结论，能发现其中表述不严谨处或提出反例并展开讨论。',
      sources: ['av', 'observer'],
    }
  ],
  'D2-6': [
    {
      name: '复杂问题分解为基本问题',
      definition: '面对综合题，学生能拆成若干可处理的小问题、分步推进，或识别出其中的基本图形/基本关系。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '未知向已知的化归路径',
      definition: '学生明确表达“把它转化成我们学过的××”的化归思路，并完成转化求解。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '分解思路的外显表达',
      definition: '学生能把解题计划用"先求什么、再求什么"的链条讲清楚，步骤之间的依赖关系明确。',
      sources: ['av', 'task_sheet'],
    }
  ],
  'D2-7': [
    {
      name: '正逆/动静等侧面转换',
      definition: '学生能在正向与逆向思考、一般与特殊、常量与变量、动与静等不同侧面间转换看问题。',
      sources: ['av'],
    },
    {
      name: '对立统一关系的认识表达',
      definition: '能说出“变中不变”“特殊里藏一般”等对立统一又相互转化的认识。',
      sources: ['av', 'observer'],
    },
    {
      name: '换角度重述问题',
      definition: '当一条思路受阻时，学生能换一个角度重新叙述问题（如从结论倒推、换参数、换图形位置）打开局面。',
      sources: ['av', 'observer'],
    }
  ],
  'D2-8': [
    {
      name: '方法/观点的联系与整合',
      definition: '学生把不同解法、不同观点联系起来，归纳成一类方法或形成结构化的认识（思维导图、小结等）。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '对已有结论的建设性补充重构',
      definition: '在他人回答基础上补充条件、修正漏洞或重构表述，使结论更完整严谨。',
      sources: ['av', 'observer'],
    },
    {
      name: '跨方法共通原理的提炼',
      definition: '学生能指出不同解法背后的同一个数学原理（如都基于等式性质、同构关系），实现方法的融会贯通。',
      sources: ['av', 'task_sheet'],
    }
  ],
};

// 认知 · 创新型思维
const COG_CREATIVE: Record<string, SeedPoint[]> = {
  'D2-9': [
    {
      name: '结论/方法的延伸推广',
      definition: '学生把课堂结论向更一般情形延伸（换数、换条件、增加变量），或追问“还能用到哪里”。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '开放变式的提出与处理',
      definition: '学生自己提出变式问题、追加条件或改编题目，并尝试解决。',
      sources: ['av', 'observer'],
    },
    {
      name: '一般化猜想与符号表达',
      definition: '学生能把具体结果推广为一般规律，并用字母或一般式表达猜想（如写出第 n 个的情形）。',
      sources: ['av', 'task_sheet'],
    }
  ],
  'D2-10': [
    {
      name: '类比与跨域联想',
      definition: '学生通过类比旧知或跨领域经验产生新的猜想、解法或联系，联想有数学依据而非牵强附会。',
      sources: ['av', 'observer'],
    },
    {
      name: '直觉关联的数学化检验',
      definition: '直觉联想后能用数学方式验证其合理性，区分“像”与“是”。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '生活经验向数学的类比建模',
      definition: '学生借助生活经验或其他学科情境类比数学结构，并能剥离非数学属性建立对应关系。',
      sources: ['av', 'task_sheet'],
    }
  ],
  'D2-11': [
    {
      name: '新颖独创的解法或见解',
      definition: '出现超出常规预设的解法、表达或发现，且数学上成立；任务单中能看到非常规但正确的作答路径。',
      sources: ['av', 'task_sheet'],
    },
    {
      name: '猜想—顿悟—论证过程',
      definition: '学生经历从猜想到顿悟再到尝试论证的完整过程，而不只是报答案。',
      sources: ['av', 'observer'],
    },
    {
      name: '对非常规思路的接纳与再创造',
      definition: '学生敢于提出与多数人不同的思路，并在讨论中完善或自我修正，课堂允许试错和再创造。',
      sources: ['av', 'observer'],
    }
  ],
};

// 情感 · 心理调适
const AFF_PSYCHE: Record<string, SeedPoint[]> = {
  'D3-1': [
    {
      name: '好奇与求知追问',
      definition: '学生对数学问题表现出惊讶、兴趣，主动追问“为什么/还有没有别的方法”，出现“哇、原来是这样”等反应。',
      sources: ['av', 'observer'],
    },
    {
      name: '享受猜想—验证过程',
      definition: '在探究任务中主动预测、尝试验证，对验证结果有明显的情绪投入（期待、兴奋）。',
      sources: ['av', 'observer'],
    },
    {
      name: '任务单中的探究性痕迹',
      definition: '任务单上有主动试算、草图、猜想标注等非被迫的探究痕迹，而非只写标准答案。',
      sources: ['task_sheet'],
    },
  ],
  'D3-2': [
    {
      name: '遇挫坚持与换法再思',
      definition: '面对难题或错误不轻易放弃，出现重新审题、换方法、整理草稿再尝试的行为。',
      sources: ['av', 'observer'],
    },
    {
      name: '挫败情绪的自我调节',
      definition: '在复杂运算或开放问题受挫后能较快平复、回到任务，无需教师反复安抚。',
      sources: ['observer'],
    },
    {
      name: '任务单上的订正与反思痕迹',
      definition: '任务单留有划掉重算、分步检查、错因旁注等坚持完成与自我修正的痕迹。',
      sources: ['task_sheet'],
    },
  ],
};

// 情感 · 交流协作
const AFF_SOCIAL: Record<string, SeedPoint[]> = {
  'D3-3': [
    {
      name: '数学语言准确表达思路',
      definition: '学生发言能正确使用数学术语、符号、图形，有条理地陈述解题过程，而不只是说“我感觉”。',
      sources: ['av', 'observer'],
    },
    {
      name: '倾听并理解他人论证',
      definition: '学生能复述、追问或评价同伴的思路，围绕他人的论证继续讨论，而非各说各的。',
      sources: ['av', 'observer'],
    },
    {
      name: '任务单表达规范完整',
      definition: '任务单作答书写规范，过程、单位、符号、图示表达完整清晰。',
      sources: ['task_sheet'],
    },
  ],
  'D3-4': [
    {
      name: '分工协作与角色担当',
      definition: '小组活动中出现明确分工（组织引领/协同参与/记录等角色），学生承担并完成各自角色。',
      sources: ['observer', 'av'],
    },
    {
      name: '思维碰撞与共建结论',
      definition: '生生之间有真正的观点交锋、互相补充，最终共同形成解法或结论，而非一人代做。',
      sources: ['av', 'observer'],
    },
    {
      name: '求助与互助的有效互动',
      definition: '学生主动求助或帮助同伴，互助围绕数学理解展开（讲思路），而非直接给答案。',
      sources: ['observer', 'av'],
    },
  ],
};

// 情感 · 信念内省
const AFF_BELIEF: Record<string, SeedPoint[]> = {
  'D3-5': [
    {
      name: '言之有据、以理服人',
      definition: '学生坚持用推理、计算或证据支撑观点，不盲从教师或多数，发言中出现“因为/根据……所以”。',
      sources: ['av'],
    },
    {
      name: '严谨求实的作答态度',
      definition: '任务单中按步骤推理、不跳关键步；数据题如实记录，不为凑答案修改数据。',
      sources: ['task_sheet'],
    },
    {
      name: '对结论保持检验意识',
      definition: '得到答案后有检验、验算或确认合理性的习惯。',
      sources: ['av', 'task_sheet'],
    },
  ],
  'D3-6': [
    {
      name: '用数学眼光解读现实',
      definition: '学生主动把生活现象数学化（量化、找关系、建模型），或表达“数学能解释生活中的……”。',
      sources: ['av', 'observer'],
    },
    {
      name: '自觉调用数学解决真实问题',
      definition: '在真实任务中不经提示即选择数学工具（测量、统计、估算、方程）处理问题。',
      sources: ['task_sheet', 'av'],
    },
    {
      name: '数学学习信心的行为表现',
      definition: '面对有挑战的任务不轻易放弃，主动举手、要求展示或愿意二次尝试，体现"我能做数学"的信念。',
      sources: ['av', 'observer'],
    }
  ],
};

// 情感 · 价值责任
const AFF_VALUE: Record<string, SeedPoint[]> = {
  'D3-7': [
    {
      name: '数学审美与秩序感',
      definition: '学生对简洁解法、对称、规律、结构之美有所感（“好简洁/真巧妙”），或主动选择更优雅的表达。',
      sources: ['av', 'observer'],
    },
    {
      name: '学习自信与主动展示',
      definition: '学生敢于表达不成熟想法、主动板演或展示，从数学成功体验中表现出自信。',
      sources: ['av', 'observer'],
    },
    {
      name: '数学是动态文化的认识',
      definition: '学生表达数学知识不是死记的条文，提到数学的历史、发展或人类活动属性，把数学看作可探究的文化产物。',
      sources: ['av', 'task_sheet'],
    }
  ],
  'D3-8': [
    {
      name: '实事求是与数据伦理',
      definition: '统计、概率、数据类任务中如实收集与呈现数据，尊重与自己预期不同的结果。',
      sources: ['task_sheet', 'av'],
    },
    {
      name: '用数学服务他人/社会的意识',
      definition: '学生表达或实施用数学帮助同伴、改进班级/社区事务的想法，体现责任意识。',
      sources: ['av', 'observer'],
    },
    {
      name: '数学应用价值的真实体认',
      definition: '学生能举出数学在生活、科技或社会中真实应用的例子，或用数学解决身边问题并表达其价值。',
      sources: ['av', 'task_sheet'],
    }
  ],
};

const ESSENCE_GROUPS: Record<string, SeedPoint[]> = {
  ...COG_STRATEGY,
  ...COG_CRITICAL,
  ...COG_CREATIVE,
  ...AFF_PSYCHE,
  ...AFF_SOCIAL,
  ...AFF_BELIEF,
  ...AFF_VALUE,
};

/** 19 个二级指标的细化观察点（共 57 个） */
export const ESSENCE_OBSERVATION_POINTS: ObservationPoint[] = Object.entries(
  ESSENCE_GROUPS,
).flatMap(([indicatorCode, seeds]) => seeds.map((seed, i) => P(indicatorCode, i + 1, seed)));

/** 认知（高阶思维）观察点，按二级指标 code 分组 */
export const COGNITIVE_INDICATOR_CODES = [
  'D2-1', 'D2-2', 'D2-3', 'D2-4',
  'D2-5', 'D2-6', 'D2-7', 'D2-8',
  'D2-9', 'D2-10', 'D2-11',
];

/** 情感（情感素养）观察点，按二级指标 code 分组 */
export const AFFECTIVE_INDICATOR_CODES = ['D3-1', 'D3-2', 'D3-3', 'D3-4', 'D3-5', 'D3-6', 'D3-7', 'D3-8'];

export const ESSENCE_INDICATOR_CODES = [...COGNITIVE_INDICATOR_CODES, ...AFFECTIVE_INDICATOR_CODES];

export function essencePointsOf(indicatorCode?: string | null): ObservationPoint[] {
  if (!indicatorCode) return [];
  return ESSENCE_OBSERVATION_POINTS.filter((p) => p.indicator_code === indicatorCode);
}

export const ESSENCE_POINT_COUNT = ESSENCE_OBSERVATION_POINTS.length;
