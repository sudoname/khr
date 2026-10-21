'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ClauseEditor, type EditableClause } from '@/components/clause-editor';
import { Alert, Button, Card, Field, Input, Spinner } from '@/components/ui';

interface Contract {
  id: string;
  employeeId: string;
  title: string;
  roleTitle: string;
  clauses: EditableClause[];
  updatedAt: string;
}

export default function EmployeeContractPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contract, setContract] = useState<Contract | null>(null);
  const [title, setTitle] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [clauses, setClauses] = useState<EditableClause[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Contract>(`/contracts/employee/${id}`)
      .then((c) => {
        setContract(c);
        setTitle(c.title);
        setRoleTitle(c.roleTitle);
        setClauses(c.clauses);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load contract'));
  }, [id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!contract) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const updated = await api.patch<Contract>(`/contracts/${contract.id}`, { title, roleTitle, clauses });
      setContract(updated);
      setNotice('Contract saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!contract) return;
    if (!window.confirm('Delete this contract? You can regenerate it from the template afterwards.')) return;
    setBusy(true);
    try {
      await api.delete(`/contracts/${contract.id}`);
      router.replace(`/people/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setBusy(false);
    }
  }

  if (!contract && !error) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/people/${id}`} className="text-xs text-slate-400 hover:text-brand-600">
            ← Back to profile
          </Link>
          <h1 className="text-xl font-semibold">Employment contract</h1>
          <p className="text-sm text-slate-500">
            Edit the final contract text for this employee, then download it as a PDF.
          </p>
        </div>
        {contract && (
          <div className="flex gap-2">
            <a href={`/api/contracts/${contract.id}/pdf`}>
              <Button variant="secondary">Download PDF</Button>
            </a>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              Delete
            </Button>
          </div>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {contract && (
        <form onSubmit={save} className="space-y-4">
          <Card>
            <div className="grid max-w-2xl grid-cols-2 gap-3">
              <Field label="Contract title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
              </Field>
              <Field label="Position (shown under the title)">
                <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} required maxLength={200} />
              </Field>
            </div>
          </Card>
          <Card>
            <ClauseEditor clauses={clauses} onChange={setClauses} disabled={busy} />
          </Card>
          <Button type="submit" disabled={busy || clauses.length === 0}>
            {busy ? 'Saving…' : 'Save contract'}
          </Button>
        </form>
      )}
    </div>
  );
}
