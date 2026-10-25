// 工作台展示工具
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function parseClockToSec(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
