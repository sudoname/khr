'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table, statusTone } from '@/components/ui';

interface LeaveType {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  allowHalfDay: boolean;
  color: string | null;
  policies: {
    id: string;
    accrualMethod: string;
    annualEntitlementDays: number;
    maxCarryoverDays: number;
    approvalLevels: number;
  }[];
}

interface Balance {
  leaveTypeId: string;
  leaveType: { id: string; name: string; code: string; paid: boolean };
  year: number;
  entitledDays: number;
  carriedOverDays: number;
  adjustmentDays: number;
  usedDays: number;
  availableDays: number;
}

interface LeaveRequest {
  id: string;
  startDate: string;
  endDate: string;
  startHalfDay: boolean;
  endHalfDay: boolean;
  totalDays: string;
  status: string;
  reason: string | null;
  currentLevel: number;
  leaveType: { id: string; name: string; code: string };
  employee: { id: string; firstName: string; lastName: string; employeeNo: string };
  approvals: { id: string; level: number; status: string; note: string | null }[];
}

interface Holiday {
  id: string;
  name: string;
  date: string;
}

const d = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });

export default function LeavePage() {
  const { me, can } = useSession();
  const isEmployee = !!me?.employee;
  const canApprove = can('leave.approve');
  const canAdmin = can('leave.policy.manage');

  const [tab, setTab] = useState<'mine' | 'approvals' | 'admin'>('mine');
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [myRequests, setMyRequests] = useState<LeaveRequest[] | null>(null);
  const [pending, setPending] = useState<LeaveRequest[] | null>(null);
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showRequest, setShowRequest] = useState(false);
  const [reqForm, setReqForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    startHalfDay: false,
    endHalfDay: false,
    reason: '',
  });
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  // admin forms
  const [typeForm, setTypeForm] = useState({ name: '', code: '', paid: true, allowHalfDay: true });
  const [policyForm, setPolicyForm] = useState({
    leaveTypeId: '',
    accrualMethod: 'ANNUAL_GRANT',
    annualEntitlementDays: '20',
    maxCarryoverDays: '5',
    approvalLevels: '1',
  });
  const [holidayForm, setHolidayForm] = useState({ name: '', date: '' });

  const load = useCallback(async () => {
    try {
      const t = await api.get<LeaveType[]>('/leave/types');
      setTypes(t);
      if (isEmployee) {
        api.get<Balance[]>('/leave/balances/me').then(setBalances).catch(() => setBalances([]));
        api.get<LeaveRequest[]>('/leave/requests/me').then(setMyRequests).catch(() => setMyRequests([]));
      }
      if (canApprove) {
        api.get<LeaveRequest[]>('/leave/requests/pending').then(setPending).catch(() => setPending([]));
      }
      if (canAdmin) {
        api.get<Holiday[]>('/leave/holidays').then(setHolidays).catch(() => setHolidays([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leave data');
    }
  }, [isEmployee, canApprove, canAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRequest(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    setBusy(true);
    try {
      await api.post('/leave/requests', {
        leaveTypeId: reqForm.leaveTypeId,
        startDate: reqForm.startDate,
        endDate: reqForm.endDate,
        startHalfDay: reqForm.startHalfDay,
        endHalfDay: reqForm.endHalfDay,
        ...(reqForm.reason ? { reason: reqForm.reason } : {}),
      });
      setShowRequest(false);
      setReqForm({ leaveTypeId: '', startDate: '', endDate: '', startHalfDay: false, endHalfDay: false, reason: '' });
      setNotice('Leave request submitted.');
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function cancelRequest(id: string) {
    setError('');
    try {
      await api.post(`/leave/requests/${id}/cancel`, {});
      setNotice('Request cancelled.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  async function decide(id: string, decision: 'APPROVED' | 'REJECTED') {
    setError('');
    try {
      await api.post(`/leave/requests/${id}/decision`, { decision });
      setNotice(`Request ${decision.toLowerCase()}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    }
  }

  async function createType(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/leave/types', typeForm);
      setTypeForm({ name: '', code: '', paid: true, allowHalfDay: true });
      setNotice('Leave type created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.put('/leave/policies', {
        leaveTypeId: policyForm.leaveTypeId,
        accrualMethod: policyForm.accrualMethod,
        annualEntitlementDays: Number(policyForm.annualEntitlementDays),
        maxCarryoverDays: Number(policyForm.maxCarryoverDays),
        approvalLevels: Number(policyForm.approvalLevels),
      });
      setNotice('Policy saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Policy save failed');
    }
  }

  async function addHoliday(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/leave/holidays', holidayForm);
      setHolidayForm({ name: '', date: '' });
      setNotice('Holiday added.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Holiday create failed');
    }
  }

  async function removeHoliday(id: string) {
    try {
      await api.delete(`/leave/holidays/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const tabs = [
    { key: 'mine' as const, label: 'My leave', show: isEmployee },
    { key: 'approvals' as const, label: `Approvals${pending ? ` (${pending.length})` : ''}`, show: canApprove },
    { key: 'admin' as const, label: 'Policies & holidays', show: canAdmin },
  ].filter((t) => t.show);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Leave</h1>
        {isEmployee && <Button onClick={() => { setModalError(''); setShowRequest(true); }}>Request leave</Button>}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mine' && isEmployee && (
        <div className="space-y-4">
          <Card title={`Balances · ${new Date().getFullYear()}`}>
            {balances === null ? (
              <Spinner />
            ) : balances.length === 0 ? (
              <Empty>No leave types configured yet.</Empty>
            ) : (
              <Table headers={['Type', 'Entitled', 'Carried over', 'Adjustments', 'Used', 'Available']}>
                {balances.map((b) => (
                  <tr key={b.leaveTypeId}>
                    <td className="px-3 py-2 font-medium">
                      {b.leaveType.name} {!b.leaveType.paid && <Badge tone="slate">Unpaid</Badge>}
                    </td>
                    <td className="px-3 py-2">{b.entitledDays}</td>
                    <td className="px-3 py-2">{b.carriedOverDays}</td>
                    <td className="px-3 py-2">{b.adjustmentDays}</td>
                    <td className="px-3 py-2">{b.usedDays}</td>
                    <td className="px-3 py-2 font-semibold">{b.availableDays}</td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>

          <Card title="My requests">
            {myRequests === null ? (
              <Spinner />
            ) : myRequests.length === 0 ? (
              <Empty>You haven&apos;t requested any leave yet.</Empty>
            ) : (
              <Table headers={['Type', 'Dates', 'Days', 'Status', '']}>
                {myRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2">{r.leaveType.name}</td>
                    <td className="px-3 py-2">
                      {d(r.startDate)} → {d(r.endDate)}
                      {(r.startHalfDay || r.endHalfDay) && <span className="text-xs text-slate-400"> (half days)</span>}
                    </td>
                    <td className="px-3 py-2">{Number(r.totalDays)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'PENDING' && (
                        <Button variant="ghost" onClick={() => void cancelRequest(r.id)}>
                          Cancel
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {tab === 'approvals' && canApprove && (
        <Card title="Pending approvals">
          {pending === null ? (
            <Spinner />
          ) : pending.length === 0 ? (
            <Empty>Nothing waiting for your review.</Empty>
          ) : (
            <Table headers={['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Level', '']}>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium">
                    {r.employee.firstName} {r.employee.lastName}
                    <div className="text-xs text-slate-400">{r.employee.employeeNo}</div>
                  </td>
                  <td className="px-3 py-2">{r.leaveType.name}</td>
                  <td className="px-3 py-2">
                    {d(r.startDate)} → {d(r.endDate)}
                  </td>
                  <td className="px-3 py-2">{Number(r.totalDays)}</td>
                  <td className="px-3 py-2 text-slate-500">{r.reason ?? '—'}</td>
                  <td className="px-3 py-2">
                    {r.currentLevel}/{r.approvals.length}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button onClick={() => void decide(r.id, 'APPROVED')}>Approve</Button>
                      <Button variant="danger" onClick={() => void decide(r.id, 'REJECTED')}>
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'admin' && canAdmin && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Leave types & policies">
            {types.length === 0 ? (
              <Empty>No leave types yet — create one below.</Empty>
            ) : (
              <Table headers={['Type', 'Paid', 'Entitlement', 'Carryover', 'Approvals']}>
                {types.map((t) => {
                  const p = t.policies[0];
                  return (
                    <tr key={t.id}>
                      <td className="px-3 py-2 font-medium">
                        {t.name} <span className="text-xs text-slate-400">({t.code})</span>
                      </td>
                      <td className="px-3 py-2">{t.paid ? 'Paid' : 'Unpaid'}</td>
                      <td className="px-3 py-2">{p ? `${p.annualEntitlementDays} days` : '—'}</td>
                      <td className="px-3 py-2">{p ? `${p.maxCarryoverDays} days` : '—'}</td>
                      <td className="px-3 py-2">{p ? `${p.approvalLevels} level${p.approvalLevels === 1 ? '' : 's'}` : '—'}</td>
                    </tr>
                  );
                })}
              </Table>
            )}

            <form onSubmit={createType} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="text-xs font-medium text-slate-500">New leave type</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  <Input value={typeForm.name} onChange={(e) => setTypeForm((f) => ({ ...f, name: e.target.value }))} required />
                </Field>
                <Field label="Code">
                  <Input value={typeForm.code} onChange={(e) => setTypeForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} required placeholder="ANNUAL" />
                </Field>
              </div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={typeForm.paid} onChange={(e) => setTypeForm((f) => ({ ...f, paid: e.target.checked }))} />
                  Paid
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={typeForm.allowHalfDay}
                    onChange={(e) => setTypeForm((f) => ({ ...f, allowHalfDay: e.target.checked }))}
                  />
                  Allow half days
                </label>
              </div>
              <Button type="submit">Create type</Button>
            </form>

            <form onSubmit={savePolicy} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="text-xs font-medium text-slate-500">Set policy for a type</div>
              <Field label="Leave type">
                <Select
                  value={policyForm.leaveTypeId}
                  onChange={(e) => setPolicyForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
                  required
                >
                  <option value="">Select…</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Accrual method">
                  <Select
                    value={policyForm.accrualMethod}
                    onChange={(e) => setPolicyForm((f) => ({ ...f, accrualMethod: e.target.value }))}
                  >
                    <option value="ANNUAL_GRANT">Annual grant</option>
                    <option value="MONTHLY_ACCRUAL">Monthly accrual</option>
                    <option value="NONE">None</option>
                  </Select>
                </Field>
                <Field label="Annual entitlement (days)">
                  <Input
                    type="number"
                    min={0}
                    value={policyForm.annualEntitlementDays}
                    onChange={(e) => setPolicyForm((f) => ({ ...f, annualEntitlementDays: e.target.value }))}
                    required
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Max carryover (days)">
                  <Input
                    type="number"
                    min={0}
                    value={policyForm.maxCarryoverDays}
                    onChange={(e) => setPolicyForm((f) => ({ ...f, maxCarryoverDays: e.target.value }))}
                    required
                  />
                </Field>
                <Field label="Approval levels">
                  <Input
                    type="number"
                    min={1}
                    max={3}
                    value={policyForm.approvalLevels}
                    onChange={(e) => setPolicyForm((f) => ({ ...f, approvalLevels: e.target.value }))}
                    required
                  />
                </Field>
              </div>
              <Button type="submit">Save policy</Button>
            </form>
          </Card>

          <Card title={`Public holidays · ${new Date().getFullYear()}`}>
            {holidays === null ? (
              <Spinner />
            ) : holidays.length === 0 ? (
              <Empty>No holidays configured for this year.</Empty>
            ) : (
              <ul className="space-y-1 text-sm">
                {holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50">
                    <span>
                      <strong>{d(h.date)}</strong> — {h.name}
                    </span>
                    <button onClick={() => void removeHoliday(h.id)} className="text-xs text-red-500 hover:underline">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addHoliday} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name">
                  <Input
                    value={holidayForm.name}
                    onChange={(e) => setHolidayForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    placeholder="Independence Day"
                  />
                </Field>
                <Field label="Date">
                  <Input
                    type="date"
                    value={holidayForm.date}
                    onChange={(e) => setHolidayForm((f) => ({ ...f, date: e.target.value }))}
                    required
                  />
                </Field>
              </div>
              <Button type="submit">Add holiday</Button>
            </form>
          </Card>
        </div>
      )}

      {showRequest && (
        <Modal title="Request leave" onClose={() => setShowRequest(false)}>
          <form onSubmit={submitRequest} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Leave type">
              <Select
                value={reqForm.leaveTypeId}
                onChange={(e) => setReqForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.paid ? '' : '(unpaid)'}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <Input
                  type="date"
                  value={reqForm.startDate}
                  onChange={(e) => setReqForm((f) => ({ ...f, startDate: e.target.value }))}
                  required
                />
              </Field>
              <Field label="End date">
                <Input
                  type="date"
                  value={reqForm.endDate}
                  onChange={(e) => setReqForm((f) => ({ ...f, endDate: e.target.value }))}
                  required
                />
              </Field>
            </div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={reqForm.startHalfDay}
                  onChange={(e) => setReqForm((f) => ({ ...f, startHalfDay: e.target.checked }))}
                />
                Half day start
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={reqForm.endHalfDay}
                  onChange={(e) => setReqForm((f) => ({ ...f, endHalfDay: e.target.checked }))}
                />
                Half day end
              </label>
            </div>
            <Field label="Reason (optional)">
              <Input value={reqForm.reason} onChange={(e) => setReqForm((f) => ({ ...f, reason: e.target.value }))} />
            </Field>
            <p className="text-xs text-slate-400">
              Weekends and public holidays are excluded automatically when counting days.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowRequest(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Submitting…' : 'Submit request'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
