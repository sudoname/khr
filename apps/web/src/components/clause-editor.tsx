'use client';

import { Button, Input } from '@/components/ui';

export interface EditableClause {
  heading: string;
  body: string;
}

/**
 * Shared clause list editor used by the company contract template page and the
 * per-employee contract editor. Controlled component: the parent owns state.
 */
export function ClauseEditor({
  clauses,
  onChange,
  disabled,
}: {
  clauses: EditableClause[];
  onChange: (clauses: EditableClause[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<EditableClause>) =>
    onChange(clauses.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= clauses.length) return;
    const next = [...clauses];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {clauses.map((clause, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
          <div className="flex items-center gap-2">
            <span className="w-6 shrink-0 font-mono text-xs text-slate-400">{i + 1}.</span>
            <Input
              value={clause.heading}
              onChange={(e) => update(i, { heading: e.target.value })}
              placeholder="Clause heading"
              maxLength={200}
              disabled={disabled}
            />
            <button
              type="button"
              aria-label="Move clause up"
              onClick={() => move(i, -1)}
              disabled={disabled || i === 0}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="Move clause down"
              onClick={() => move(i, 1)}
              disabled={disabled || i === clauses.length - 1}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="Remove clause"
              onClick={() => onChange(clauses.filter((_, j) => j !== i))}
              disabled={disabled || clauses.length <= 1}
              className="rounded border border-slate-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-40"
            >
              ✕
            </button>
          </div>
          <textarea
            value={clause.body}
            onChange={(e) => update(i, { body: e.target.value })}
            rows={Math.min(8, Math.max(3, Math.ceil(clause.body.length / 90)))}
            maxLength={20000}
            disabled={disabled}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100"
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || clauses.length >= 60}
        onClick={() => onChange([...clauses, { heading: '', body: '' }])}
      >
        Add clause
      </Button>
    </div>
  );
}
