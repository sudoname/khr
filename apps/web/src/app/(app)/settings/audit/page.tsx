'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, Empty, Input, Spinner, Table } from '@/components/ui';

interface AuditEntry {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  ip: string | null;
  meta: unknown;
  createdAt: string;
  user: { id: string; email: string; firstName: string; lastName: string } | null;
}

interface AuditResult {
  items: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AuditSettingsPage() {
  const [data, setData] = useState<AuditResult | null>(null);
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    params.set('page', String(page));
    params.set('pageSize', '50');
    try {
      setData(await api.get<AuditResult>(`/audit?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    }
  }, [action, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), action ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, action]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit log</h1>
      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <div className="mb-4 max-w-xs">
          <Input
            placeholder="Filter by action, e.g. auth.login"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          />
        </div>

        {!data ? (
          <Spinner />
        ) : data.items.length === 0 ? (
          <Empty>No audit entries.</Empty>
        ) : (
          <>
            <Table headers={['When', 'Actor', 'Action', 'Entity', 'IP']}>
              {data.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {entry.user ? (
                      <>
                        {entry.user.firstName} {entry.user.lastName}
                        <div className="text-xs text-slate-400">{entry.user.email}</div>
                      </>
                    ) : (
                      <span className="text-slate-400">system</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone="blue">{entry.action}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {entry.entity ? `${entry.entity}${entry.entityId ? ` · ${entry.entityId.slice(0, 8)}…` : ''}` : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-400">{entry.ip ?? '—'}</td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>{data.total} entries</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Prev
                </Button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next →
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
