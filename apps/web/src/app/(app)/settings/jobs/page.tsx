'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Spinner } from '@/components/ui';

interface Job {
  id: string;
  title: string;
  responsibilities: string[];
  employeeCount: number;
}

const EMPTY_FORM = { title: '', responsibilities: '' };

export default function JobsSettingsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // null = closed, 'new' = creating, otherwise the job being edited
  const [editing, setEditing] = useState<'new' | Job | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setJobs(await api.get<Job[]>('/jobs'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openModal(target: 'new' | Job) {
    setModalError('');
    setForm(
      target === 'new'
        ? { ...EMPTY_FORM }
        : { title: target.title, responsibilities: target.responsibilities.join('\n') },
    );
    setEditing(target);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    setBusy(true);
    try {
      const responsibilities = form.responsibilities
        .split('\n')
        .map((r) => r.trim())
        .filter(Boolean);
      const body = { title: form.title, responsibilities };
      if (editing === 'new') {
        await api.post('/jobs', body);
        setNotice('Job added to the catalog.');
      } else if (editing) {
        await api.patch(`/jobs/${editing.id}`, body);
        setNotice('Job updated.');
      }
      setEditing(null);
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(job: Job) {
    if (!window.confirm(`Delete the "${job.title}" job from the catalog?`)) return;
    setError('');
    setNotice('');
    try {
      await api.delete(`/jobs/${job.id}`);
      setNotice('Job removed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <Button onClick={() => openModal('new')}>Add job</Button>
      </div>
      <p className="text-sm text-slate-500">
        Each job has a title and defined responsibilities. Assign a job when creating or editing an employee;
        the responsibilities show on their profile and are available to contracts via the{' '}
        <code className="rounded bg-slate-100 px-1">{'{{responsibilities}}'}</code> placeholder.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {jobs === null ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        <Card>
          <Empty>No jobs defined yet. Add your first job to the catalog.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {jobs.map((job) => (
            <Card
              key={job.id}
              title={job.title}
              actions={
                <div className="flex items-center gap-2">
                  <Badge tone={job.employeeCount > 0 ? 'blue' : 'slate'}>
                    {job.employeeCount} employee{job.employeeCount === 1 ? '' : 's'}
                  </Badge>
                  <Button variant="secondary" onClick={() => openModal(job)}>
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => void remove(job)}>
                    Delete
                  </Button>
                </div>
              }
            >
              <div className="mb-1 text-xs font-medium text-slate-500">Responsibilities</div>
              <ol className="list-inside list-decimal space-y-1 text-sm">
                {job.responsibilities.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}

      {editing !== null && (
        <Modal title={editing === 'new' ? 'Add job' : `Edit ${editing.title}`} onClose={() => setEditing(null)}>
          <form onSubmit={submit} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Job title">
              <Input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                autoFocus
                placeholder="Farm Hand"
              />
            </Field>
            <Field label="Responsibilities (one per line)">
              <textarea
                value={form.responsibilities}
                onChange={(e) => setForm((f) => ({ ...f, responsibilities: e.target.value }))}
                required
                rows={8}
                placeholder={'Prune and maintain palm trees\nHarvest fresh fruit bunches\nReport equipment faults to the supervisor'}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : editing === 'new' ? 'Add job' : 'Save changes'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
