import type { DataSource } from "./types";

// ============================================================
// 语义匹配规则（可配置、可迭代）
// V1.1：对「导入的转写文稿/观察文本」做规则化语义匹配，产出指标命中与证据。
// 命中关键词 → 对应指标正/负向信号；不写死在算法流程里，后续可被后台配置或模型替换。
// V1.2：接入 LLM 后，本文件作为规则兜底与冷启动，模型分与规则分可并存。
// ============================================================

export interface SignalRule {
  indicator_code: string;
  /** 正向信号词（出现代表该思维/情感显现） */
  positive: string[];
  /** 负向信号词（出现代表缺失/反面） */
  negative?: string[];
  /** 正向命中基础分上限（0-10） */
  strong_score?: number;
  /** 弱命中基础分 */
  weak_score?: number;
}

/** 指标 → 语义规则。覆盖高阶思维 11 项与情感素养 8 项。 */
export const INDICATOR_SIGNAL_RULES: SignalRule[] = [
  // ---- 高阶思维 D2 ----
  { indicator_code: "D2-1", positive: ["概括", "归纳", "总结一下", "共同特点", "一般规律", "本质", "定义", "由此可得", "抽象出", "用字母表示", "推广到"], negative: ["只记结论", "背下来"], strong_score: 7.5 },
  { indicator_code: "D2-2", positive: ["不同方法", "另一种", "还有别的", "换个角度", "多种", "你怎么想", "不同思路", "解法一", "解法二"], strong_score: 7 },
  { indicator_code: "D2-3", positive: ["哪种更好", "比较", "最优", "更简便", "你选哪", "择优", "为什么这个方法", "优化"], strong_score: 7 },
  { indicator_code: "D2-4", positive: ["如果", "换一个", "新的问题", "迁移", "运用到", "类似地", "那如果是", "推广", "举一反三"], strong_score: 7 },
  { indicator_code: "D2-5", positive: ["为什么", "质疑", "不对吧", "凭什么", "一定吗", "有没有问题", "反问", "真的吗", "我有疑问", "等一下"], strong_score: 7.5 },
  { indicator_code: "D2-6", positive: ["转化", "化归", "分解", "拆成", "变成我们会的", "先看", "等价于", "降次", "整体代换"], strong_score: 7 },
  { indicator_code: "D2-7", positive: ["反过来", "一方面", "另一方面", "既又", "对立", "反过来想", "辩证", "互逆", "正难则反"], strong_score: 6.5 },
  { indicator_code: "D2-8", positive: ["综合", "整合", "结合刚才", "联系", "补充", "你的意思是", "完善一下", "合起来", "重构"], strong_score: 7 },
  { indicator_code: "D2-9", positive: ["拓展", "延伸", "再进一步", "如果继续", "更一般", "推广到", "还能发现什么", "课后思考"], strong_score: 6.5 },
  { indicator_code: "D2-10", positive: ["类比", "联想到", "像什么", "好像", "类似", "由此想到", "关联", "相当于生活中"], strong_score: 6.5 },
  { indicator_code: "D2-11", positive: ["我发现", "猜想", "直觉", "顿悟", "突然想到", "独创", "新的", "我有个大胆", "意料之外"], strong_score: 7.5 },

  // ---- 情感素养 D3 ----
  { indicator_code: "D3-1", positive: ["哇", "原来如此", "为什么", "好奇", "有趣", "还想知道", "太神奇", "再来", "兴趣", "怎么会"], negative: ["不想学", "没意思"], strong_score: 7 },
  { indicator_code: "D3-2", positive: ["没关系", "再试", "坚持", "不放弃", "换个方法", "加油", "重新审题", "遇到困难", "耐心", "草稿"], negative: ["放弃", "太难了我不做"], strong_score: 7 },
  { indicator_code: "D3-3", positive: ["因为", "所以", "首先其次", "数学语言", "术语", "表达式", "符号", "也就是说", "我的思路是", "证明"], strong_score: 7 },
  { indicator_code: "D3-4", positive: ["小组", "合作", "分工", "讨论", "一起", "互相检查", "你来记录", "我们组", "交流", "帮忙"], strong_score: 7.5 },
  { indicator_code: "D3-5", positive: ["证据", "验证", "证明", "依据", "严谨", "不能凭感觉", "推理", "符合", "检验一下", "实事求是"], strong_score: 7 },
  { indicator_code: "D3-6", positive: ["生活中", "实际", "用到", "数学有用", "现实", "购物", "测量", "统计身高", "解决问题", "应用"], strong_score: 6.5 },
  { indicator_code: "D3-7", positive: ["数学美", "漂亮", "简洁", "自信", "我喜欢数学", "有成就感", "对称", "和谐"], strong_score: 6 },
  { indicator_code: "D3-8", positive: ["真实", "数据不能改", "责任", "帮助", "客观", "如实", "服务", "社区", "伦理"], strong_score: 6 },
];

