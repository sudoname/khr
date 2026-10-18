'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table, statusTone } from '@/components/ui';

interface DirectoryEmployee {
  id: string;
  employeeNo: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  workEmail: string;
  jobTitle: string;
  status: string;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
}

interface ListResult {
  items: DirectoryEmployee[];
  total: number;
  page: number;
  pageSize: number;
}

interface Option {
  id: string;
  name: string;
}

const EMPTY_CREATE = {
  firstName: '',
  lastName: '',
  workEmail: '',
  jobTitle: '',
  hireDate: '',
  employmentType: 'FULL_TIME',
  departmentId: '',
  locationId: '',
  managerId: '',
};

export default function PeoplePage() {
  const { can } = useSession();
  const [data, setData] = useState<ListResult | null>(null);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [locations, setLocations] = useState<Option[]>([]);
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE });
  const [createError, setCreateError] = useState('');
  const [busy, setBusy] = useState(false);

  const [importResult, setImportResult] = useState<{ created: number; errors: { row: number; message: string }[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (departmentId) params.set('departmentId', departmentId);
    if (locationId) params.set('locationId', locationId);
    if (status) params.set('status', status);
    params.set('page', String(page));
    params.set('pageSize', '25');
    try {
      setData(await api.get<ListResult>(`/employees?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    }
  }, [q, departmentId, locationId, status, page]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    api.get<Option[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
    api.get<Option[]>('/locations').then(setLocations).catch(() => setLocations([]));
  }, []);

  const setCF = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCreateForm((f) => ({ ...f, [key]: e.target.value }));

  async function createEmployee(e: React.FormEvent) {
    e.preventDefault();
    setCreateError('');
    setBusy(true);
    try {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(createForm)) if (v) body[k] = v;
      await api.post('/employees', body);
      setShowCreate(false);
      setCreateForm({ ...EMPTY_CREATE });
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create employee');
    } finally {
      setBusy(false);
    }
  }

  async function importCsv(file: File) {
    setError('');
    setImportResult(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch('/api/employees/import', { method: 'POST', body: fd, credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.message ?? 'Import failed');
      setImportResult(json);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">People</h1>
        <div className="flex gap-2">
          {can('employee.export') && (
            <a href="/api/employees/export" download>
              <Button variant="secondary">Export CSV</Button>
            </a>
          )}
          {can('employee.import') && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])}
              />
              <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                Import CSV
              </Button>
            </>
          )}
          {can('employee.write') && (
            <Link href="/people/onboarding">
              <Button variant="secondary">Onboarding approvals</Button>
            </Link>
          )}
          {can('employee.write') && <Button onClick={() => setShowCreate(true)}>Add employee</Button>}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {importResult && (
        <Alert kind={importResult.errors.length ? 'info' : 'success'}>
          Imported {importResult.created} employee{importResult.created === 1 ? '' : 's'}.
          {importResult.errors.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs">
              {importResult.errors.slice(0, 10).map((e) => (
                <li key={e.row}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Card>
        <div className="mb-4 grid gap-2 md:grid-cols-4">
          <Input
            placeholder="Search name, email, title…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select value={locationId} onChange={(e) => { setLocationId(e.target.value); setPage(1); }}>
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="ON_LEAVE">On leave</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="TERMINATED">Terminated</option>
          </Select>
        </div>

        {!data ? (
          <Spinner />
        ) : data.items.length === 0 ? (
          <Empty>No employees match your filters.</Empty>
        ) : (
          <>
            <Table headers={['Employee', 'Title', 'Department', 'Location', 'Status']}>
              {data.items.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/people/${emp.id}`} className="font-medium text-brand-600 hover:underline">
                      {emp.preferredName || emp.firstName} {emp.lastName}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {emp.employeeNo} · {emp.workEmail}
                    </div>
                  </td>
                  <td className="px-3 py-2">{emp.jobTitle}</td>
                  <td className="px-3 py-2">{emp.department?.name ?? '—'}</td>
                  <td className="px-3 py-2">{emp.location?.name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <Badge tone={statusTone(emp.status)}>{emp.status}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <span>
                {data.total} employee{data.total === 1 ? '' : 's'}
              </span>
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

      {showCreate && (
        <Modal title="Add employee" onClose={() => setShowCreate(false)}>
          <form onSubmit={createEmployee} className="space-y-3">
            {createError && <Alert kind="error">{createError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <Input value={createForm.firstName} onChange={setCF('firstName')} required autoFocus />
              </Field>
              <Field label="Last name">
                <Input value={createForm.lastName} onChange={setCF('lastName')} required />
              </Field>
            </div>
            <Field label="Work email">
              <Input type="email" value={createForm.workEmail} onChange={setCF('workEmail')} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Job title">
                <Input value={createForm.jobTitle} onChange={setCF('jobTitle')} required />
              </Field>
              <Field label="Hire date">
                <Input type="date" value={createForm.hireDate} onChange={setCF('hireDate')} required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employment type">
                <Select value={createForm.employmentType} onChange={setCF('employmentType')}>
                  <option value="FULL_TIME">Full-time</option>
                  <option value="PART_TIME">Part-time</option>
                  <option value="CONTRACT">Contract</option>
                  <option value="INTERN">Intern</option>
                  <option value="TEMPORARY">Temporary</option>
                </Select>
              </Field>
              <Field label="Department">
                <Select value={createForm.departmentId} onChange={setCF('departmentId')}>
                  <option value="">None</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Location">
              <Select value={createForm.locationId} onChange={setCF('locationId')}>
                <option value="">None</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Creating…' : 'Create employee'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
