/**
 * 免费学术检索：OpenAlex + Crossref + arXiv 三源并发，任一失败静默降级。
 *
 * 全部是公开接口、无需 API key。课堂问答场景下老师常问"这个教学法有没有研究依据"，
 * 学术文献比通用网页搜索更对路，而且完全免费、不需要申请配额。参考善研的做法：
 * 多源混合、失败静默降级——检索挂了不影响问答主流程，只是回答里少一层外部佐证。
 */

export interface ScholarResult {
  title: string;
  authors: string;
  year: string | null;
  venue: string | null;
  abstract: string | null;
  url: string | null;
  source: 'openalex' | 'crossref' | 'arxiv';
}

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'qingzhi-classroom/1.0 (education research)',
    },
    signal: AbortSignal.timeout(timeoutMs),
    // 检索结果变化不频繁，短缓存避免重复打接口
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** OpenAlex 的摘要字段是倒排索引（词 → 位置数组），要按位置重排回原文 */
function rebuildAbstract(inv?: Record<string, number[]> | null): string | null {
  if (!inv) return null;
  const pairs: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions ?? []) pairs.push([p, word]);
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map(([, w]) => w).join(' ');
}

async function searchOpenAlex(q: string, limit: number): Promise<ScholarResult[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${limit}&sort=relevance_score:desc`;
  const data = (await fetchJson(url, DEFAULT_TIMEOUT_MS)) as {
    results?: Array<{
      title?: string;
      publication_year?: number;
      doi?: string;
      primary_location?: { source?: { display_name?: string } } | null;
      authorships?: Array<{ author?: { display_name?: string } }>;
      abstract_inverted_index?: Record<string, number[]> | null;
    }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    authors: (r.authorships ?? [])
      .slice(0, 3)
      .map((a) => a.author?.display_name ?? '')
      .filter(Boolean)
      .join(', '),
    year: r.publication_year ? String(r.publication_year) : null,
    venue: r.primary_location?.source?.display_name ?? null,
    abstract: rebuildAbstract(r.abstract_inverted_index)?.slice(0, 600) ?? null,
    url: r.doi ? `https://doi.org/${r.doi.replace(/^https?:\/\/doi\.org\//, '')}` : null,
    source: 'openalex' as const,
  }));
}

async function searchCrossref(q: string, limit: number): Promise<ScholarResult[]> {
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=${limit}&select=title,author,issued,container-title,abstract,DOI`;
  const data = (await fetchJson(url, DEFAULT_TIMEOUT_MS)) as {
    message?: {
      items?: Array<{
        title?: string[];
        author?: Array<{ given?: string; family?: string }>;
        issued?: { 'date-parts'?: Array<Array<number>> };
        'container-title'?: string[];
        abstract?: string;
        DOI?: string;
      }>;
    };
  };
  return (data.message?.items ?? []).map((r) => ({
    title: r.title?.[0] ?? '',
    authors: (r.author ?? [])
      .slice(0, 3)
      .map((a) => [a.family, a.given].filter(Boolean).join(' '))
      .join(', '),
    year: r.issued?.['date-parts']?.[0]?.[0] ? String(r.issued['date-parts'][0][0]) : null,
    venue: r['container-title']?.[0] ?? null,
    // Crossref 的 abstract 带 JATS XML 标签，粗略剥掉标签并压缩空白
    abstract: r.abstract
      ? r.abstract
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 600) || null
      : null,
    url: r.DOI ? `https://doi.org/${r.DOI}` : null,
    source: 'crossref' as const,
  }));
}

/** arXiv 返回 Atom feed，没有官方 JSON 接口，这里用最小正则抽取（结构稳定） */
async function searchArxiv(q: string, limit: number): Promise<ScholarResult[]> {
  const url = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1] ?? '');
  const results: ScholarResult[] = [];
  for (const raw of entries) {
    const grab = (tag: string): string => {
      const m = raw.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return (m?.[1] ?? '').trim();
    };
    const title = grab('title').replace(/\s+/g, ' ');
    if (!title) continue;
    results.push({
      title,
      authors: [...raw.matchAll(/<name>([\s\S]*?)<\/name>/g)]
        .slice(0, 3)
        .map((m) => (m[1] ?? '').trim())
        .join(', '),
      year: grab('published').match(/^(\d{4})/)?.[1] ?? null,
      venue: 'arXiv',
      abstract: grab('summary')
        .replace(/\s+/g, ' ')
        .slice(0, 600) || null,
      url: grab('id') || null,
      source: 'arxiv',
    });
  }
  return results;
}

export interface ScholarSearchOptions {
  /** 每个源取几条，默认 4 */
  perSource?: number;
}

/**
 * 三源并发检索。任何一源超时/报错都静默跳过，全部失败返回空数组，
 * 由调用方决定是继续问答（无外部佐证）还是提示。
 */
export async function scholarSearch(query: string, opts: ScholarSearchOptions = {}): Promise<ScholarResult[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(Math.max(opts.perSource ?? 4, 1), 8);

  const settled = await Promise.allSettled([
    searchOpenAlex(q, limit),
    searchCrossref(q, limit),
    searchArxiv(q, limit),
  ]);

  const all: ScholarResult[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }

  // 按 URL/标题去重 → 年份倒序 → 截断，避免某个源灌爆上下文
  const seen = new Set<string>();
  const dedup: ScholarResult[] = [];
  for (const item of all) {
    if (!item.title) continue;
    const key = (item.url ?? '').toLowerCase() || item.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
  }
  dedup.sort((a, b) => Number(b.year ?? '0') - Number(a.year ?? '0'));
  return dedup.slice(0, limit * 3);
}

/** 需要联网检索的信号词：老师问"有没有研究依据/理论支撑/文献"时才搜，其余问题直接走课例知识库 */
const SEARCH_HINTS = [
  '研究',
  '依据',
  '理论',
  '文献',
  '论文',
  '专家',
  '国外',
  '研究表明',
  '学界',
  '前沿',
  'research',
  'theory',
  'evidence',
  'literature',
];

export function looksLikeResearchQuestion(question: string): boolean {
  const s = question.toLowerCase();
  return SEARCH_HINTS.some((h) => s.includes(h));
}

/** 把检索结果压成一段给大模型看的文本 */
export function formatScholarForPrompt(results: ScholarResult[]): string {
  if (!results.length) return '';
  return results
    .slice(0, 8)
    .map((r, i) => {
      const bits = [
        `[${i + 1}] ${r.title}`,
        r.authors ? `作者：${r.authors}` : '',
        [r.year, r.venue].filter(Boolean).join(' · '),
        r.abstract ? `摘要节选：${r.abstract}` : '',
        r.url ? `链接：${r.url}` : '',
      ].filter(Boolean);
      return bits.join('\n');
    })
    .join('\n\n');
}
