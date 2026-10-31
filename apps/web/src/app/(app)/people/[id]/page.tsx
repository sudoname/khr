'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table, statusTone } from '@/components/ui';
import { SignaturePad } from '@/components/signature-pad';

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
  livesOnsite?: boolean;
  hireDate?: string;
  probationEndsOn?: string | null;
  terminationDate?: string | null;
  grade?: string | null;
  job?: { id: string; title: string; description: string | null; responsibilities: string[] } | null;
  annualRentDeclared?: string | null;
  // Restricted fields: the API nulls these unless the viewer is the employee
  // themself or holds compensation.read.
  bvn?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
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

interface ContractSummary {
  id: string;
  title: string;
  roleTitle: string;
  updatedAt: string;
  signedAt: string | null;
  signedName: string | null;
  signatureHash: string | null;
}

const d = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useSession();
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [history, setHistory] = useState<EmploymentEvent[] | null>(null);
  const [comp, setComp] = useState<Compensation[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [contract, setContract] = useState<ContractSummary | null | undefined>(undefined);
  const [contractBusy, setContractBusy] = useState(false);
  const [modal, setModal] = useState<'edit' | 'terminate' | 'rehire' | 'comp' | 'rent' | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  const [signOpen, setSignOpen] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [signBusy, setSignBusy] = useState(false);
  const [signError, setSignError] = useState('');

  const isFull = emp?.hireDate !== undefined;
  const isSelf = !!me?.employee && me.employee.id === id;

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
    // Catalogs are only needed for the edit modal's job/location selectors.
    if (!can('employee.write')) return;
    api.get<{ id: string; title: string }[]>('/jobs').then(setJobs).catch(() => setJobs([]));
    api.get<{ id: string; name: string }[]>('/locations').then(setLocations).catch(() => setLocations([]));
  }, [can]);

  useEffect(() => {
    if (can('compensation.read')) {
      api.get<Compensation[]>(`/employees/${id}/compensation`).then(setComp).catch(() => setComp([]));
    }
  }, [id, can]);

  useEffect(() => {
    if (!can('document.manage') && me?.employee?.id !== id) return;
    api
      .get<ContractSummary>(`/contracts/employee/${id}`)
      .then(setContract)
      .catch(() => setContract(null)); // 404 = no contract generated yet
  }, [id, can, me]);

  async function generateContract() {
    setError('');
    setNotice('');
    setContractBusy(true);
    try {
      const created = await api.post<ContractSummary>(`/contracts/employee/${id}`, {});
      setContract(created);
      setNotice('Contract generated from the company template. Review and edit it before downloading.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate contract');
    } finally {
      setContractBusy(false);
    }
  }

  async function deleteContract() {
    if (!contract) return;
    if (!window.confirm('Delete this contract? You can regenerate it from the template afterwards.')) return;
    setError('');
    setNotice('');
    setContractBusy(true);
    try {
      await api.delete(`/contracts/${contract.id}`);
      setContract(null);
      setNotice('Contract deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete contract');
    } finally {
      setContractBusy(false);
    }
  }

  function openModal(kind: 'edit' | 'terminate' | 'rehire' | 'comp' | 'rent') {
    setModalError('');
    if (kind === 'edit' && emp) {
      setForm({
        firstName: emp.firstName,
        lastName: emp.lastName,
        preferredName: emp.preferredName ?? '',
        jobTitle: emp.jobTitle,
        jobId: emp.job?.id ?? '',
        locationId: emp.location?.id ?? '',
        grade: emp.grade ?? '',
        phone: emp.phone ?? '',
        personalEmail: emp.personalEmail ?? '',
        addressLine1: emp.addressLine1 ?? '',
        city: emp.city ?? '',
        state: emp.state ?? '',
        // Only editable when the viewer can actually see the stored values —
        // otherwise saving would blindly clear them.
        ...(can('compensation.read')
          ? {
              bvn: emp.bvn ?? '',
              bankName: emp.bankName ?? '',
              bankAccountNumber: emp.bankAccountNumber ?? '',
            }
          : {}),
        ecName: emp.emergencyContacts?.[0]?.name ?? '',
        ecRelationship: emp.emergencyContacts?.[0]?.relationship ?? '',
        ecPhone: emp.emergencyContacts?.[0]?.phone ?? '',
      });
    } else if (kind === 'terminate') {
      setForm({ terminationDate: new Date().toISOString().slice(0, 10), reason: '' });
    } else if (kind === 'rehire' && emp) {
      setForm({ hireDate: new Date().toISOString().slice(0, 10), jobTitle: emp.jobTitle });
    } else if (kind === 'comp') {
      setForm({
        effectiveDate: new Date().toISOString().slice(0, 10),
        baseSalary: '',
        currency: 'NGN',
        // Migrant farm workers are typically paid once a year.
        payFrequency: emp?.employmentType === 'MIGRANT' ? 'ANNUAL' : 'MONTHLY',
        note: '',
      });
    } else if (kind === 'rent' && emp) {
      setForm({ annualRentDeclared: emp.annualRentDeclared ?? '' });
    }
    setModal(kind);
  }

  const setF = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submitSign(e: React.FormEvent) {
    e.preventDefault();
    if (!contract || !signatureData) return;
    setSignError('');
    setSignBusy(true);
    try {
      // GPS is best-effort evidence: ask once, give up quietly after 5s or on denial.
      const gps = await new Promise<GeolocationPosition | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (p) => resolve(p),
          () => resolve(null),
          { timeout: 5000, maximumAge: 60_000 },
        );
      });
      const signed = await api.post<ContractSummary>(`/contracts/${contract.id}/sign`, {
        signatureImage: signatureData,
        ...(gps
          ? {
              latitude: gps.coords.latitude,
              longitude: gps.coords.longitude,
              accuracy: Math.min(gps.coords.accuracy, 100_000),
            }
          : {}),
      });
      setContract(signed);
      setSignOpen(false);
      setSignatureData(null);
      setNotice('Contract signed. The signed copy is now locked and available as a PDF.');
    } catch (err) {
      setSignError(err instanceof Error ? err.message : 'Failed to sign contract');
    } finally {
      setSignBusy(false);
    }
  }

  async function submitModal(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    setBusy(true);
    try {
      if (modal === 'edit') {
        const { ecName, ecRelationship, ecPhone, ...rest } = form;
        const body: Record<string, unknown> = { ...rest };
        // Replace-style: the emergency contact is only touched when provided.
        if (ecName && ecPhone) {
          body.emergencyContact = { name: ecName, relationship: ecRelationship ?? '', phone: ecPhone };
        }
        await api.patch(`/employees/${id}`, body);
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
            <dt className="text-slate-500">Primary location</dt>
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
                {emp.livesOnsite && (
                  <>
                    <dt className="text-slate-500">Housing</dt>
                    <dd>Lives on-site</dd>
                  </>
                )}
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
          {isFull && emp.job && emp.job.responsibilities.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-1 text-xs font-medium text-slate-500">Responsibilities · {emp.job.title}</div>
              {emp.job.description && <p className="mb-2 text-sm text-slate-600">{emp.job.description}</p>}
              <ol className="list-inside list-decimal space-y-1 text-sm">
                {emp.job.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </div>
          )}
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
            {(can('compensation.read') || emp.bvn || emp.bankName || emp.bankAccountNumber) && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <div className="mb-1 text-xs font-medium text-slate-500">Banking &amp; identity (restricted)</div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-slate-500">BVN</dt>
                  <dd>{emp.bvn ?? '—'}</dd>
                  <dt className="text-slate-500">Bank</dt>
                  <dd>{emp.bankName ?? '—'}</dd>
                  <dt className="text-slate-500">Account number</dt>
                  <dd>{emp.bankAccountNumber ?? '—'}</dd>
                </dl>
              </div>
            )}
            <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
              <div className="mb-1 text-xs font-medium text-slate-500">Emergency contact</div>
              {emp.emergencyContacts && emp.emergencyContacts.length > 0 ? (
                emp.emergencyContacts.map((c) => (
                  <div key={c.id}>
                    {c.name} ({c.relationship ?? 'contact'}) — {c.phone}
                  </div>
                ))
              ) : (
                <div className="text-slate-400">None recorded.</div>
              )}
            </div>
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

        {(can('document.manage') || isSelf) && isFull && (
          <Card title="Employment contract">
            {contract === undefined ? (
              <Spinner />
            ) : contract === null ? (
              can('document.manage') ? (
                <div className="space-y-3">
                  <Empty>No contract has been generated for this employee.</Empty>
                  <div className="flex items-center gap-2">
                    <Button onClick={() => void generateContract()} disabled={contractBusy}>
                      {contractBusy ? 'Generating…' : 'Generate from template'}
                    </Button>
                    <Link href="/settings/contract" className="text-xs text-brand-600 hover:underline">
                      Edit company template
                    </Link>
                  </div>
                  <p className="text-xs text-slate-400">
                    Placeholders (name, salary in words, dates…) are filled in from this employee&apos;s
                    record, and the contract stays editable afterwards.
                  </p>
                </div>
              ) : (
                <Empty>No contract has been issued to you yet. HR will generate it.</Empty>
              )
            ) : (
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <dt className="text-slate-500">Title</dt>
                  <dd>{contract.title}</dd>
                  <dt className="text-slate-500">Position</dt>
                  <dd>{contract.roleTitle}</dd>
                  <dt className="text-slate-500">Last updated</dt>
                  <dd>{d(contract.updatedAt)}</dd>
                  <dt className="text-slate-500">Status</dt>
                  <dd>
                    {contract.signedAt ? (
                      <Badge tone="green">Signed</Badge>
                    ) : (
                      <Badge tone="amber">Awaiting signature</Badge>
                    )}
                  </dd>
                  {contract.signedAt && (
                    <>
                      <dt className="text-slate-500">Signed by</dt>
                      <dd>
                        {contract.signedName} on {d(contract.signedAt)}
                        {contract.signatureHash && (
                          <div className="font-mono text-xs text-slate-400">
                            SHA-256 {contract.signatureHash.slice(0, 16)}…
                          </div>
                        )}
                      </dd>
                    </>
                  )}
                </dl>
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  {isSelf && !contract.signedAt && (
                    <Button
                      onClick={() => {
                        setSignError('');
                        setSignatureData(null);
                        setSignOpen(true);
                      }}
                    >
                      Sign contract
                    </Button>
                  )}
                  {can('document.manage') && !contract.signedAt && (
                    <Link href={`/people/${id}/contract`}>
                      <Button variant="secondary">Review & edit</Button>
                    </Link>
                  )}
                  <a href={`/api/contracts/${contract.id}/pdf`}>
                    <Button variant="secondary">Download PDF</Button>
                  </a>
                  {can('document.manage') && !contract.signedAt && (
                    <Button variant="danger" disabled={contractBusy} onClick={() => void deleteContract()}>
                      Delete
                    </Button>
                  )}
                </div>
                {contract.signedAt && (
                  <p className="text-xs text-slate-400">
                    Signed contracts are locked: they can no longer be edited or deleted.
                  </p>
                )}
              </div>
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
            <Field label="Preferred name">
              <Input value={form.preferredName ?? ''} onChange={setF('preferredName')} />
            </Field>
            {jobs.length > 0 && (
              <Field label="Job (from catalog)">
                <Select
                  value={form.jobId ?? ''}
                  onChange={(e) => {
                    const job = jobs.find((j) => j.id === e.target.value);
                    // Picking a catalog job links the defined responsibilities
                    // and fills the title (still editable).
                    setForm((f) => ({
                      ...f,
                      jobId: e.target.value,
                      jobTitle: job ? job.title : f.jobTitle,
                    }));
                  }}
                >
                  <option value="">None (free-text title)</option>
                  {jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Job title">
              <Input value={form.jobTitle ?? ''} onChange={setF('jobTitle')} required />
            </Field>
            {locations.length > 0 && (
              <Field label="Primary location">
                <Select value={form.locationId ?? ''} onChange={setF('locationId')}>
                  <option value="">Company default (first location)</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Grade">
                <Input value={form.grade ?? ''} onChange={setF('grade')} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone ?? ''} onChange={setF('phone')} />
              </Field>
            </div>
            <Field label="Personal email">
              <Input type="email" value={form.personalEmail ?? ''} onChange={setF('personalEmail')} />
            </Field>
            <Field label="Home address">
              <Input value={form.addressLine1 ?? ''} onChange={setF('addressLine1')} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input value={form.city ?? ''} onChange={setF('city')} />
              </Field>
              <Field label="State">
                <Input value={form.state ?? ''} onChange={setF('state')} />
              </Field>
            </div>
            {can('compensation.read') && (
              <>
                <div className="border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">
                  Banking &amp; identity (visible only to payroll roles and the employee)
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Bank name">
                    <Input value={form.bankName ?? ''} onChange={setF('bankName')} />
                  </Field>
                  <Field label="Account number (NUBAN)">
                    <Input value={form.bankAccountNumber ?? ''} onChange={setF('bankAccountNumber')} maxLength={10} placeholder="10 digits" />
                  </Field>
                </div>
                <Field label="BVN">
                  <Input value={form.bvn ?? ''} onChange={setF('bvn')} maxLength={11} placeholder="11 digits" />
                </Field>
              </>
            )}
            <div className="border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">Emergency contact</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={form.ecName ?? ''} onChange={setF('ecName')} />
              </Field>
              <Field label="Relationship">
                <Input value={form.ecRelationship ?? ''} onChange={setF('ecRelationship')} placeholder="e.g. Spouse" />
              </Field>
            </div>
            <Field label="Contact phone">
              <Input value={form.ecPhone ?? ''} onChange={setF('ecPhone')} />
            </Field>
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

      {signOpen && contract && (
        <Modal title="Sign your employment contract" onClose={() => setSignOpen(false)}>
          <form onSubmit={submitSign} className="space-y-3">
            {signError && <Alert kind="error">{signError}</Alert>}
            <Alert kind="info">
              By signing you accept the terms of “{contract.title}”. Your signature is recorded with the
              date, your IP address and — if you allow it — your GPS location, and the contract is then
              locked. Download and read the PDF before signing.
            </Alert>
            <Field label="Draw your signature">
              <SignaturePad onChange={setSignatureData} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setSignOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={signBusy || !signatureData}>
                {signBusy ? 'Signing…' : 'Sign contract'}
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
