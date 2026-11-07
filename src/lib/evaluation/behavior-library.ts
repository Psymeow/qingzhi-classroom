// ============================================================
// 教学行为库（V1.38）
//
// 用途：为报告的 action_items（「下一课时可执行的具体行为」）提供可选做法来源。
// 模型手上只有分数与指标名，没有行为库可选时，产出常是「加强追问」「多给表达机会」
// 这类方向性表述；有了本库，模型可以从命中维度的行为里挑具体做法，并引用其
// mechanism 解释「为什么这个做法能改善这个维度」。
//
// 仅供报告建议与 UI 提示使用，**不参与评分**——不进 signal-rules、不进 LLM 打分 prompt、
// 不影响任何分数。改动本文件需同步 review 报告建议的口径与提示文案。
//
// 行为编码 A1–A5 / B1–B6 / C1–C3 / D1–D4 / E1–E3 是行为库内部编号，
// 与维度编码 D1–D5（情智融合教学设计等）**不在同一命名空间**，两者无冲突。
// ============================================================

/** 五类教学行为，按课堂发生顺序排列 */
export type BehaviorFamily = '唤起' | '推进' | '互构' | '转化' | '固化';

export interface TeachingBehavior {
  /** 行为库内部编号（A/B/C/D/E 段），非维度码 */
  code: string;
  name: string;
  family: BehaviorFamily;
  /** 关联的维度码（D1–D5），命中任一即视为适用 */
  dims: string[];
  /** 可操作做法：一句话说清「怎么做」 */
  operating: string;
  /** 「可以这样问」：教师可直接对学生说出口的追问/引导话术 */
  ask: string;
  /** 机制：为什么这个做法有效，供模型在建议里解释理由 */
  mechanism: string;
}

