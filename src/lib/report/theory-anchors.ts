// ============================================================
// 维度理论锚点（V1.26）：给报告的五个维度挂上可追溯的文献依据。
// 内容取自《数学「情智相长」课堂的理论基础》（APA 第 7 版核实版），
// 文献题录与该文档 References 逐条对应，不新编、不改写、不夸大。
// 用途：让报告里每一个维度分都能回答「凭什么这么评」。
// ============================================================

export interface TheoryAnchor {
  /** 收起状态下显示的一句话主张 */
  claim: string;
  /** 展开后的完整理论说明 */
  detail: string;
  /** APA 7 悬挂式参考文献（与理论文档一致） */
  bibliography: string[];
}

export const THEORY_ANCHORS: Record<string, TheoryAnchor> = {
  D1: {
    claim: '情感是认知的组成部分而非学习背景，情智融合设计有神经科学与情绪机制双重依据',
    detail:
      '教育神经科学证据表明，情绪过程深度参与注意、记忆、决策与推理，脱离情感的「纯理性学习」在神经层面并不存在（Immordino-Yang & Damasio, 2007）。控制-价值理论进一步指出，学生对活动的价值评估是学业情绪的近端前因，因而是教学设计可以直接干预的环节（Pekrun, 2006）——这正是本维度要求「情境兼具数学探究价值与情感唤起功能」的理论依据。',
    bibliography: [
      'Immordino-Yang, M. H., & Damasio, A. (2007). We feel, therefore we learn: The relevance of affective and social neuroscience to education. Mind, Brain, and Education, 1(1), 3–10. https://doi.org/10.1111/j.1751-228X.2007.00004.x',
      'Pekrun, R. (2006). The control-value theory of achievement emotions: Assumptions, corollaries, and implications for educational research and practice. Educational Psychology Review, 18(4), 315–341. https://doi.org/10.1007/s10648-006-9029-9',
    ],
  },
  D2: {
    claim: '高阶思维在理论上依赖心理安全与积极情绪条件，思维与情感需联合解读',
    detail:
      '拓展-建构理论指出，积极情绪能拓宽个体的注意与思维-行动序列并建构持久资源（Fredrickson, 2001），因此发散、多解、迁移、质疑等高阶表现更可能出现在积极情绪充盈、心理安全的环节——这是思维与情感各占 25%、且要求联合解读而非孤立算分的依据。数学思维的过程观则把「卡住」这一情绪事件明确写进思维三阶段，数学思维本身就是情智交织的活动（Mason et al., 2010）。',
    bibliography: [
      'Fredrickson, B. L. (2001). The role of positive emotions in positive psychology: The broaden-and-build theory of positive emotions. American Psychologist, 56(3), 218–226. https://doi.org/10.1037/0003-066X.56.3.218',
      'Mason, J., Burton, L., & Stacey, K. (2010). Thinking mathematically (2nd ed.). Harlow, England: Pearson.',
    ],
  },
  D3: {
    claim: '数学情感域自 1990 年代起即有独立实证传统，属可测量的教育变量而非软性主观指标',
    detail:
      '数学教育学科内部把情感域概念化为信念、态度、情绪三类成分（McLeod, 1992）。数学焦虑是其中证据最充分的构念：对 26 项研究的元分析得到其与数学成就的总体相关 r = −.27，且该关系在性别、年级、族群间高度稳定（Ma, 1999）；机制上，焦虑产生的担忧性思维占用工作记忆、直接损害高负荷数学任务表现（Eysenck & Calvo, 1992; Ashcraft, 2002）。这为「心理调适」类观察点以及「高压提问并非中性教学行为」的判定提供了因果层面的必要性论证。',
    bibliography: [
      'Ashcraft, M. H. (2002). Math anxiety: Personal, educational, and cognitive consequences. Current Directions in Psychological Science, 11(5), 181–185. https://doi.org/10.1111/1467-8721.00196',
      'Eysenck, M. W., & Calvo, M. G. (1992). Anxiety and performance: The processing efficiency theory. Cognition & Emotion, 6(6), 409–434. https://doi.org/10.1080/02699939208409696',
      'Ma, X. (1999). A meta-analysis of the relationship between anxiety toward mathematics and achievement in mathematics. Journal for Research in Mathematics Education, 30(5), 520–540. https://doi.org/10.2307/749772',
      'McLeod, D. B. (1992). Research on affect in mathematics education: A reconceptualization. In D. A. Grouws (Ed.), Handbook of research on mathematics teaching and learning (pp. 575–596). New York, NY: Macmillan.',
    ],
  },
  D4: {
    claim: '课堂情绪环境是课堂层面的共享变量，须在整节课乃至跨课例层面观察与评价',
    detail:
      '对数学课堂的多层分析表明，学生感知到的课堂环境显著预测其愉悦、焦虑等情绪体验，存在课堂层面的共享情绪成分（Frenzel et al., 2007）；教师的教学愉悦可经课堂互动传递给学生（Frenzel et al., 2009）——这说明教师的情绪表现是观察对象，而非无关的教学风格。自我决定理论则给出课堂实施的三类基本心理需要（自主、胜任、关系），并指出自主支持型教学显著促进内在动机与深度学习（Ryan & Deci, 2000），构成本维度教师侧与学生侧双侧设计的依据。',
    bibliography: [
      'Frenzel, A. C., Goetz, T., Lüdtke, O., Pekrun, R., & Sutton, R. E. (2009). Emotional transmission in the classroom: Exploring the relationship between teacher and student enjoyment. Journal of Educational Psychology, 101(3), 705–716. https://doi.org/10.1037/a0014695',
      'Frenzel, A. C., Pekrun, R., & Goetz, T. (2007). Perceived learning environment and students\' emotional experiences: A multilevel analysis of mathematics classrooms. Learning and Instruction, 17(5), 478–493. https://doi.org/10.1016/j.learninstruc.2007.09.001',
      'Ryan, R. M., & Deci, E. L. (2000). Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being. American Psychologist, 55(1), 68–78. https://doi.org/10.1037/0003-066X.55.1.68',
    ],
  },
  D5: {
    claim: '「评价—反馈—改进」闭环是自我调节学习三阶段循环在课堂中的落地形式',
    detail:
      '自我调节学习被界定为「预先思考—表现—自我反思」的循环，且是可在反馈与支架中发展的过程技能而非固定特质（Zimmerman, 2002）。成长型思维研究进一步规范了反馈语言：应做过程性、可改进的描述，而非分等定质性判断（Dweck, 2016）；控制-价值理论亦指出反馈性质会反过来重塑学生的控制感与后续情绪（Pekrun, 2006）。本维度的改进处方与回收设计，与上述反馈伦理一致。',
    bibliography: [
      'Dweck, C. S. (2016). Mindset: The new psychology of success (Updated ed.). New York, NY: Random House.',
      'Pekrun, R. (2006). The control-value theory of achievement emotions: Assumptions, corollaries, and implications for educational research and practice. Educational Psychology Review, 18(4), 315–341. https://doi.org/10.1007/s10648-006-9029-9',
      'Zimmerman, B. J. (2002). Becoming a self-regulated learner: An overview. Theory Into Practice, 41(2), 64–70. https://doi.org/10.1207/s15430421tip4102_2',
    ],
  },
};

/**
 * 报告尾部参考文献区使用：按给定维度 code 收集引用并去重。
 * 调用方负责排序（本项目在渲染处按字母序排，符合 APA 惯例）。
 */
export function collectBibliography(codes: string[]): string[] {
  const set = new Set<string>();
  for (const c of codes) {
    for (const b of THEORY_ANCHORS[c]?.bibliography ?? []) set.add(b);
  }
  return [...set];
}

/**
 * 方法学声明：诚实交代 AI 的判定边界。
 * 在学术与教研语境下，说明工具的局限比宣称全能更能建立信任。
 */
export const METHODOLOGY_NOTE =
  '本报告的维度分与观察点判定由 AI 模型基于课堂音视频转写、人工观察记录等材料生成，' +
  '遵循「无证据不给分」原则——某观察点缺少对应来源材料时一律留空，不作臆测补全。' +
  '标注「待复核」的维度表示多来源之间存在分歧或对账缺口，应由教研员人工终裁。' +
  '本工具用于支持课堂观察与教研讨论，不替代人工专业判断。';
