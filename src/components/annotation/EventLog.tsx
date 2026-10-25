'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  EVENT_CATEGORY_LABEL,
  EVENT_CATEGORY_DIMENSION,
  type EventCategory,
  type TimelineEvent,
} from '@/lib/evaluation/annotation-types';
import { uid } from '@/lib/annotation/factory';
import { formatClock, parseClockToSec } from './utils';
import { Plus, Trash2 } from 'lucide-react';

const CATEGORY_STYLE: Record<EventCategory, string> = {
  thinking_highlight: 'bg-amber-50 text-amber-700 border-amber-200',
  emotion_event: 'bg-rose-50 text-rose-700 border-rose-200',
  qz_integration: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  to_improve: 'bg-muted text-muted-foreground border-border',
};

const CATEGORIES = Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[];

export default function EventLog({
  events,
  onChange,
}: {
  events: TimelineEvent[];
  onChange: (next: TimelineEvent[]) => void;
}) {
  const [category, setCategory] = useState<EventCategory>('thinking_highlight');
  const [timeText, setTimeText] = useState('');
  const [note, setNote] = useState('');

  function add() {
    const sec = parseClockToSec(timeText);
    if (!note.trim()) return;
    const evt: TimelineEvent = {
      id: uid('evt'),
      time_sec: sec ?? 0,
      category,
      note: note.trim(),
      dimension_codes: EVENT_CATEGORY_DIMENSION[category],
      seat_ids: [],
    };
    onChange([...events, evt].sort((a, b) => a.time_sec - b.time_sec));
    setNote('');
    setTimeText('');
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border/80 bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as EventCategory)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {EVENT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <input
            value={timeText}
            onChange={(e) => setTimeText(e.target.value)}
            placeholder="时间 mm:ss（可留空）"
            className="w-36 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground"
          />
        </div>
        <div className="mt-2 flex items-start gap-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="记录这一时刻的关键表现、原话或情境…"
            className="min-h-16 flex-1 max-h-32 overflow-y-auto text-sm"
          />
          <Button onClick={add} size="sm" className="mt-0.5 shrink-0" disabled={!note.trim()}>
            <Plus className="mr-1 h-4 w-4" /> 打点
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          事件会自动关联对应评价维度，用于报告中的证据联动。
        </p>
      </div>

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">暂无事件打点</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-start gap-3 rounded-xl border border-border/80 bg-card p-3 shadow-sm">
              <span className="mt-0.5 shrink-0 rounded bg-brand-gradient px-1.5 py-0.5 font-mono text-[11px] text-white">
                {formatClock(e.time_sec)}
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${CATEGORY_STYLE[e.category]}`}>
                {EVENT_CATEGORY_LABEL[e.category]}
              </span>
              <p className="flex-1 text-sm text-foreground/90">{e.note}</p>
              <button
                type="button"
                onClick={() => onChange(events.filter((x) => x.id !== e.id))}
                className="shrink-0 rounded p-1 text-muted-foreground/50 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