export const TEACHING_BEHAVIORS: TeachingBehavior[] = [
  {
    code: 'A1',
    name: '认知冲突情境',
    family: '唤起',
    dims: ['D1', 'D2'],
    operating: '用与已有认知矛盾的素材开场，先让学生凭直觉表态，再用数学裁决',
    ask: '多数人凭直觉猜是 3，你的答案呢？我们动手算一算，看数学到底怎么说。',
    mechanism: '冲突产生惊奇，惊奇把"要我学"转成"我要弄明白"，认知在失衡中主动重组',
  },
  {
    code: 'A2',
    name: '真实问题锚定',
    family: '唤起',
    dims: ['D1'],
    operating: '从生活、科技或自然现象取材，让数学问题有真实的来处和去处',
    ask: '这件事就发生在我们身边，用今天要学的数学，你能不能把它算清楚、说明白？',
    mechanism: '真实感建立"这有用"的意义体验，意义感支撑持续投入；脱离真实则情境沦为包装',
  },
  {
    code: 'A3',
    name: '数学史与数学文化切入',
    family: '唤起',
    dims: ['D1', 'D3'],
    operating: '讲概念背后的争论、困境与人物，而非只讲结论与年份',
    ask: '你知道吗，这个结论当年让数学家争了很多年——他们到底卡在了哪里？',
    mechanism: '让学生看到数学是人做出来的、可犯错可争论，降低数学的疏离感与畏惧',
  },
  {
    code: 'A4',
    name: '具身操作引入',
    family: '唤起',
    dims: ['D1', 'D2'],
    operating: '以实物、学具或身体动作进入抽象概念，操作后必须回到语言概括',
    ask: '先动手摆一摆，摆完想一想：你发现了什么规律？用一句话把它说出来。',
    mechanism: '动作经验是抽象概念的脚手架；缺少概括则停留在操作层面，认知不升级',
  },
  {
    code: 'A5',
    name: '驱动性主问题',
    family: '唤起',
    dims: ['D1'],
    operating: '把全课收束成一个可探究的主问题，学生清楚这节课要解决什么',
    ask: '这节课我们就解决这一个问题：……你觉得应该从哪里入手？',
    mechanism: '明确目标产生掌控感，掌控感是投入的前提；目标涣散则参与流于忙碌',
  },
  {
    code: 'B1',
    name: '梯度问题链',
    family: '推进',
    dims: ['D2'],
    operating: '问题按复现—变式—提升—综合排序，前一问的答案是后一问的台阶',
    ask: '第 1 题会做了吗？第 2 题只比它多一步，你敢不敢顺着往下试试？',
    mechanism: '每次成功都成为下一次尝试的资本，形成成就与投入的正向累积',
  },
  {
    code: 'B2',
    name: '依据性追问',
    family: '推进',
    dims: ['D2', 'D5'],
    operating: '追问"你的依据是什么""你怎么知道"，而非直接判对错',
    ask: '你的依据是什么？你是怎么知道这一步一定对的？',
    mechanism: '迫使外显推理过程；评价对象从人转到证据，削弱被否定的威胁感',
  },
  {
    code: 'B3',
    name: '开放性问题与一题多解',
    family: '推进',
    dims: ['D2'],
    operating: '设计没有唯一入口的问题，收集不同解法并组织比较',
    ask: '还有没有别的解法？谁的方法和刚才那位不一样？',
    mechanism: '多样性传递"数学允许不同想法"，保护独立思考，避免思维趋同',
  },
  {
    code: 'B4',
    name: '变式题组',
    family: '推进',
    dims: ['D2'],
    operating: '保持本质不变，只改情境、数据或表述，让学生识别不变结构',
    ask: '数字变了、情境也换了，但什么东西一直没变？你发现了吗？',
    mechanism: '在变化中看见不变，促进迁移；同时传递错一次不要紧，结构才重要',
  },
  {
    code: 'B5',
    name: '分层任务',
    family: '推进',
    dims: ['D2', 'D4'],
    operating: '同一目标配基础与挑战两档任务，人人有可完成的入口和可攀登的高度',
    ask: '先把基础题做完；挑战题留给还想往上走一步的同学。',
    mechanism: '匹配难度产生胜任感；统一难度会导致底层挫败、顶层无聊',
  },
  {
    code: 'B6',
    name: '支架式点拨',
    family: '推进',
    dims: ['D2', 'D4'],
    operating: '学生卡住时给提示、图示或反例，不直接给答案，给出后及时撤除',
    ask: '卡住了？我给你画个图当提示，剩下的你自己来。',
    mechanism: '保住"自己想出来的"体验，成就归学生；直接给答案则剥夺了这一强化',
  },
  {
    code: 'C1',
    name: '结构化小组合作',
    family: '互构',
    dims: ['D4'],
    operating: '先独立思考再交流，分工明确（主讲、质疑、记录），随机抽人汇报',
    ask: '先自己想一想，再和组员说；最后我们随机请人汇报，每个人都要准备好。',
    mechanism: '独立思考是有效发言的前提，避免搭便车；随机汇报维持全员准备',
  },
  {
    code: 'C2',
    name: '思维外显与全班分享',
    family: '互构',
    dims: ['D2', 'D4'],
    operating: '让学生讲思路而非报答案，教师板书整理成可比较的结构',
    ask: '别急着说答案，先说说你第一步为什么这么做。',
    mechanism: '表达是思维的整理；看到同伴的思路可校正自身理解，形成认知互构',
  },
  {
    code: 'C3',
    name: '同伴情感支持',
    family: '互构',
    dims: ['D3', 'D4'],
    operating: '分享时先让同伴复述解题思路再说评价，用"我也卡在这里过"替代居高临下',
    ask: '先复述一下他的思路，再说你同意还是不同意、哪里可以补充。',
    mechanism: '同伴认同降低被评价的羞耻，让错误暴露变得安全，参与面随之扩大',
  },
  {
    code: 'D1',
    name: '错误资源化',
    family: '转化',
    dims: ['D3', 'D5'],
    operating: '典型错解投影对比，让学生指出错在哪一步；三级递进：允许犯错—利用错误—错误驱动学习',
    ask: '这个错法很有价值——谁能指出它到底错在哪一步？',
    mechanism: '错误暴露认知的分界，被加工的错误转化为全班的理解；错误不加工则会被重复记住',
  },
  {
    code: 'D2',
    name: '容错氛围营造',
    family: '转化',
    dims: ['D3', 'D4'],
    operating: '教师主动示范"我也错过""这个错法很有价值"，对错误答案先致谢再分析',
    ask: '没关系，老师自己也错过；先谢谢你的想法，我们一起来看看它卡在哪。',
    mechanism: '心理安全是冒险的前提；没有安全，学生会隐瞒错误以保全自我',
  },
  {
    code: 'D3',
    name: '描述性即时反馈',
    family: '转化',
    dims: ['D5', 'D3'],
    operating: '用"你把尺子放平了，所以量准了"替代"真棒"；优点加问题加建议三段式',
    ask: '你把尺子放平了，所以量得准；下次还可以再检查一下单位对不对。',
    mechanism: '描述性反馈告诉学生具体哪里好、怎么改进，把表扬转成可执行的下一步',
  },
  {
    code: 'D4',
    name: '困境中的韧性护航',
    family: '转化',
    dims: ['D3'],
    operating: '难题中段学生放弃时先承认难度，再拆小步骤或换入口，不降低目标',
    ask: '这道题确实难。我们把它拆成两步，先一起拿下第一步。',
    mechanism: '传递"难是可以被拆解的"，把挫败归因于策略而非能力，保护坚持意愿',
  },
  {
    code: 'E1',
    name: '结构化反思引导',
    family: '固化',
    dims: ['D5'],
    operating: '课末引导"今天最重要的方法是什么""它还能用在哪里"，而非只问懂了吗',
    ask: '今天最重要的一个方法是什么？它还能用到哪一类问题上？',
    mechanism: '把零散经验整理成可迁移的认知结构，完成从经历到能力的转化',
  },
  {
    code: 'E2',
    name: '自评与互评',
    family: '固化',
    dims: ['D5'],
    operating: '给出具体量规（如能否说清算理），让学生对照打分并说明理由',
    ask: '对照这条标准，你给自己打几分？说说你的理由。',
    mechanism: '元认知被激活，学生从被评价者转为评价标准的持有者',
  },
  {
    code: 'E3',
    name: '价值点拨',
    family: '固化',
    dims: ['D3', 'D5'],
    operating: '点出数学之美、之用、之严谨，从具体做法上升到数学是这样看世界的',
    ask: '你看，数学用这么简洁的式子就说清了这件事，漂亮吗？',
    mechanism: '把一次课堂体验固化为对学科的认同，情感由情境性转为稳定性',
  },
];

