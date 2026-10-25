// ============================================================
// AI（大模型）错误信息友好化
// 设计原则：底层技术错误（环境变量名、英文堆栈、HTTP 状态、模型内部代号）
// 只进服务端日志，绝不能原样展示给教研员。任何进入 ai_meta.error / 前端横幅
// 的文案都经过本模块映射为中性、可操作的中文提示。
// 本文件不依赖任何密钥与服务端能力，可同时被服务端与客户端安全引用。
// ============================================================

/** 判定一段文案是否疑似包含不应面向用户的技术细节 */
export function looksTechnical(message: string): boolean {
  return /deepseek|api[_-]?key|env|401|403|429|5\d{2}|timeout|abort|json|fetch|econn|enotfound|socket|exception|stack|typeerror|syntaxerror|undefined|null\b/i.test(
    message,
  );
}

/**
 * 把底层错误信息映射为用户可理解的中文提示；原始技术信息应由调用方另写服务端日志。
 * @param message 原始错误信息
 * @param prefix  来源前缀（如「转写文稿」），用于说明是哪一路材料未出 AI 结果
 */
export function friendlyAiError(message: string, prefix?: string): string {
  const raw = (message ?? '').toLowerCase();
  let tip: string;

  if (!raw || raw.includes('待分析材料为空') || raw.includes('暂无可供')) {
    tip = '缺少可供 AI 分析的文本材料，已使用内置规则完成评分';
  } else if (raw.includes('api_key') || raw.includes('未配置') || raw.includes('密钥')) {
    tip = 'AI 评分服务暂未配置，已使用内置规则完成评分';
  } else if (raw.includes('超时') || raw.includes('timeout') || raw.includes('abort')) {
    tip = 'AI 评分响应超时，已使用内置规则完成评分';
  } else if (raw.includes('429') || raw.includes('限流') || raw.includes('rate')) {
    tip = 'AI 评分服务当前繁忙，已使用内置规则完成评分';
  } else if (raw.includes('401') || raw.includes('403') || raw.includes('鉴权') || raw.includes('授权')) {
    tip = 'AI 评分服务暂不可用，已使用内置规则完成评分';
  } else if (raw.includes('json') || raw.includes('解析') || raw.includes('内容为空') || raw.includes('非法')) {
    tip = 'AI 返回内容异常，已使用内置规则完成评分';
  } else if (looksTechnical(message ?? '')) {
    tip = 'AI 评分暂时不可用，已使用内置规则完成评分';
  } else {
    // 已经是纯中文的业务提示，原样保留（避免二次加工）
    tip = message ?? 'AI 评分暂时不可用，已使用内置规则完成评分';
  }

  return prefix ? `${prefix}：${tip}` : tip;
}

/** 评语生成失败的用户侧提示 */
export function friendlyCommentaryError(): string {
  return 'AI 教学评语本次未生成，评分结果不受影响';
}
