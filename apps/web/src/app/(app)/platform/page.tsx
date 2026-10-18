'use client';

import { useCallback, useEffect, useState } from 'react';
import { BILLING_PLAN_LABELS, BILLING_PLANS, COMPANY_SECTOR_LABELS } from '@peopleflow/types';
import type { CompanySector } from '@peopleflow/types';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Card, Empty, Select, Spinner, Table } from '@/components/ui';

interface PlatformCompany {
  id: string;
  name: string;
  slug: string;
  country: string;
  sector: CompanySector | null;
  plan: string;
  createdAt: string;
  members: number;
}

const planTone = (plan: string): 'slate' | 'green' | 'amber' | 'blue' =>
  plan === 'ENTERPRISE' ? 'green' : plan === 'GROWTH' ? 'blue' : plan === 'STARTER' ? 'amber' : 'slate';

export default function PlatformPage() {
  const { me, loading } = useSession();
  const [companies, setCompanies] = useState<PlatformCompany[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCompanies(await api.get<PlatformCompany[]>('/platform/companies'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies');
    }
  }, []);

  useEffect(() => {
    if (me?.user.isPlatformAdmin) void load();
  }, [me, load]);

  if (loading) return <Spinner />;
  if (!me?.user.isPlatformAdmin) {
    return <Alert kind="error">This page is restricted to platform administrators.</Alert>;
  }
  if (!companies) return error ? <Alert kind="error">{error}</Alert> : <Spinner />;

  async function setPlan(companyId: string, plan: string) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/platform/companies/${companyId}/plan`, { plan });
      setNotice('Plan updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update plan');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Platform admin</h1>
        <p className="text-sm text-slate-500">All companies on this KHR instance.</p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title={`Companies (${companies.length})`}>
        {companies.length === 0 ? (
          <Empty>No companies yet.</Empty>
        ) : (
          <Table headers={['Company', 'Sector', 'Country', 'Members', 'Created', 'Plan', 'Change plan']}>
            {companies.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{c.name}</div>
                  <div className="font-mono text-xs text-slate-400">{c.slug}</div>
                </td>
                <td className="px-3 py-2">{c.sector ? (COMPANY_SECTOR_LABELS[c.sector] ?? c.sector) : '—'}</td>
                <td className="px-3 py-2">{c.country}</td>
                <td className="px-3 py-2">{c.members}</td>
                <td className="px-3 py-2">{new Date(c.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2">
                  <Badge tone={planTone(c.plan)}>{BILLING_PLAN_LABELS[c.plan as keyof typeof BILLING_PLAN_LABELS] ?? c.plan}</Badge>
                </td>
                <td className="px-3 py-2">
                  <Select
                    className="max-w-[10rem]"
                    value={c.plan}
                    disabled={busy}
                    onChange={(e) => void setPlan(c.id, e.target.value)}
                  >
                    {BILLING_PLANS.map((p) => (
                      <option key={p} value={p}>
                        {BILLING_PLAN_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