/** 转写说话人切分行（支持 “师：”“生1：”“[00:12] 生：” 等） */
export interface Utterance {
  speaker?: string;
  time_sec?: number;
  text: string;
}

const TIME_RE = /\[?(\d{1,2}):(\d{2})(?::\d{2})?\]?/;
const SPEAKER_RE = /^\s*(?:\[[^\]]*\]\s*)?(师|老师|生\d*|学生\d*|男生|女生|T|S|Speaker\s*\d+|[A-Za-z]+)\s*[:：、.]\s*/;

export function parseTranscript(raw: string): Utterance[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      let time_sec: number | undefined;
      const tm = line.match(TIME_RE);
      if (tm) {
        const mm = parseInt(tm[1], 10);
        const ss = parseInt(tm[2], 10);
        time_sec = mm * 60 + ss;
        line = line.replace(TIME_RE, "").trim();
      }
      let speaker: string | undefined;
      const sp = line.match(SPEAKER_RE);
      if (sp) {
        speaker = sp[1];
        line = line.slice(sp[0].length).trim();
      }
      return { speaker, time_sec, text: line };
    });
}

export interface MatchHit {
  indicator_code: string;
  polarity: "positive" | "negative";
  keyword: string;
  evidence: string;
  speaker?: string;
  time_sec?: number;
}

/** 对一段文本（转写或观察记录）跑规则匹配 */
export function matchSignals(utterances: Utterance[], source: DataSource): MatchHit[] {
  const hits: MatchHit[] = [];
  for (const rule of INDICATOR_SIGNAL_RULES) {
    for (const u of utterances) {
      for (const kw of rule.positive) {
        if (u.text.includes(kw)) {
          hits.push({
            indicator_code: rule.indicator_code,
            polarity: "positive",
            keyword: kw,
            evidence: u.text.slice(0, 120),
            speaker: u.speaker,
            time_sec: u.time_sec,
          });
        }
      }
      for (const kw of rule.negative ?? []) {
        if (u.text.includes(kw)) {
          hits.push({
            indicator_code: rule.indicator_code,
            polarity: "negative",
            keyword: kw,
            evidence: u.text.slice(0, 120),
            speaker: u.speaker,
            time_sec: u.time_sec,
          });
        }
      }
    }
  }
  return hits;
}

/** 由命中信号估算单指标 0-10 分（规则冷启动；命中数饱和、负向拉低） */
export function scoreFromHits(
  indicator_code: string,
  hits: MatchHit[],
): { score: number | null; evidences: string[]; confidence: number } {
  const rule = INDICATOR_SIGNAL_RULES.find((r) => r.indicator_code === indicator_code);
  const mine = hits.filter((h) => h.indicator_code === indicator_code);
  if (!rule || mine.length === 0) return { score: null, evidences: [], confidence: 0 };

  const pos = mine.filter((h) => h.polarity === "positive");
  const neg = mine.filter((h) => h.polarity === "negative");
  const cap = rule.strong_score ?? 7;
  // 命中 1 次约到 cap*0.75，3 次趋稳到 cap，再多边际递减
  const n = pos.length;
  let score = cap * (1 - Math.exp(-n / 1.6));
  // 负向每次拉低，最多拉 3 分
  score = Math.max(0, score - Math.min(3, neg.length * 1.2));
  score = Math.min(10, Math.round(score * 10) / 10);

  const evidences = mine.slice(0, 4).map((h) =>
    h.time_sec !== undefined
      ? `[${fmtTime(h.time_sec)}${h.speaker ? " " + h.speaker : ""}] ${h.evidence}`
      : `${h.speaker ? h.speaker + "：" : ""}${h.evidence}（${h.polarity === "positive" ? "正向" : "负向"}词“${h.keyword}”）`,
  );
  // 置信度随命中数提升，规则法上限 0.6（留给后续模型/人工）
  const confidence = Math.min(0.6, 0.3 + n * 0.1);
  return { score, evidences, confidence };
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
