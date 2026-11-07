/**
 * 数学表达式后处理层（口语数学 → 符号数学）。
 *
 * 背景：平台 ASR 只回纯文本（见 timeline.ts 顶部说明），课堂口语里的数学表达会被识别成汉字，
 * 例如「a加b不等于0」「x的平方」「根号2」「c除以a加b」。转写文稿里满是口语数学，
 * 既难读，也影响下游可读性（对 signal-rules 的词表匹配则无副作用——其词表均为语义词）。
 *
 * 本层在 ASR 拿到文本后、时间轴对齐前做一次「高置信、保守」的符号化还原：
 * 只替换数学语境下确定性表达，绝不碰普通话语（「增加」「乘法」「不大于」等不受影响）。
 *
 * 定位：规则词典是冷启动与兜底；更复杂 / 长尾的口语数学（如「a分之b加c的和」）可接 LLM 精修，
 * 但 LLM 会增加转写延迟与成本，故当前不默认启用，仅在词典无法覆盖时由上层决定是否兜底。
 */

/** 可作为运算符两侧「操作数」的字符：字母、数字，以及已符号化的幂/根号结果。 */
const OPERAND = String.raw`[0-9a-zA-Z²³ⁿ√π]`;

/** 二元运算：操作数之间夹口语运算符 → 符号。带边界，避免「增加/乘法/减少」等误伤。 */
function op(text: string, word: string, sym: string): string {
  const re = new RegExp(`(${OPERAND})\\s*${word}\\s*(${OPERAND})`, 'g');
  return text.replace(re, `$1${sym}$2`);
}

/** 对整段转写文本做口语数学符号化还原。 */
export function normalizeMath(text: string): string {
  if (!text) return text;
  let out = text;

  // 1) 不等式（「不等于」须先于「等于」处理，避免被拆成「不=」）
  out = out.replace(/不等于/g, '≠');
  out = out.replace(/大于等于/g, '≥');
  out = out.replace(/小于等于/g, '≤');
  out = out.replace(/大于/g, '>');
  out = out.replace(/小于/g, '<');

  // 2) 幂次（「的2/3次方」与「的平方/立方」统一成上标，其余数字次方用 ^n）
  out = out.replace(/的平方/g, '²');
  out = out.replace(/的立方/g, '³');
  out = out.replace(/的2次方/g, '²');
  out = out.replace(/的3次方/g, '³');
  out = out.replace(/的n次方/g, 'ⁿ');
  out = out.replace(/的(\d+)次方/g, '^$1');

  // 3) 根号
  out = out.replace(/根号下/g, '√');
  out = out.replace(/根号/g, '√');

  // 4) 分数（「a分之b」 → 「b/a」）
  out = out.replace(/([0-9a-zA-Z]+)分之([0-9a-zA-Z]+)/g, '$2/$1');

  // 5) 二元运算（先「乘以/除以」再「加/减/乘」，边界已隔离，顺序仅作可读性）
  out = op(out, '乘以', '×');
  out = op(out, '除以', '÷');
  out = op(out, '加', '+');
  out = op(out, '减', '-');
  out = op(out, '乘', '×');

  // 6) 等于（「不等于」已在第 1 步转成 ≠）
  out = out.replace(/等于/g, '=');

  return out;
}
