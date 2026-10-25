// ============================================================
// 课型自动识别（V1.3）
// 依据《AIC 课型手册 1.0》数学部分 2.1—2.5 的课型定位与「主要学习活动」，
// 用 LLM 判定一节课最接近哪种课型，作为评价模型的路由键。
// 识别失败不阻断分析：抛 LlmError，由调用方让用户手工指定课型。
// ============================================================
import 'server-only';

import { LlmError, chatJson, isLlmEnabled, llmModel } from '@/lib/llm/deepseek';
import {
  LESSON_TYPE_MODELS,
  LESSON_TYPE_ORDER,
  normalizeLessonType,
  type GradeBand,
  type LessonTypeCode,
} from '@/lib/evaluation/lesson-type-models';

export interface LessonTypeDetection {
  lesson_type: LessonTypeCode;
  lesson_type_name: string;
  /** 0-1，模型自评置信度 */
  confidence: number;
  /** 判定依据（引用课堂事实） */
  basis: string;
  model: string;
  /** 五个课型的接近程度，便于人工复核 */
  candidates: { code: LessonTypeCode; score: number }[];
}

export interface LessonTypeDetectInput {
  title?: string | null;
  subject?: string | null;
  /** 年级/班级文本，用于选择对应学段的「主要学习活动」词表 */
  grade?: string | null;
  transcript?: string | null;
  observerText?: string | null;
}

interface RawDetection {
  lesson_type?: string;
  confidence?: number;
  basis?: string;
  candidates?: { code?: string; score?: number }[];
}

const MAX_DETECT_CHARS = 12_000;

const BAND_LABEL: Record<GradeBand, string> = {
  primary: '小学',
  junior: '初中',
  senior: '高中',
};

/** 由年级/班级文本推断学段（决定加载哪一套「主要学习活动」词表） */
export function gradeBandOf(grade?: string | null): GradeBand {
  const g = (grade ?? '').trim();
  if (/高中|高一|高二|高三/.test(g)) return 'senior';
  if (/初中|初一|初二|初三|七年级|八年级|九年级|7年级|8年级|9年级/.test(g)) return 'junior';
  return 'primary';
}

function buildTypeBrief(band: GradeBand): string {
  return LESSON_TYPE_ORDER.map((code) => {
    const m = LESSON_TYPE_MODELS[code];
    const acts = (m.activities[band] ?? []).join('、');
    return [
      `【${m.code}】${m.name}（手册 ${m.manual_section}）`,
      `定位：${m.summary}`,
      `${BAND_LABEL[band]}主要学习活动：${acts}`,
    ].join('\n');
  }).join('\n\n');
}

function buildSystemPrompt(): string {
  return [
    '你是中小学数学课堂观察专家，熟悉《AIC 课型手册》对数学课型的界定。',
    '任务：仅根据给定的课例信息与课堂材料，判断这节课最接近哪一种课型。',
    '',
    '判定规则：',
    '1. 依据课堂实际发生的主要学习活动判定，不要依据课题名称、知识点或学科内容判定。',
    '2. 五个课型互斥，lesson_type 只能取其一。',
    '3. 材料不足以判定时，仍须给出最接近的一项，但把 confidence 调到 0.4 以下。',
    '4. basis 必须引用材料中的具体事实（活动环节、师生活动、任务形式），不得空泛套话。',
    '',
    '只输出一个 JSON 对象，不要输出解释文字或 markdown 代码块，结构如下：',
    '{"lesson_type":"new|review|comment|practice|topic","confidence":0.85,"basis":"……","candidates":[{"code":"new","score":0.9}]}',
    'candidates 必须覆盖全部五个课型，score 为 0-1 的接近程度。',
  ].join('\n');
}

function buildUserPrompt(input: LessonTypeDetectInput, band: GradeBand, text: string): string {
  return [
    '【课例信息】',
    `课题：${input.title?.trim() || '（未提供）'}`,
    `学科：${input.subject?.trim() || '数学'}`,
    `年级：${input.grade?.trim() || '（未提供，按小学处理）'}`,
    '',
    `【课型界定（${BAND_LABEL[band]}）】`,
    buildTypeBrief(band),
    '',
    '【课堂材料】',
    text,
    '',
    '请判断这节课最接近哪一种课型，并按要求输出 JSON。',
  ].join('\n');
}

/**
 * 自动识别课型。
 * 未配密钥、材料为空或模型返回不可用时抛 LlmError，绝不阻断分析主流程。
 */
export async function detectLessonType(input: LessonTypeDetectInput): Promise<LessonTypeDetection> {
  if (!isLlmEnabled()) throw new LlmError('未配置 DEEPSEEK_API_KEY');
  const text = [input.transcript, input.observerText]
    .map((t) => (t ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
  if (!text) throw new LlmError('暂无可供识别的课堂材料（转写文稿或观察记录）');

  const band = gradeBandOf(input.grade);
  const clipped = text.length > MAX_DETECT_CHARS ? text.slice(0, MAX_DETECT_CHARS) : text;

  const raw = await chatJson<RawDetection>(
    [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(input, band, clipped) },
    ],
    { temperature: 0.1, maxTokens: 1024 },
  );

  const candidates = (raw.candidates ?? [])
    .map((c) => {
      const code = normalizeLessonType(c.code);
      const score =
        typeof c.score === 'number' && Number.isFinite(c.score)
          ? Math.min(1, Math.max(0, c.score))
          : 0;
      return code ? { code, score } : null;
    })
    .filter((c): c is { code: LessonTypeCode; score: number } => c !== null);

  let code = normalizeLessonType(raw.lesson_type);
  if (!code && candidates.length) {
    code = [...candidates].sort((a, b) => b.score - a.score)[0].code;
  }
  if (!code) throw new LlmError('AI 未能确定课型，请在下方手工选择');

  const hit = candidates.find((c) => c.code === code);
  const rawConf =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? raw.confidence
      : (hit?.score ?? 0.5);
  const confidence = Math.round(Math.min(1, Math.max(0, rawConf)) * 100) / 100;

  return {
    lesson_type: code,
    lesson_type_name: LESSON_TYPE_MODELS[code].name,
    confidence,
    basis: (raw.basis ?? '').trim() || '（模型未给出判定依据）',
    model: llmModel(),
    candidates: candidates.length ? candidates : [{ code, score: confidence }],
  };
}
