'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table, statusTone } from '@/components/ui';

interface EmployeeDetail {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string;
  jobTitle: string;
  status: string;
  managerId: string | null;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string; jobTitle: string; employeeNo: string } | null;
  // Full-profile-only fields (absent when the viewer only has directory access)
  middleName?: string | null;
  personalEmail?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  dateOfBirth?: string | null;
  employmentType?: string;
  hireDate?: string;
  probationEndsOn?: string | null;
  terminationDate?: string | null;
  grade?: string | null;
  annualRentDeclared?: string | null;
  emergencyContacts?: { id: string; name: string; relationship: string | null; phone: string; email: string | null }[];
}

interface EmploymentEvent {
  id: string;
  type: string;
  effectiveDate: string;
  note: string | null;
  createdAt: string;
}

interface Compensation {
  id: string;
  effectiveDate: string;
  baseSalary: string;
  currency: string;
  payFrequency: string;
  note: string | null;
}

const d = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [history, setHistory] = useState<EmploymentEvent[] | null>(null);
  const [comp, setComp] = useState<Compensation[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'edit' | 'terminate' | 'rehire' | 'comp' | 'rent' | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const isFull = emp?.hireDate !== undefined;

  const load = useCallback(async () => {
    try {
      const data = await api.get<EmployeeDetail>(`/employees/${id}`);
      setEmp(data);
      if (data.hireDate !== undefined) {
        api.get<EmploymentEvent[]>(`/employees/${id}/history`).then(setHistory).catch(() => setHistory([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load employee');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (can('compensation.read')) {
      api.get<Compensation[]>(`/employees/${id}/compensation`).then(setComp).catch(() => setComp([]));
    }
  }, [id, can]);

  function openModal(kind: 'edit' | 'terminate' | 'rehire' | 'comp' | 'rent') {
    setModalError('');
    if (kind === 'edit' && emp) {
      setForm({
        firstName: emp.firstName,
        lastName: emp.lastName,
        preferredName: emp.preferredName ?? '',
        jobTitle: emp.jobTitle,
        grade: emp.grade ?? '',
        phone: emp.phone ?? '',
      });
    } else if (kind === 'terminate') {
      setForm({ terminationDate: new Date().toISOString().slice(0, 10), reason: '' });
    } else if (kind === 'rehire' && emp) {
      setForm({ hireDate: new Date().toISOString().slice(0, 10), jobTitle: emp.jobTitle });
    } else if (kind === 'comp') {
      setForm({ effectiveDate: new Date().toISOString().slice(0, 10), baseSalary: '', currency: 'NGN', payFrequency: 'MONTHLY', note: '' });
    } else if (kind === 'rent' && emp) {
      setForm({ annualRentDeclared: emp.annualRentDeclared ?? '' });
    }
    setModal(kind);
  }

  const setF = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submitModal(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    setBusy(true);
    try {
      if (modal === 'edit') {
        await api.patch(`/employees/${id}`, form);
        setNotice('Profile updated.');
      } else if (modal === 'terminate') {
        await api.post(`/employees/${id}/terminate`, form);
        setNotice('Employee terminated.');
      } else if (modal === 'rehire') {
        await api.post(`/employees/${id}/rehire`, form);
        setNotice('Employee rehired.');
      } else if (modal === 'comp') {
        const body: Record<string, string> = {};
        for (const [k, v] of Object.entries(form)) if (v) body[k] = v;
        await api.post(`/employees/${id}/compensation`, body);
        setComp(await api.get<Compensation[]>(`/employees/${id}/compensation`));
        setNotice('Compensation record added.');
      } else if (modal === 'rent') {
        await api.put(`/employees/${id}/rent-declaration`, {
          annualRentDeclared: form.annualRentDeclared ? form.annualRentDeclared : null,
        });
        setNotice('Rent declaration updated. Recompute draft payroll runs to apply the relief.');
      }
      setModal(null);
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert kind="error">{error}</Alert>;
  if (!emp) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/people" className="text-xs text-slate-400 hover:text-brand-600">
            ← Back to directory
          </Link>
          <h1 className="text-xl font-semibold">
            {emp.preferredName || emp.firstName} {emp.lastName}{' '}
            <Badge tone={statusTone(emp.status)}>{emp.status}</Badge>
          </h1>
          <p className="text-sm text-slate-500">
            {emp.jobTitle} · {emp.employeeNo} · {emp.workEmail}
          </p>
        </div>
        <div className="flex gap-2">
          {can('employee.write') && (
            <Button variant="secondary" onClick={() => openModal('edit')}>
              Edit
            </Button>
          )}
          {can('employee.terminate') &&
            (emp.status === 'TERMINATED' ? (
              <Button variant="secondary" onClick={() => openModal('rehire')}>
                Rehire
              </Button>
            ) : (
              <Button variant="danger" onClick={() => openModal('terminate')}>
                Terminate
              </Button>
            ))}
        </div>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Overview">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Department</dt>
            <dd>{emp.department?.name ?? '—'}</dd>
            <dt className="text-slate-500">Location</dt>
            <dd>{emp.location?.name ?? '—'}</dd>
            <dt className="text-slate-500">Manager</dt>
            <dd>
              {emp.manager ? (
                <Link href={`/people/${emp.manager.id}`} className="text-brand-600 hover:underline">
                  {emp.manager.firstName} {emp.manager.lastName}
                </Link>
              ) : (
                '—'
              )}
            </dd>
            {isFull && (
              <>
                <dt className="text-slate-500">Employment type</dt>
                <dd>{emp.employmentType?.replace('_', '-') ?? '—'}</dd>
                <dt className="text-slate-500">Hire date</dt>
                <dd>{d(emp.hireDate)}</dd>
                {emp.terminationDate && (
                  <>
                    <dt className="text-slate-500">Termination date</dt>
                    <dd>{d(emp.terminationDate)}</dd>
                  </>
                )}
                <dt className="text-slate-500">Grade</dt>
                <dd>{emp.grade ?? '—'}</dd>
              </>
            )}
          </dl>
          {!isFull && (
            <p className="mt-3 text-xs text-slate-400">
              You&apos;re seeing the directory view. Full details are visible to HR and this person&apos;s managers.
            </p>
          )}
        </Card>

        {isFull && (
          <Card title="Contact & personal">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-500">Phone</dt>
              <dd>{emp.phone ?? '—'}</dd>
              <dt className="text-slate-500">Personal email</dt>
              <dd>{emp.personalEmail ?? '—'}</dd>
              <dt className="text-slate-500">Address</dt>
              <dd>{[emp.addressLine1, emp.city, emp.state].filter(Boolean).join(', ') || '—'}</dd>
              <dt className="text-slate-500">Date of birth</dt>
              <dd>{d(emp.dateOfBirth)}</dd>
            </dl>
            {emp.emergencyContacts && emp.emergencyContacts.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                <div className="mb-1 text-xs font-medium text-slate-500">Emergency contact</div>
                {emp.emergencyContacts.map((c) => (
                  <div key={c.id}>
                    {c.name} ({c.relationship ?? 'contact'}) — {c.phone}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {can('compensation.read') && (
          <Card
            title="Compensation"
            actions={
              can('compensation.write') ? (
                <Button variant="secondary" onClick={() => openModal('comp')}>
                  Add record
                </Button>
              ) : undefined
            }
          >
            {comp === null ? (
              <Spinner />
            ) : comp.length === 0 ? (
              <Empty>No compensation records.</Empty>
            ) : (
              <Table headers={['Effective', 'Base salary', 'Frequency', 'Note']}>
                {comp.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2">{d(c.effectiveDate)}</td>
                    <td className="px-3 py-2 font-medium">
                      {c.currency} {Number(c.baseSalary).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{c.payFrequency}</td>
                    <td className="px-3 py-2 text-slate-500">{c.note ?? '—'}</td>
                  </tr>
                ))}
              </Table>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
              <div>
                <span className="text-slate-500">Rent declared (2026 rent relief): </span>
                <span className="font-medium">
                  {emp.annualRentDeclared ? `NGN ${Number(emp.annualRentDeclared).toLocaleString()} / year` : 'None'}
                </span>
                <div className="text-xs text-slate-400">
                  PAYE relief is 20% of documented annual rent, capped at NGN 500,000 (NTA 2025).
                </div>
              </div>
              {can('compensation.write') && (
                <Button variant="secondary" onClick={() => openModal('rent')}>
                  {emp.annualRentDeclared ? 'Update' : 'Declare'}
                </Button>
              )}
            </div>
          </Card>
        )}

        {isFull && (
          <Card title="Employment history">
            {history === null ? (
              <Spinner />
            ) : history.length === 0 ? (
              <Empty>No events recorded.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {history.map((ev) => (
                  <li key={ev.id} className="flex items-start gap-3">
                    <Badge tone={ev.type === 'TERMINATION' ? 'red' : ev.type === 'HIRE' || ev.type === 'REHIRE' ? 'green' : 'blue'}>
                      {ev.type.replace('_', ' ')}
                    </Badge>
                    <div>
                      <div className="text-xs text-slate-400">{d(ev.effectiveDate)}</div>
                      {ev.note && <div>{ev.note}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {modal === 'edit' && (
        <Modal title="Edit employee" onClose={() => setModal(null)}>
          <form onSubmit={submitModal} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <Input value={form.firstName ?? ''} onChange={setF('firstName')} required />
              </Field>
              <Field label="Last name">
                <Input value={form.lastName ?? ''} onChange={setF('lastName')} required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Preferred name">
                <Input value={form.preferredName ?? ''} onChange={setF('preferredName')} />
              </Field>
              <Field label="Job title">
                <Input value={form.jobTitle ?? ''} onChange={setF('jobTitle')} required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grade">
                <Input value={form.grade ?? ''} onChange={setF('grade')} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone ?? ''} onChange={setF('phone')} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'terminate' && (
        <Modal title="Terminate employee" onClose={() => setModal(null)}>
          <form onSubmit={submitModal} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Alert kind="info">
              This marks {emp.firstName} as terminated and removes them from reporting lines. Their records are kept
              for audit purposes.
            </Alert>
            <Field label="Termination date">
              <Input type="date" value={form.terminationDate ?? ''} onChange={setF('terminationDate')} required />
            </Field>
            <Field label="Reason">
              <Input value={form.reason ?? ''} onChange={setF('reason')} required placeholder="e.g. Resignation" />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={busy}>
                {busy ? 'Terminating…' : 'Terminate'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'rehire' && (
        <Modal title="Rehire employee" onClose={() => setModal(null)}>
          <form onSubmit={submitModal} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="New hire date">
              <Input type="date" value={form.hireDate ?? ''} onChange={setF('hireDate')} required />
            </Field>
            <Field label="Job title">
              <Input value={form.jobTitle ?? ''} onChange={setF('jobTitle')} required />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Rehiring…' : 'Rehire'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'rent' && (
        <Modal title="Rent declaration (NTA 2025 rent relief)" onClose={() => setModal(null)}>
          <form onSubmit={submitModal} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Alert kind="info">
              Record the employee&apos;s documented annual rent. From January 2026 PAYE grants a relief of 20% of the
              declared rent, capped at NGN 500,000 per year. Leave empty to clear the declaration (no relief).
            </Alert>
            <Field label="Annual rent (NGN)">
              <Input
                value={form.annualRentDeclared ?? ''}
                onChange={setF('annualRentDeclared')}
                placeholder="1200000.00"
                pattern="^\d{1,16}(\.\d{1,2})?$"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save declaration'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'comp' && (
        <Modal title="Add compensation record" onClose={() => setModal(null)}>
          <form onSubmit={submitModal} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Effective date">
                <Input type="date" value={form.effectiveDate ?? ''} onChange={setF('effectiveDate')} required />
              </Field>
              <Field label="Base salary">
                <Input
                  value={form.baseSalary ?? ''}
                  onChange={setF('baseSalary')}
                  required
                  placeholder="250000.00"
                  pattern="^\d{1,16}(\.\d{1,2})?$"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Currency">
                <Input value={form.currency ?? ''} onChange={setF('currency')} required maxLength={3} />
              </Field>
              <Field label="Pay frequency">
                <Select value={form.payFrequency ?? 'MONTHLY'} onChange={setF('payFrequency')}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="BIWEEKLY">Bi-weekly</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="ANNUAL">Annual</option>
                </Select>
              </Field>
            </div>
            <Field label="Note (optional)">
              <Input value={form.note ?? ''} onChange={setF('note')} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Add record'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
