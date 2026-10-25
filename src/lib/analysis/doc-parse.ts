import 'server-only';
import { Config, FetchClient } from 'coze-coding-dev-sdk';
import { signObjectUrl } from '@/lib/storage/s3';

// ============================================================
// 文档 → 文本解析（V1.4 学生任务单 / 观察记录通道）
// 流程：对象存储 key → 临时签名 URL → FetchClient 拉取并解析
//      （PDF / Word / Excel / PPT / 图片 OCR / txt / epub 等）。
// 解析失败不抛异常，返回 ok=false 与可读原因，由调用方落 parse_status。
// ============================================================

/** 单份材料解析后保留的最大字符数（与转写文稿上限对齐） */
const MAX_TEXT_CHARS = 120_000;

export interface DocParseResult {
  ok: boolean;
  text: string;
  title?: string;
  error?: string;
}

let cachedClient: FetchClient | null = null;

function getClient(): FetchClient {
  if (!cachedClient) cachedClient = new FetchClient(new Config());
  return cachedClient;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Windows-1252 在 0x80–0x9F 区间映射出的码点（下标 + 0x80 = 原始字节） */
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];
const CP1252_TO_BYTE = new Map<number, number>();
CP1252_HIGH.forEach((cp, i) => CP1252_TO_BYTE.set(cp, 0x80 + i));

/** 非拉丁字母（希腊 / 西里尔 / 日文假名 / 中日韩表意 / 谚文） */
function isNonLatinLetter(cp: number): boolean {
  return (
    (cp >= 0x0370 && cp <= 0x03ff) ||
    (cp >= 0x0400 && cp <= 0x04ff) ||
    (cp >= 0x3040 && cp <= 0x30ff) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7af)
  );
}

function nonLatinCount(s: string): number {
  let n = 0;
  for (const ch of s) if (isNonLatinLetter(ch.codePointAt(0) ?? 0)) n += 1;
  return n;
}

/**
 * 修复「UTF-8 文本被按 Windows-1252 / Latin-1 解码」造成的乱码。
 *
 * 远程解析服务对部分纯文本素材（.txt 等）会逐字节按 Latin-1/CP1252 解码 UTF-8 字节，
 * 中文会变成「æ•™å¸ˆ」形态，直接入库会让 AI 拿到乱码。这里做一次保守回修：
 * 只有当原文除 ASCII / CP1252 映射字符外不含任何非拉丁字母，且回修结果出现非拉丁字母、
 * 无替换符时才采用；正常英文、带重音的西文、正常中文一律原样返回。
 */
function repairMojibake(text: string): string {
  if (!text) return text;
  if (nonLatinCount(text) > 0) return text; // 已含非拉丁字母：不是本问题
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0xff) {
      bytes.push(cp);
      continue;
    }
    const mapped = CP1252_TO_BYTE.get(cp);
    if (mapped === undefined) return text; // 出现无法回映射的字符：放弃回修
    bytes.push(mapped);
  }
  const repaired = Buffer.from(bytes).toString('utf8');
  if (repaired.includes(String.fromCharCode(0xfffd))) return text; // 回修后出现替换符：放弃
  return nonLatinCount(repaired) > 0 ? repaired : text;
}

/** 解析对象存储中的文档为纯文本。签名 URL 2 小时有效，随用随签。 */
export async function parseObjectToText(objectKey: string): Promise<DocParseResult> {
  if (!objectKey) return { ok: false, text: '', error: '素材缺少存储对象' };

  let url: string;
  try {
    url = await signObjectUrl(objectKey);
  } catch (e) {
    return { ok: false, text: '', error: `生成访问链接失败：${errMsg(e)}` };
  }

  try {
    const res = await getClient().fetch(url);
    if (typeof res.status_code === 'number' && res.status_code !== 0) {
      return { ok: false, text: '', error: res.status_message || '文档解析服务返回失败' };
    }
    const raw = (res.content ?? [])
      .filter((item) => item.type === 'text' && item.text)
      .map((item) => item.text as string)
      .join('\n');
    const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // 去 BOM
    const text = repairMojibake(stripped).trim();
    if (!text) {
      return { ok: false, text: '', error: '未从文件中提取到文本（可能是纯图片或加密文档）' };
    }
    return {
      ok: true,
      text: text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text,
      title: res.title,
    };
  } catch (e) {
    return { ok: false, text: '', error: `文档解析失败：${errMsg(e)}` };
  }
}
