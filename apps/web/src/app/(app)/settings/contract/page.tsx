'use client';

import { useEffect, useState } from 'react';
import {
  CONTRACT_PLACEHOLDERS,
  DEFAULT_CONTRACT_CLAUSES,
  DEFAULT_CONTRACT_TITLE,
} from '@peopleflow/types';
import { api } from '@/lib/api';
import { ClauseEditor, type EditableClause } from '@/components/clause-editor';
import { Alert, Badge, Button, Card, Field, Input, Spinner } from '@/components/ui';

interface Template {
  title: string;
  clauses: EditableClause[];
  isDefault: boolean;
}

export default function ContractTemplatePage() {
  const [loaded, setLoaded] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [title, setTitle] = useState('');
  const [clauses, setClauses] = useState<EditableClause[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Template>('/contracts/template')
      .then((t) => {
        setTitle(t.title);
        setClauses(t.clauses);
        setIsDefault(t.isDefault);
        setLoaded(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load template'));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const t = await api.put<Template>('/contracts/template', { title, clauses });
      setTitle(t.title);
      setClauses(t.clauses);
      setIsDefault(t.isDefault);
      setNotice('Contract template saved. New contracts will use these clauses.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function resetToDefault() {
    setTitle(DEFAULT_CONTRACT_TITLE);
    setClauses(DEFAULT_CONTRACT_CLAUSES.map((c) => ({ ...c })));
    setNotice('Restored the default clauses — save to apply.');
  }

  if (!loaded && !error) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Contract template</h1>
        {isDefault && <Badge tone="blue">Platform default</Badge>}
      </div>
      <p className="max-w-2xl text-sm text-slate-500">
        These clauses are used when you generate an employment contract for an employee. Placeholders
        are filled in from the employee&apos;s record at generation time, and the resulting contract
        stays editable per employee before it is downloaded as a PDF.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Available placeholders</h2>
        <div className="flex flex-wrap gap-1.5">
          {CONTRACT_PLACEHOLDERS.map((p) => (
            <code key={p} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
              {'{{' + p + '}}'}
            </code>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Unknown placeholders are left visible in the generated contract so typos are easy to spot.
        </p>
      </Card>

      {loaded && (
        <form onSubmit={save} className="space-y-4">
          <Card>
            <div className="max-w-md">
              <Field label="Contract title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
              </Field>
            </div>
          </Card>
          <Card>
            <ClauseEditor clauses={clauses} onChange={setClauses} disabled={busy} />
          </Card>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || clauses.length === 0}>
              {busy ? 'Saving…' : 'Save template'}
            </Button>
            <Button type="button" variant="secondary" disabled={busy} onClick={resetToDefault}>
              Reset to default clauses
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
