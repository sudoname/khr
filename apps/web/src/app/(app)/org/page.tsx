'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Button, Card, Empty, Field, Modal, Select, Spinner } from '@/components/ui';

interface ChartNode {
  id: string;
  employeeNo: string;
  name: string;
  jobTitle: string;
  department: string | null;
  managerId: string | null;
  reports: ChartNode[];
}

interface Chart {
  roots: ChartNode[];
  totalEmployees: number;
}

function flatten(nodes: ChartNode[], acc: { id: string; name: string }[] = []): { id: string; name: string }[] {
  for (const n of nodes) {
    acc.push({ id: n.id, name: n.name });
    flatten(n.reports, acc);
  }
  return acc;
}

function Node({
  node,
  canManage,
  onReassign,
  depth = 0,
}: {
  node: ChartNode;
  canManage: boolean;
  onReassign: (node: ChartNode) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 2);
  return (
    <li>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        {node.reports.length > 0 && (
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex h-5 w-5 items-center justify-center rounded text-xs text-slate-400 hover:bg-slate-100"
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            {open ? '−' : '+'}
          </button>
        )}
        <div className="flex-1">
          <Link href={`/people/${node.id}`} className="text-sm font-medium text-brand-600 hover:underline">
            {node.name}
          </Link>
          <div className="text-xs text-slate-500">
            {node.jobTitle}
            {node.department ? ` · ${node.department}` : ''}
          </div>
        </div>
        {node.reports.length > 0 && (
          <span className="text-xs text-slate-400">
            {node.reports.length} report{node.reports.length === 1 ? '' : 's'}
          </span>
        )}
        {canManage && (
          <button onClick={() => onReassign(node)} className="text-xs text-slate-400 hover:text-brand-600">
            Move
          </button>
        )}
      </div>
      {open && node.reports.length > 0 && (
        <ul className="ml-6 mt-2 space-y-2 border-l border-slate-200 pl-4">
          {node.reports.map((child) => (
            <Node key={child.id} node={child} canManage={canManage} onReassign={onReassign} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrgPage() {
  const { can } = useSession();
  const [chart, setChart] = useState<Chart | null>(null);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<ChartNode | null>(null);
  const [newManagerId, setNewManagerId] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setChart(await api.get<Chart>('/org/chart'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load org chart');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reassign(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setModalError('');
    setBusy(true);
    try {
      await api.patch(`/org/employees/${target.id}/manager`, { managerId: newManagerId || null });
      setTarget(null);
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Reassignment failed');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!chart) return <Spinner />;

  const everyone = flatten(chart.roots);
  const canManage = can('org.manage');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Organisation chart</h1>
        <p className="text-sm text-slate-500">{chart.totalEmployees} active employees</p>
      </div>

      <Card>
        {chart.roots.length === 0 ? (
          <Empty>No employees yet.</Empty>
        ) : (
          <ul className="space-y-3">
            {chart.roots.map((root) => (
              <Node
                key={root.id}
                node={root}
                canManage={canManage}
                onReassign={(n) => {
                  setTarget(n);
                  setNewManagerId(n.managerId ?? '');
                  setModalError('');
                }}
              />
            ))}
          </ul>
        )}
      </Card>

      {target && (
        <Modal title={`Change manager for ${target.name}`} onClose={() => setTarget(null)}>
          <form onSubmit={reassign} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="New manager">
              <Select value={newManagerId} onChange={(e) => setNewManagerId(e.target.value)}>
                <option value="">No manager (top level)</option>
                {everyone
                  .filter((p) => p.id !== target.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <p className="text-xs text-slate-400">
              Assignments that would create a reporting cycle are rejected by the server.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Change manager'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