/** 五类名称，供 UI 分组展示 */
export const BEHAVIOR_FAMILY_ORDER: BehaviorFamily[] = ['唤起', '推进', '互构', '转化', '固化'];

/** 按维度筛选：命中任一 dimCode 即保留 */
export function pickBehaviors(dimCodes: string[], limit = 3): TeachingBehavior[] {
  const wanted = new Set(dimCodes);
  const scored = TEACHING_BEHAVIORS.filter((b) => b.dims.some((d) => wanted.has(d)));
  // 命中维度多的排前：同一行为覆盖多维更可能适配多类短板
  scored.sort((a, b) => {
    const hitA = a.dims.filter((d) => wanted.has(d)).length;
    const hitB = b.dims.filter((d) => wanted.has(d)).length;
    return hitB - hitA;
  });
  return scored.slice(0, limit);
}

/** 生成给 LLM 的紧凑提示段：不含 mechanism/ask，避免 prompt 膨胀 */
export function behaviorHintText(dimCodes: string[]): string {
  const wanted = new Set(dimCodes);
  const lines = TEACHING_BEHAVIORS.filter((b) => b.dims.some((d) => wanted.has(d))).map(
    (b) => `${b.code} ${b.name}（${b.dims.join('/')}）：${b.operating}`,
  );
  return lines.join('\n');
}
