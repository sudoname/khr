'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table } from '@/components/ui';

interface AttendanceRecord {
  id: string;
  day: string;
  clockInAt: string;
  clockOutAt: string | null;
  late: boolean;
  source: string;
  employee?: { id: string; firstName: string; lastName: string; employeeNo: string };
}

interface TodayState {
  day: string | null;
  record: AttendanceRecord | null;
}

interface Correction {
  id: string;
  day: string;
  proposedClockInAt: string;
  proposedClockOutAt: string | null;
  reason: string;
  status: string;
  reviewNote: string | null;
  employee?: { id: string; firstName: string; lastName: string; employeeNo: string };
}

interface Policy {
  name: string;
  workStartTime: string;
  workEndTime: string;
  lateGraceMinutes: number;
  workDays: number[];
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const d = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });
const t = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

export default function AttendancePage() {
  const { me, can } = useSession();
  const isEmployee = !!me?.employee;
  const canReview = can('attendance.correct.review');
  const canPolicy = can('attendance.policy.manage');

  const [today, setToday] = useState<TodayState | null>(null);
  const [records, setRecords] = useState<{ items: AttendanceRecord[]; total: number } | null>(null);
  const [myCorrections, setMyCorrections] = useState<Correction[] | null>(null);
  const [pendingCorrections, setPendingCorrections] = useState<Correction[] | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [showCorrection, setShowCorrection] = useState(false);
  const [corrForm, setCorrForm] = useState({ day: '', clockIn: '', clockOut: '', reason: '' });
  const [modalError, setModalError] = useState('');

  const [policyForm, setPolicyForm] = useState({
    name: 'Default',
    workStartTime: '09:00',
    workEndTime: '17:00',
    lateGraceMinutes: '10',
    workDays: [1, 2, 3, 4, 5] as number[],
  });

  const load = useCallback(async () => {
    try {
      if (isEmployee) {
        api.get<TodayState>('/attendance/today').then(setToday).catch(() => setToday({ day: null, record: null }));
        api
          .get<{ items: AttendanceRecord[]; total: number }>('/attendance/records?pageSize=20')
          .then(setRecords)
          .catch(() => setRecords({ items: [], total: 0 }));
        api.get<Correction[]>('/attendance/corrections/me').then(setMyCorrections).catch(() => setMyCorrections([]));
      }
      if (canReview) {
        api.get<Correction[]>('/attendance/corrections/pending').then(setPendingCorrections).catch(() => setPendingCorrections([]));
      }
      const p = await api.get<Policy>('/attendance/policy');
      setPolicy(p);
      setPolicyForm({
        name: p.name,
        workStartTime: p.workStartTime,
        workEndTime: p.workEndTime,
        lateGraceMinutes: String(p.lateGraceMinutes),
        workDays: p.workDays,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attendance');
    }
  }, [isEmployee, canReview]);

  useEffect(() => {
    void load();
  }, [load]);

  async function clock(action: 'clock-in' | 'clock-out') {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.post(`/attendance/${action}`, {});
      setNotice(action === 'clock-in' ? 'Clocked in. Have a great day!' : 'Clocked out. See you tomorrow!');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    setBusy(true);
    try {
      await api.post('/attendance/corrections', {
        day: corrForm.day,
        proposedClockInAt: new Date(`${corrForm.day}T${corrForm.clockIn}:00`).toISOString(),
        ...(corrForm.clockOut
          ? { proposedClockOutAt: new Date(`${corrForm.day}T${corrForm.clockOut}:00`).toISOString() }
          : {}),
        reason: corrForm.reason,
      });
      setShowCorrection(false);
      setCorrForm({ day: '', clockIn: '', clockOut: '', reason: '' });
      setNotice('Correction requested.');
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, decision: 'APPROVED' | 'REJECTED') {
    setError('');
    try {
      await api.post(`/attendance/corrections/${id}/review`, { decision });
      setNotice(`Correction ${decision.toLowerCase()}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    }
  }

  async function savePolicy(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.put('/attendance/policy', {
        name: policyForm.name,
        workStartTime: policyForm.workStartTime,
        workEndTime: policyForm.workEndTime,
        lateGraceMinutes: Number(policyForm.lateGraceMinutes),
        workDays: policyForm.workDays,
      });
      setNotice('Attendance policy saved.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Policy save failed');
    }
  }

  const toggleWorkDay = (dayNum: number) =>
    setPolicyForm((f) => ({
      ...f,
      workDays: f.workDays.includes(dayNum) ? f.workDays.filter((x) => x !== dayNum) : [...f.workDays, dayNum].sort(),
    }));

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Attendance</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        {isEmployee && (
          <Card title="Today">
            {today === null ? (
              <Spinner />
            ) : (
              <div className="space-y-3">
                {today.record ? (
                  <div className="text-sm">
                    <div>
                      Clocked in at <strong>{t(today.record.clockInAt)}</strong>{' '}
                      {today.record.late && <Badge tone="amber">Late</Badge>}
                    </div>
                    <div>
                      {today.record.clockOutAt ? (
                        <>
                          Clocked out at <strong>{t(today.record.clockOutAt)}</strong>
                        </>
                      ) : (
                        'Still clocked in.'
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">You haven&apos;t clocked in today.</p>
                )}
                <div className="flex gap-2">
                  {!today.record && (
                    <Button onClick={() => void clock('clock-in')} disabled={busy}>
                      Clock in
                    </Button>
                  )}
                  {today.record && !today.record.clockOutAt && (
                    <Button onClick={() => void clock('clock-out')} disabled={busy}>
                      Clock out
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => { setModalError(''); setShowCorrection(true); }}>
                    Request correction
                  </Button>
                </div>
                <p className="text-xs text-slate-400">
                  Times are recorded by the server — the clock on your device doesn&apos;t matter.
                </p>
              </div>
            )}
          </Card>
        )}

        {policy && (
          <Card title="Work schedule">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Hours</dt>
              <dd>
                {policy.workStartTime} – {policy.workEndTime}
              </dd>
              <dt className="text-slate-500">Late after</dt>
              <dd>{policy.lateGraceMinutes} min grace</dd>
              <dt className="text-slate-500">Work days</dt>
              <dd>{policy.workDays.map((w) => WEEKDAY_LABELS[w - 1]).join(', ')}</dd>
            </dl>
            {canPolicy && (
              <form onSubmit={savePolicy} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                <div className="text-xs font-medium text-slate-500">Edit policy</div>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Start">
                    <Input
                      type="time"
                      value={policyForm.workStartTime}
                      onChange={(e) => setPolicyForm((f) => ({ ...f, workStartTime: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label="End">
                    <Input
                      type="time"
                      value={policyForm.workEndTime}
                      onChange={(e) => setPolicyForm((f) => ({ ...f, workEndTime: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label="Grace (min)">
                    <Input
                      type="number"
                      min={0}
                      value={policyForm.lateGraceMinutes}
                      onChange={(e) => setPolicyForm((f) => ({ ...f, lateGraceMinutes: e.target.value }))}
                      required
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <label key={label} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={policyForm.workDays.includes(i + 1)}
                        onChange={() => toggleWorkDay(i + 1)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <Button type="submit">Save policy</Button>
              </form>
            )}
          </Card>
        )}
      </div>

      {canReview && (
        <Card title="Corrections pending review">
          {pendingCorrections === null ? (
            <Spinner />
          ) : pendingCorrections.length === 0 ? (
            <Empty>No corrections waiting.</Empty>
          ) : (
            <Table headers={['Employee', 'Day', 'Proposed in', 'Proposed out', 'Reason', '']}>
              {pendingCorrections.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-medium">
                    {c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : '—'}
                  </td>
                  <td className="px-3 py-2">{d(c.day)}</td>
                  <td className="px-3 py-2">{t(c.proposedClockInAt)}</td>
                  <td className="px-3 py-2">{t(c.proposedClockOutAt)}</td>
                  <td className="px-3 py-2 text-slate-500">{c.reason}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button onClick={() => void review(c.id, 'APPROVED')}>Approve</Button>
                      <Button variant="danger" onClick={() => void review(c.id, 'REJECTED')}>
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

      {isEmployee && (
        <Card title="Recent records">
          {records === null ? (
            <Spinner />
          ) : records.items.length === 0 ? (
            <Empty>No attendance records yet.</Empty>
          ) : (
            <Table headers={['Day', 'Clock in', 'Clock out', 'Status', 'Source']}>
              {records.items.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">{d(r.day)}</td>
                  <td className="px-3 py-2">{t(r.clockInAt)}</td>
                  <td className="px-3 py-2">{t(r.clockOutAt)}</td>
                  <td className="px-3 py-2">{r.late ? <Badge tone="amber">Late</Badge> : <Badge tone="green">On time</Badge>}</td>
                  <td className="px-3 py-2 text-xs text-slate-400">{r.source}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {isEmployee && myCorrections && myCorrections.length > 0 && (
        <Card title="My correction requests">
          <Table headers={['Day', 'Proposed in', 'Proposed out', 'Reason', 'Status']}>
            {myCorrections.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">{d(c.day)}</td>
                <td className="px-3 py-2">{t(c.proposedClockInAt)}</td>
                <td className="px-3 py-2">{t(c.proposedClockOutAt)}</td>
                <td className="px-3 py-2 text-slate-500">{c.reason}</td>
                <td className="px-3 py-2">
                  <Badge tone={c.status === 'APPROVED' ? 'green' : c.status === 'REJECTED' ? 'red' : 'amber'}>
                    {c.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {showCorrection && (
        <Modal title="Request attendance correction" onClose={() => setShowCorrection(false)}>
          <form onSubmit={submitCorrection} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Day">
              <Input
                type="date"
                value={corrForm.day}
                onChange={(e) => setCorrForm((f) => ({ ...f, day: e.target.value }))}
                required
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Actual clock-in time">
                <Input
                  type="time"
                  value={corrForm.clockIn}
                  onChange={(e) => setCorrForm((f) => ({ ...f, clockIn: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Actual clock-out time (optional)">
                <Input
                  type="time"
                  value={corrForm.clockOut}
                  onChange={(e) => setCorrForm((f) => ({ ...f, clockOut: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Reason">
              <Input
                value={corrForm.reason}
                onChange={(e) => setCorrForm((f) => ({ ...f, reason: e.target.value }))}
                required
                placeholder="e.g. Forgot to clock in, badge reader was down"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowCorrection(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Submitting…' : 'Submit'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
