import type { ObservationPoint, RubricStandard, ScoreBand } from "./types";
import { ESSENCE_OBSERVATION_POINTS } from "./essence-points";
import { LESSON_TYPE_MODELS, LESSON_TYPE_ORDER } from "./lesson-type-models";

// ============================================================
// 内置标准：数学「情智相长」模型（依据三张表 4.0 + 模型评价标准文档）
// 仅作种子数据；运行期以数据库 standard_set 为准，可后台迭代/校本替换。
// ============================================================

/** 通用五档锚点（8.1-10 / 6.1-8 / 4.1-6 / 2.1-4 / 0-2），各维度描述另写 */
const band = (
  level: 1 | 2 | 3 | 4 | 5,
  label: string,
  description: string,
  min: number,
  max: number,
): ScoreBand => ({ level, label, description, min, max });

export const QZXC_MATH_STANDARD: RubricStandard = {
  code: "qzxc-math-v5",
  name: "数学情智相长评价模型（课型分型版）",
  version: "5.1",
  subject: "math",
  description:
    "依托情智相长三张表 4.0，以“内涵—设计—实施—反馈”为链条的五维课堂评价模型。思维与情感各占 25%，设计与实施各占 20%，反馈占 10%。V5.0 两项升级：① 五维指标配齐（33 条），D1/D4/D5 的指标依据《AIC 课型手册 1.0》数学部分的情境设计、实践操作、诊断—归因—指导、成果展示与评价等要点迁移而来；② 课型升级为评价模型的路由键，按课型加载专属要点集（见 lesson-type-models.ts）。",

  dimensions: [
    {
      code: "D1",
      order: 1,
      name: "情智融合教学设计",
      weight: 0.2,
      observation_focus: "目标与任务中的情智双线融合",
      description:
        "考察教学目标与教学设计的情智融合程度：目标须同时关照高阶思维与情感素养且融合自然，任务情境兼具数学探究价值与情感唤起功能，思维挑战与情感体验在同一环节交织共生，避免割裂式设计。",
      bands: [
        band(5, "高度融合", "目标高度融合地同时关照思维与情感，双线清晰自然；任务兼具突出探究价值与情感唤起，挑战与体验全程有机统一。", 8.1, 10),
        band(4, "较融合", "目标较清晰地双线融合、能体现互促；任务能在同一活动中关注二者，基本交织共生，融合深度或自然度尚有提升空间。", 6.1, 8),
        band(3, "基本兼顾", "目标开始并提思维与情感但融合不够自然、双线时隐时现；有兼顾意识但情境的探究与唤起结合不紧，仍有分置痕迹。", 4.1, 6),
        band(2, "融合较弱", "仅单方面关注思维或情感，未在同一目标或任务中形成融合，双线不明显、关联松散。", 2.1, 4),
        band(1, "未融合", "目标与设计均未体现情智融合，思维与情感缺失或割裂，情境既无探究价值也无情感唤起，多为机械练习。", 0, 2),
      ],
    },
    {
      code: "D2",
      order: 2,
      name: "数学高阶思维发展",
      weight: 0.25,
      observation_focus: "策略型、批判型、创新型思维水平",
      description:
        "依据高阶思维内涵框架，考察策略型（抽象概括、多样灵活、择优优化、迁移运用）、批判型（合理质疑、化归解构、辩证转换、建构整合）、创新型（拓展发展、发散联想、独特创造）三类11种思维的显现水平，以思维过程的完整性、深刻性与原创性为等级依据。",
      bands: [
        band(5, "高水平显现", "完整经历从具体到抽象的概括；灵活多角度理解并主动比较择优；有效迁移到新情境；基于充分证据合理质疑；形成建设性、独创性新见解，思维完整深刻、原创性强。", 8.1, 10),
        band(4, "较好显现", "较稳定地抽象概括；多角度理解并主动优化；主动迁移；基于证据质疑并形成建设性新见解，有一定独创性，思维较完整深刻。", 6.1, 8),
        band(3, "基本显现", "能经历概括过程；多角度理解并在引导下比较优化；在支持下迁移；能基于一定证据质疑；形成一定建设性新见解但独创性一般。", 4.1, 6),
        band(2, "初步显现", "偶尔抽象概括且不稳定；单一角度理解、较少比较优化；明显提示下部分迁移；零散质疑证据不足；少量新见解，建设性与原创性有限。", 2.1, 4),
        band(1, "未显现", "停留于具体操作、机械模仿或重复记忆，难以抽象概括、多角度理解、比较优化、迁移、质疑或形成独创性见解。", 0, 2),
      ],
    },
    {
      code: "D3",
      order: 3,
      name: "数学情感素养培育",
      weight: 0.25,
      observation_focus: "兴趣韧性、交流协作、理性与价值认同",
      description:
        "考察心理调适（数学兴趣、思维韧性）、交流协作（数学表达、协同探究）、信念内省（理性精神、数学自觉）、价值责任（数学认同、求真担当）四类8种情感素养表现，关注从“被动接受”向“主动热爱”的情感进阶。",
      bands: [
        band(5, "表现优秀", "始终保持强烈好奇求知；遇挫能有效调节并坚韧推演；准确灵活表达并深入理解他人；主动分工共建、高质量思维碰撞；高度崇尚证据与理性，深刻认同数学价值并体现求真担当。", 8.1, 10),
        band(4, "表现良好", "对多数问题保持好奇；主动调节挫败、较稳定坚持；较准确表达、较好理解他人；积极分工共建；较崇尚证据理性，逐步形成价值认同与求真担当。", 6.1, 8),
        band(3, "表现中等", "对部分问题好奇；尝试调节挫败、在支持下坚持；能用基本符号术语表达、大体理解他人；承担部分分工有一定碰撞；理性精神与价值认同有所显现。", 4.1, 6),
        band(2, "表现较低", "偶尔好奇但不持久；遇挫明显、需外部提醒才能继续；初步少量表达、理解他人不充分；参与与分工碰撞较少；理性与价值认同处于萌芽。", 2.1, 4),
        band(1, "表现薄弱", "较少好奇；易放弃或情绪失控、难坚持；较少表达、理解他人困难；协同参与不足；缺乏理性精神，价值认同与求真担当尚未形成。", 0, 2),
      ],
    },
    {
      code: "D4",
      order: 4,
      name: "情智共生课堂实施",
      weight: 0.2,
      observation_focus: "教师融合实施与学生综合表现",
      description:
        "分教师与学生两侧面：教师能否自然顺畅落实情智融合、以开放提问/容错氛围/即时反馈促成互促；学生参与面是否广泛、投入是否持续，思维表现与情感投入是否相互支撑，共同构成情智共生课堂样态。",
      bands: [
        band(5, "情智融合优秀", "教师高度自然顺畅落实融合、环节深度交织无割裂；开放提问、容错与即时反馈高效促成互促。学生参与广泛深入、投入持续稳定，思维与情感紧密互撑，构成典型共生样态。", 8.1, 10),
        band(4, "情智融合良好", "教师自然顺畅落实融合、无明显割裂；反馈较好促成互促。学生参与广泛、投入较持续，思维与情感相互支撑，形成较明显共生样态。", 6.1, 8),
        band(3, "基本达成", "一定程度落实融合、推进较顺畅但仍有割裂；能使用开放提问/容错/反馈但效果一般。学生参与面中等、投入较持续，支撑不充分。", 4.1, 6),
        band(2, "融合较弱", "偶有融合尝试但不自然、部分环节割裂；开放提问少，容错与反馈不足。学生参与有限、投入不持续，思维与情感互动微弱。", 2.1, 4),
        band(1, "未落实", "情智割裂明显；开放提问缺失、容错不足、反馈无效或缺失。学生参与狭窄、投入断续，未形成共生样态。", 0, 2),
      ],
    },
    {
      code: "D5",
      order: 5,
      name: "反思反馈与素养生成",
      weight: 0.1,
      observation_focus: "过程性证据、反馈调节与素养进阶",
      description:
        "考察教师能否系统收集过程性证据、基于证据调整教学以评促教；学生能否通过反馈真实表达深刻时刻、困惑与诉求并自我调节；评价是否指向思维与情感素养持续生成，形成“评价—反馈—改进”闭环。",
      bands: [
        band(5, "优秀达成", "系统多元收集证据并精准调整、充分以评促教；学生主动真实反馈并深入自我反思调节；评价深度指向素养持续生成，高效形成闭环并显著推动进阶。", 8.1, 10),
        band(4, "良好达成", "较系统收集证据并据证调整；学生较真实反馈并自我调节；评价明确指向素养生成，形成较完整闭环，有效推动进阶。", 6.1, 8),
        band(3, "基本达成", "收集部分证据并有限调整；学生能表达部分反馈、产生一定自我调节；开始指向素养生成，初步形成闭环，有一定推动。", 4.1, 6),
        band(2, "较少体现", "证据零散不系统、调整随意、以评促教有限；学生少量反馈且不充分、自我调节弱；偏向知识检测，闭环不完整。", 2.1, 4),
        band(1, "缺失偏离", "未收集证据、未据证调整；学生缺反馈渠道或流于形式；评价仅用于目标检测，未形成闭环、不推动进阶（如只核对答案）。", 0, 2),
      ],
    },
  ],

  indicators: [
    // ---------- D1 情智融合教学设计（依据课型手册「情境设计」要点迁移） ----------
    { code: "D1-1", dimension_code: "D1", category: "情境设计", name: "情境学科关联度", weight: 1, description: "创设的情境是否紧扣本课数学核心概念、原理或实践主题，能否从情境中自然引出数学问题；可从教师导入语、媒体情境中的学科关键词及学生回应判断。", enabled: true, observation_points: [
      { code: "D1-1-1", indicator_code: "D1-1", name: "情境紧扣数学核心内容" },
      { code: "D1-1-2", indicator_code: "D1-1", name: "由情境自然引出数学问题" },
    ]},
    { code: "D1-2", dimension_code: "D1", category: "情境设计", name: "驱动问题明确性", weight: 1, description: "情境是否被转化为具体、可操作、可探究的驱动问题或学习任务，使学生明确“要解决什么”；可从教师提问与任务说明中是否出现清晰的驱动问题判断。", enabled: true, observation_points: [
      { code: "D1-2-1", indicator_code: "D1-2", name: "驱动任务表述清晰" },
    ]},
    { code: "D1-3", dimension_code: "D1", category: "情境设计", name: "情境真实性", weight: 1, description: "情境素材是否来源于真实生活、科技、自然或社会问题，情境文本与媒体呈现是否适切；避免为情境而情境的虚假包装。", enabled: true, observation_points: [
      { code: "D1-3-1", indicator_code: "D1-3", name: "素材来源真实" },
    ]},
    { code: "D1-4", dimension_code: "D1", category: "情境设计", name: "学段与经验适切性", weight: 1, description: "情境的信息量、复杂程度、语言表述与认知方式是否符合本学段学生水平，是否基于学生已有数学知识或生活经验，避免抽象生硬或脱离经验。", enabled: true, observation_points: [
      { code: "D1-4-1", indicator_code: "D1-4", name: "符合学段认知水平" },
      { code: "D1-4-2", indicator_code: "D1-4", name: "基于已有知识经验" },
    ]},
    { code: "D1-5", dimension_code: "D1", category: "情境设计", name: "情境贯穿度", weight: 1, description: "情境是否在后续探究、操作、练习与总结阶段被持续引用，成为任务推进的线索，而非仅用于导入。", enabled: true, observation_points: [
      { code: "D1-5-1", indicator_code: "D1-5", name: "各环节回扣情境" },
    ]},

    // ---------- D2 高阶思维：策略型 ----------
    { code: "D2-1", dimension_code: "D2", category: "策略型", name: "抽象概括", weight: 1, description: "通过归纳等多种方式，得出具有普遍意义的数学概念、原理、定理、公式、法则、性质、方法、规律等。", enabled: true, observation_points: [
      { code: "D2-1-1", indicator_code: "D2-1", name: "从具体到抽象的归纳过程" },
      { code: "D2-1-2", indicator_code: "D2-1", name: "结论的普遍性与严谨性" },
    ]},
    { code: "D2-2", dimension_code: "D2", category: "策略型", name: "多样灵活", weight: 1, description: "从不同角度、不同层次、不同方式理解数学事实或问题，形成观点或解决方法。", enabled: true, observation_points: [
      { code: "D2-2-1", indicator_code: "D2-2", name: "多角度/多方式理解问题" },
    ]},
    { code: "D2-3", dimension_code: "D2", category: "策略型", name: "择优优化", weight: 1, description: "对多种解决方法或结论进行比较分析，做出合理判断，形成更优方法或结论。", enabled: true, observation_points: [
      { code: "D2-3-1", indicator_code: "D2-3", name: "多解法比较与择优" },
    ]},
    { code: "D2-4", dimension_code: "D2", category: "策略型", name: "迁移运用", weight: 1, description: "将获得的数学事实和活动经验运用到新情境中，解决新情境的问题。", enabled: true, observation_points: [
      { code: "D2-4-1", indicator_code: "D2-4", name: "新情境下的经验迁移" },
    ]},
    // ---------- D2 批判型 ----------
    { code: "D2-5", dimension_code: "D2", category: "批判型", name: "合理质疑", weight: 1, description: "基于已有数学事实和活动经验，对问题、解法、观点、思考过程等提出合理疑问。", enabled: true, observation_points: [
      { code: "D2-5-1", indicator_code: "D2-5", name: "基于证据的质疑" },
    ]},
    { code: "D2-6", dimension_code: "D2", category: "批判型", name: "化归解构", weight: 1, description: "对复杂综合问题进行分析，转化为简单的、基本的数学结构或关系。", enabled: true, observation_points: [
      { code: "D2-6-1", indicator_code: "D2-6", name: "复杂问题分解化归" },
    ]},
    { code: "D2-7", dimension_code: "D2", category: "批判型", name: "辩证转换", weight: 1, description: "对问题、观点、方法、思考过程在不同侧面转换，形成对立统一又相互转化的认识。", enabled: true, observation_points: [
      { code: "D2-7-1", indicator_code: "D2-7", name: "多侧面辩证看待" },
    ]},
    { code: "D2-8", dimension_code: "D2", category: "批判型", name: "建构整合", weight: 1, description: "对已有观点或方法进行综合、分析、比较、联系、整合、重构、补充，形成建设性观点或方法。", enabled: true, observation_points: [
      { code: "D2-8-1", indicator_code: "D2-8", name: "整合重构建设性结论" },
    ]},
    // ---------- D2 创新型 ----------
    { code: "D2-9", dimension_code: "D2", category: "创新型", name: "拓展发展", weight: 1, description: "在已有数学事实和活动经验基础上，拓宽或延伸已有的信息、意义或观点。", enabled: true, observation_points: [
      { code: "D2-9-1", indicator_code: "D2-9", name: "结论/方法的拓展延伸" },
    ]},
    { code: "D2-10", dimension_code: "D2", category: "创新型", name: "发散联想", weight: 1, description: "在已有经验基础上进行跳跃式联想、类比、关联，形成新的观点或认识。", enabled: true, observation_points: [
      { code: "D2-10-1", indicator_code: "D2-10", name: "类比联想与跨域关联" },
    ]},
    { code: "D2-11", dimension_code: "D2", category: "创新型", name: "独特创造", weight: 1, description: "通过猜想、直觉、顿悟等，提出具有新颖性、独创性的见解。", enabled: true, observation_points: [
      { code: "D2-11-1", indicator_code: "D2-11", name: "新颖独创见解" },
    ]},

    // ---------- D3 情感素养：心理调适 ----------
    { code: "D3-1", dimension_code: "D3", category: "心理调适", name: "数学兴趣", weight: 1, description: "探索数学问题与规律时保持好奇心和求知欲，享受从猜想到验证的探究过程（主动追问“为什么”“还有没有其他方法”）。", enabled: true, observation_points: [
      { code: "D3-1-1", indicator_code: "D3-1", name: "好奇与求知追问" },
      { code: "D3-1-2", indicator_code: "D3-1", name: "享受猜想—验证过程" },
    ]},
    { code: "D3-2", dimension_code: "D3", category: "心理调适", name: "思维韧性", weight: 1, description: "面对复杂运算、抽象概念或开放问题时调节挫败情绪，坚持逻辑推演并反思优化（不轻易放弃、换法再思）。", enabled: true, observation_points: [
      { code: "D3-2-1", indicator_code: "D3-2", name: "遇挫坚持与情绪调节" },
    ]},
    // ---------- D3 交流协作 ----------
    { code: "D3-3", dimension_code: "D3", category: "交流协作", name: "数学表达", weight: 1, description: "准确运用数学符号、图形、公式和术语表达数学思想，清晰阐述解题思路并理解他人论证。", enabled: true, observation_points: [
      { code: "D3-3-1", indicator_code: "D3-3", name: "数学语言准确表达" },
      { code: "D3-3-2", indicator_code: "D3-3", name: "理解他人论证" },
    ]},
    { code: "D3-4", dimension_code: "D3", category: "交流协作", name: "协同探究", weight: 1, description: "在探究、建模或综合实践中分工协作、思维碰撞、共同构建模型或寻求最优解（承担主导型/支持型等不同角色）。", enabled: true, observation_points: [
      { code: "D3-4-1", indicator_code: "D3-4", name: "分工协作与角色担当" },
      { code: "D3-4-2", indicator_code: "D3-4", name: "思维碰撞共建" },
    ]},
    // ---------- D3 信念内省 ----------
    { code: "D3-5", dimension_code: "D3", category: "信念内省", name: "理性精神", weight: 1, description: "崇尚逻辑与证据，坚持以推理论证为判断依据，养成严谨求实、言之有据的品质。", enabled: true, observation_points: [
      { code: "D3-5-1", indicator_code: "D3-5", name: "言之有据、严谨求实" },
    ]},
    { code: "D3-6", dimension_code: "D3", category: "信念内省", name: "数学自觉", weight: 1, description: "认识到数学是认识世界与解决问题的重要工具，主动用数学眼光观察现实、分析问题。", enabled: true, observation_points: [
      { code: "D3-6-1", indicator_code: "D3-6", name: "用数学解决真实问题" },
    ]},
    // ---------- D3 价值责任 ----------
    { code: "D3-7", dimension_code: "D3", category: "价值责任", name: "数学认同", weight: 1, description: "对数学本质与文化价值深度内化，感悟数学之美、建立自信，形成稳定内驱力，从被动接受走向主动热爱。", enabled: true, observation_points: [
      { code: "D3-7-1", indicator_code: "D3-7", name: "数学审美与学习自信" },
    ]},
    { code: "D3-8", dimension_code: "D3", category: "价值责任", name: "求真担当", weight: 1, description: "在统计、概率、数据分析中坚持实事求是、客观严谨，树立数据伦理，具备用数学服务社会的责任感。", enabled: true, observation_points: [
      { code: "D3-8-1", indicator_code: "D3-8", name: "实事求是与社会责任" },
    ]},
    // ---------- D4 情智共生课堂实施（依据课型手册「实践操作」「诊断—归因—指导」要点迁移） ----------
    { code: "D4-1", dimension_code: "D4", category: "证据诊断", name: "诊断证据化", weight: 1, description: "是否基于学生作业、试卷或任务表现中的真实数据、典型样本、错误统计或具体作答片段来定位问题，而非仅凭经验泛泛而谈。", enabled: true, observation_points: [
      { code: "D4-1-1", indicator_code: "D4-1", name: "基于真实作答数据定位问题" },
      { code: "D4-1-2", indicator_code: "D4-1", name: "聚焦典型与高频问题" },
    ]},
    { code: "D4-2", dimension_code: "D4", category: "证据诊断", name: "归因深度", weight: 1, description: "是否从“粗心、不认真”等表层归因深入到知识漏洞、概念理解、方法选择、任务理解、表达规范、学习习惯等深层原因，并依据作答痕迹、口头表达与追问结果推断，而非主观猜测。", enabled: true, observation_points: [
      { code: "D4-2-1", indicator_code: "D4-2", name: "归因触及深层原因" },
      { code: "D4-2-2", indicator_code: "D4-2", name: "引导学生自主归因" },
    ]},
    { code: "D4-3", dimension_code: "D4", category: "实施指导", name: "指导策略针对性", weight: 1, description: "指导是否直接对应已诊断的错误类型与归因结果，提供具体可操作的解决策略，而非简单重讲或只对答案；是否将隐性思维过程转化为可复用的方法、步骤与判断标准。", enabled: true, observation_points: [
      { code: "D4-3-1", indicator_code: "D4-3", name: "策略与诊断对应" },
      { code: "D4-3-2", indicator_code: "D4-3", name: "方法显性可复用" },
    ]},
    { code: "D4-4", dimension_code: "D4", category: "实施指导", name: "操作与步骤指导清晰度", weight: 1, description: "任务与操作环节是否明确说明要解决的问题、完成的任务及预期结果，并将过程分解为清晰、有序、可执行的步骤，对先后顺序、关键动作与注意事项作出说明。", enabled: true, observation_points: [
      { code: "D4-4-1", indicator_code: "D4-4", name: "任务与预期结果明确" },
      { code: "D4-4-2", indicator_code: "D4-4", name: "步骤分解清晰可执行" },
    ]},
    { code: "D4-5", dimension_code: "D4", category: "差异实施", name: "分层与差异化实施", weight: 1, description: "是否识别并区分共性错误与个别差异、不同水平学生的差异，并针对不同错误类型或水平提供分层任务、分类讲解与差异化建议，避免以单一要求覆盖全班。", enabled: true, observation_points: [
      { code: "D4-5-1", indicator_code: "D4-5", name: "区分共性与个别差异" },
      { code: "D4-5-2", indicator_code: "D4-5", name: "提供分层任务与建议" },
    ]},

    // ---------- D5 反思反馈与素养生成（依据课型手册「成果展示与评价」「迁移应用」要点迁移） ----------
    { code: "D5-1", dimension_code: "D5", category: "成果生成", name: "成果结构完整度", weight: 1, description: "学习成果展示是否包含任务或问题、探究过程、结果与发现、总结反思等基本环节，是否体现从过程到结论的完整链条与基本顺序。", enabled: true, observation_points: [
      { code: "D5-1-1", indicator_code: "D5-1", name: "过程与结论环节完整" },
    ]},
    { code: "D5-2", dimension_code: "D5", category: "成果生成", name: "证据支撑度", weight: 1, description: "成果中的发现、结论或解释是否有操作记录、数据、图表、实例或计算过程支撑，能否区分“观察到的”与“猜想的”，说明结论来源。", enabled: true, observation_points: [
      { code: "D5-2-1", indicator_code: "D5-2", name: "结论有证据来源" },
    ]},
    { code: "D5-3", dimension_code: "D5", category: "反馈改进", name: "评价反馈具体性", weight: 1, description: "教师或同伴的评价是否具体指出做得好的地方、存在的问题，并提出学生可理解的改进建议（优点＋问题＋建议），而非笼统表扬或只判对错。", enabled: true, observation_points: [
      { code: "D5-3-1", indicator_code: "D5-3", name: "反馈包含优点与建议" },
    ]},
    { code: "D5-4", dimension_code: "D5", category: "反馈改进", name: "迁移与矫正再应用", weight: 1, description: "学生在获得反馈后是否实际修正原错误、重新作答或完成同类与变式任务，是否提供新情境任务检验迁移达成度，体现从错误到应用的转化。", enabled: true, observation_points: [
      { code: "D5-4-1", indicator_code: "D5-4", name: "错误矫正与再作答" },
      { code: "D5-4-2", indicator_code: "D5-4", name: "新情境迁移达成" },
    ]},
  ],

  // 课型枚举对齐《AIC 课型手册 1.0》数学部分（2.1—2.5），与 lesson-type-models.ts 保持一致
  lesson_types: [
    { code: "new", name: "新授课" },
    { code: "review", name: "复习课" },
    { code: "comment", name: "讲评课" },
    { code: "practice", name: "实践课" },
    { code: "topic", name: "专题课" },
  ],

  // 内涵分析域：认知指向 D2（数学高阶思维 11 指标），情感指向 D3（数学情感素养 8 指标）
  essence_domains: {
    cognitive: { dimension_code: "D2", name: "数学高阶思维" },
    affective: { dimension_code: "D3", name: "数学情感素养" },
  },

  // 课型分析模型（5 课型 / 15 视角 / 91 要点）：换学科时整体替换该数组
  lesson_type_models: LESSON_TYPE_ORDER.map((code) => LESSON_TYPE_MODELS[code]),
};

