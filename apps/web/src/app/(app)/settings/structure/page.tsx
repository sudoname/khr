'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Button, Card, Empty, Field, Input, Select, Spinner } from '@/components/ui';

interface Department {
  id: string;
  name: string;
  parentId: string | null;
}

interface Location {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  timezone: string;
}

export default function StructureSettingsPage() {
  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [deptForm, setDeptForm] = useState({ name: '', parentId: '' });
  const [locForm, setLocForm] = useState({ name: '', city: '', state: '', country: 'NG', timezone: 'Africa/Lagos' });

  const load = useCallback(async () => {
    try {
      const [d, l] = await Promise.all([api.get<Department[]>('/departments'), api.get<Location[]>('/locations')]);
      setDepartments(d);
      setLocations(l);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDept(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post('/departments', deptForm.parentId ? deptForm : { name: deptForm.name });
      setDeptForm({ name: '', parentId: '' });
      setNotice('Department created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function removeDept(id: string) {
    setError('');
    try {
      await api.delete(`/departments/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function createLoc(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const body: Record<string, string> = {};
      for (const [k, v] of Object.entries(locForm)) if (v) body[k] = v;
      await api.post('/locations', body);
      setLocForm({ name: '', city: '', state: '', country: 'NG', timezone: 'Africa/Lagos' });
      setNotice('Location created.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function removeLoc(id: string) {
    setError('');
    try {
      await api.delete(`/locations/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const deptName = (id: string | null) => departments?.find((d) => d.id === id)?.name;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Departments & locations</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Departments">
          {departments === null ? (
            <Spinner />
          ) : departments.length === 0 ? (
            <Empty>No departments yet.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {departments.map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50">
                  <span>
                    {d.name}
                    {d.parentId && <span className="text-xs text-slate-400"> · under {deptName(d.parentId)}</span>}
                  </span>
                  <button onClick={() => void removeDept(d.id)} className="text-xs text-red-500 hover:underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={createDept} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input
                  value={deptForm.name}
                  onChange={(e) => setDeptForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="Engineering"
                />
              </Field>
              <Field label="Parent (optional)">
                <Select
                  value={deptForm.parentId}
                  onChange={(e) => setDeptForm((f) => ({ ...f, parentId: e.target.value }))}
                >
                  <option value="">None</option>
                  {(departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit">Add department</Button>
          </form>
        </Card>

        <Card title="Locations">
          {locations === null ? (
            <Spinner />
          ) : locations.length === 0 ? (
            <Empty>No locations yet.</Empty>
          ) : (
            <ul className="space-y-1 text-sm">
              {locations.map((l) => (
                <li key={l.id} className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50">
                  <span>
                    {l.name}
                    <span className="text-xs text-slate-400">
                      {' '}
                      · {[l.city, l.state, l.country].filter(Boolean).join(', ')}
                    </span>
                  </span>
                  <button onClick={() => void removeLoc(l.id)} className="text-xs text-red-500 hover:underline">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={createLoc} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            <Field label="Name">
              <Input
                value={locForm.name}
                onChange={(e) => setLocForm((f) => ({ ...f, name: e.target.value }))}
                required
                placeholder="Lagos HQ"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input value={locForm.city} onChange={(e) => setLocForm((f) => ({ ...f, city: e.target.value }))} />
              </Field>
              <Field label="State">
                <Input value={locForm.state} onChange={(e) => setLocForm((f) => ({ ...f, state: e.target.value }))} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country (ISO-2)">
                <Input
                  value={locForm.country}
                  onChange={(e) => setLocForm((f) => ({ ...f, country: e.target.value }))}
                  maxLength={2}
                  required
                />
              </Field>
              <Field label="Timezone">
                <Input
                  value={locForm.timezone}
                  onChange={(e) => setLocForm((f) => ({ ...f, timezone: e.target.value }))}
                  required
                />
              </Field>
            </div>
            <Button type="submit">Add location</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
