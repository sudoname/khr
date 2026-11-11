'use client';

import { useCallback, useEffect, useState } from 'react';
import { BILLING_PLAN_LABELS, BILLING_PLANS, COMPANY_SECTOR_LABELS } from '@peopleflow/types';
import type { CompanySector } from '@peopleflow/types';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Input, Select, Spinner, Table, statusTone } from '@/components/ui';

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

interface PlatformOverview {
  companies: number;
  users: number;
  memberships: number;
}

interface PlatformUserMembership {
  membershipId: string;
  companyId: string;
  companyName: string;
  companyDeleted: boolean;
  role: string;
  employeeStatus: string | null;
}

interface PlatformUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  memberships: PlatformUserMembership[];
}

interface PlatformUsersResult {
  items: PlatformUser[];
  total: number;
  page: number;
  pageSize: number;
}

const planTone = (plan: string): 'slate' | 'green' | 'amber' | 'blue' =>
  plan === 'ENTERPRISE' ? 'green' : plan === 'GROWTH' ? 'blue' : plan === 'STARTER' ? 'amber' : 'slate';

export default function PlatformPage() {
  const { me, loading } = useSession();
  const [companies, setCompanies] = useState<PlatformCompany[] | null>(null);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [usersData, setUsersData] = useState<PlatformUsersResult | null>(null);
  const [uq, setUq] = useState('');
  const [userPage, setUserPage] = useState(1);
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

  const loadUsers = useCallback(async () => {
    const params = new URLSearchParams();
    if (uq) params.set('q', uq);
    params.set('page', String(userPage));
    params.set('pageSize', '25');
    try {
      setUsersData(await api.get<PlatformUsersResult>(`/platform/users?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    }
  }, [uq, userPage]);

  useEffect(() => {
    if (me?.user.isPlatformAdmin) {
      void load();
      api.get<PlatformOverview>('/platform/overview').then(setOverview).catch(() => setOverview(null));
    }
  }, [me, load]);

  useEffect(() => {
    if (!me?.user.isPlatformAdmin) return;
    const t = setTimeout(() => void loadUsers(), uq ? 300 : 0);
    return () => clearTimeout(t);
  }, [me, loadUsers, uq]);

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

  const totalUserPages = usersData ? Math.max(1, Math.ceil(usersData.total / usersData.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Platform admin</h1>
        <p className="text-sm text-slate-500">Every company, user and status on this KHR instance.</p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card title="Companies">
          <div className="text-2xl font-semibold text-slate-900">{overview ? overview.companies : '—'}</div>
        </Card>
        <Card title="Users">
          <div className="text-2xl font-semibold text-slate-900">{overview ? overview.users : '—'}</div>
        </Card>
        <Card title="Memberships">
          <div className="text-2xl font-semibold text-slate-900">{overview ? overview.memberships : '—'}</div>
        </Card>
      </div>

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

      <Card title={`Users${usersData ? ` (${usersData.total})` : ''}`}>
        <div className="mb-3 max-w-sm">
          <Input
            placeholder="Search by name or email…"
            value={uq}
            onChange={(e) => {
              setUq(e.target.value);
              setUserPage(1);
            }}
          />
        </div>
        {!usersData ? (
          <Spinner />
        ) : usersData.items.length === 0 ? (
          <Empty>No users found.</Empty>
        ) : (
          <>
            <Table headers={['User', 'Verified', 'MFA', 'Memberships', 'Created', 'Last sign-in']}>
              {usersData.items.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">
                        {u.firstName} {u.lastName}
                      </span>
                      {u.isPlatformAdmin && <Badge tone="blue">Platform admin</Badge>}
                    </div>
                    <div className="font-mono text-xs text-slate-400">{u.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={u.emailVerified ? 'green' : 'amber'}>{u.emailVerified ? 'Verified' : 'Pending'}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={u.mfaEnabled ? 'green' : 'slate'}>{u.mfaEnabled ? 'On' : 'Off'}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    {u.memberships.length === 0 ? (
                      '—'
                    ) : (
                      <div className="space-y-1">
                        {u.memberships.map((m) => (
                          <div key={m.membershipId} className="flex items-center gap-2">
                            <span>
                              {m.companyName}
                              {m.companyDeleted && <span className="text-slate-400"> (deleted)</span>}
                              <span className="text-slate-400"> · {m.role}</span>
                            </span>
                            {m.employeeStatus ? (
                              <Badge tone={statusTone(m.employeeStatus)}>{m.employeeStatus}</Badge>
                            ) : (
                              <span className="text-xs text-slate-400">No employee</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2">
                    {u.lastSignInAt ? (
                      new Date(u.lastSignInAt).toLocaleDateString()
                    ) : (
                      <span className="text-slate-400">Never</span>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                {usersData.total} user{usersData.total === 1 ? '' : 's'}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" disabled={userPage <= 1} onClick={() => setUserPage((p) => p - 1)}>
                  ← Prev
                </Button>
                <span>
                  Page {userPage} of {totalUserPages}
                </span>
                <Button variant="ghost" disabled={userPage >= totalUserPages} onClick={() => setUserPage((p) => p + 1)}>
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
