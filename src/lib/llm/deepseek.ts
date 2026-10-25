import 'server-only';

// ============================================================
// AI（DeepSeek）服务端客户端
// 仅允许在服务端（Route Handler / Server Action）引入，避免密钥进入客户端 bundle。
// 配置来源（环境变量）：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL
// 设计原则：
//  1) 所有失败都收敛为 LlmError，由调用方捕获并降级到规则引擎，绝不影响主流程；
//  2) 技术细节（密钥名、HTTP 状态、响应体、英文堆栈）只写服务端 console，
//     抛出的 message 一律是中性中文，避免经 ai_meta.error 原样暴露给教研员。
// ============================================================

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
// 单次请求超时：控制在平台函数超时内，并保证失败后仍有时间走规则引擎降级。
const DEFAULT_TIMEOUT_MS = 45_000;

/** AI 调用相关错误（配置缺失、网络失败、超时、返回非法 JSON） */
export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}

export function llmApiKey(): string | null {
  const k = process.env.DEEPSEEK_API_KEY?.trim();
  return k ? k : null;
}

/** 是否具备调用条件（已配置密钥） */
export function isLlmEnabled(): boolean {
  return llmApiKey() !== null;
}

export function llmModel(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatJsonOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
}

/**
 * 调用 AI Chat Completions，强制 JSON 输出并解析为对象。
 * 失败统一抛 LlmError；调用方必须捕获并降级，不得让异常冒泡成 500。
 */
export async function chatJson<T>(messages: ChatMessage[], opts: ChatJsonOptions = {}): Promise<T> {
  const key = llmApiKey();
  if (!key) {
    console.error('[llm] DEEPSEEK_API_KEY 未配置，跳过 AI 调用并降级到规则引擎');
    throw new LlmError('AI 评分服务暂不可用');
  }

  const base = (process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: llmModel(),
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 4096,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[llm] AI 接口返回非 2xx：', res.status, detail.slice(0, 180));
      throw new LlmError(res.status === 429 ? 'AI 评分服务当前繁忙' : 'AI 评分服务暂时不可用');
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[llm] AI 返回 choices 为空');
      throw new LlmError('AI 返回内容为空');
    }

    return parseJsonObject<T>(content);
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new LlmError('AI 评分响应超时');
    console.error('[llm] AI 调用失败：', e instanceof Error ? e.message : String(e));
    throw new LlmError('AI 评分服务暂时不可用');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 调用 AI Chat Completions，返回纯文本回答（问答助手用，不强制 JSON）。
 * 失败统一抛 LlmError，message 已是中性中文，可直接展示给用户。
 */
export interface ChatTextOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export async function chatText(messages: ChatMessage[], opts: ChatTextOptions = {}): Promise<string> {
  const key = llmApiKey();
  if (!key) {
    console.error('[llm] DEEPSEEK_API_KEY 未配置，问答助手不可用');
    throw new LlmError('问答助手暂不可用：还没配置 DEEPSEEK_API_KEY');
  }

  const base = (process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: llmModel(),
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 1600,
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error('[llm] chatText 接口返回非 2xx：', res.status, detail.slice(0, 180));
      throw new LlmError(res.status === 429 ? 'AI 助手当前繁忙，稍后再试' : 'AI 助手暂时不可用');
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      console.error('[llm] chatText 返回 choices 为空');
      throw new LlmError('AI 助手没有返回内容');
    }
    return content.trim();
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new LlmError('AI 助手响应超时，换个问法或稍后再试');
    console.error('[llm] chatText 调用失败：', e instanceof Error ? e.message : String(e));
    throw new LlmError('AI 助手暂时不可用');
  } finally {
    clearTimeout(timer);
  }
}

/** 宽松解析：兼容模型包裹 ```json 代码块或前后夹带解释文字的情况 */
export function parseJsonObject<T>(raw: string): T {
  const text = raw.trim();
  const candidates: string[] = [text];

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // 尝试下一个候选
    }
  }
  console.error('[llm] AI 返回内容不是合法 JSON：', text.slice(0, 180));
  throw new LlmError('AI 返回内容异常');
}
