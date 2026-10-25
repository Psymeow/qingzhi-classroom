import { NextRequest, NextResponse } from 'next/server';
import { authenticate, AuthError } from '@/lib/auth/server';
import { ensureBuiltinStandard } from '@/lib/evaluation/builtin-standard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LIST_COLS =
  'id, code, name, version, subject, scope, description, is_active, owner_id, updated_at';

interface StandardListRow {
  id: string;
  code: string;
  scope: string | null;
  version: string;
  owner_id: string | null;
  updated_at: string | null;
  [key: string]: unknown;
}

// 同一 code+version 出现多份时的取舍优先级：本人名下 > 系统内置 > 他人副本
function preferRank(ownerId: string | null, userId: string): number {
  if (ownerId === userId) return 2;
  if (!ownerId) return 1;
  return 0;
}

/**
 * 去重兜底：内置标准已收敛为「系统单例」（owner_id 为空，见 migrations/0002），
 * 但历史版本曾按账号逐份播种，遗留副本仍可能留在库里；且读策略允许读到他人名下的
 * 启用行，重复行会让同一份标准在下拉里出现多次。这里按 scope+code+version 去重，
 * 保留优先级最高的一份（本人 > 系统内置 > 他人），位置沿用首次出现的顺序。
 * 注：只做展示层收敛，不动数据库记录。
 */
function dedupeByCodeVersion(rows: StandardListRow[], userId: string): StandardListRow[] {
  const picked = new Map<string, StandardListRow>();
  const ordered: StandardListRow[] = [];
  for (const row of rows) {
    // 去重键带上 scope：将来出现校本/个人标准（school/personal）时，
    // 即使 code+version 与内置相同也不会被吞掉
    const key = `${row.scope ?? ''}|${row.code}@${row.version}`;
    const prev = picked.get(key);
    if (!prev) {
      picked.set(key, row);
      ordered.push(row);
      continue;
    }
    // rows 已按 updated_at 倒序，同优先级时先到者（更新）胜出
    if (preferRank(row.owner_id, userId) > preferRank(prev.owner_id, userId)) {
      const idx = ordered.indexOf(prev);
      if (idx >= 0) ordered[idx] = row;
      picked.set(key, row);
    }
  }
  return ordered;
}

export async function GET(req: NextRequest) {
  try {
    const { user, db } = await authenticate(req);

    // 内置标准（含 91 条课型要点定义）以系统单例存在：缺失则补建、版本落后则升级，失败不阻断列表
    await ensureBuiltinStandard(db).catch(() => null);

    // RLS 已限定：is_active=true 或 owner=本人；列表默认只取启用项
    const { data, error } = await db
      .from('standard_sets')
      .select(LIST_COLS)
      .eq('is_active', true)
      .order('scope', { ascending: true })
      .order('updated_at', { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as unknown as StandardListRow[];
    return NextResponse.json({ standards: dedupeByCodeVersion(rows, user.id) });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: '获取评价标准失败' }, { status: 500 });
  }
}