/** 便捷查表 */
export const DIMENSIONS = QZXC_MATH_STANDARD.dimensions;

// 表一内涵框架细化：用 essence-points 的 57 个细化观察点（含定义与证据来源）
// 覆盖 D2（认知 11 指标）/D3（情感 8 指标）原有的粗略观察点。
{
  const byIndicator = new Map<string, ObservationPoint[]>();
  for (const p of ESSENCE_OBSERVATION_POINTS) {
    const list = byIndicator.get(p.indicator_code) ?? [];
    list.push(p);
    byIndicator.set(p.indicator_code, list);
  }
  for (const ind of QZXC_MATH_STANDARD.indicators) {
    const refined = byIndicator.get(ind.code);
    if (refined && refined.length > 0) ind.observation_points = refined;
  }
}

export const INDICATORS = QZXC_MATH_STANDARD.indicators;

export function indicatorsOfDimension(dimCode: string) {
  return QZXC_MATH_STANDARD.indicators.filter((i) => i.dimension_code === dimCode && i.enabled !== false);
}

export function dimensionByCode(code: string) {
  return QZXC_MATH_STANDARD.dimensions.find((d) => d.code === code);
}

/** 由 0-10 分数映射到档位 label */
export function bandLabelOf(dimCode: string, score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  const dim = dimensionByCode(dimCode);
  if (!dim) return null;
  const hit = dim.bands.find((b) => score >= b.min && score <= b.max) ?? dim.bands[0];
  return hit.label;
}
