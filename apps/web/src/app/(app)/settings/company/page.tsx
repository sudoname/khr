'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Button, Card, Field, Input, Spinner } from '@/components/ui';

interface Company {
  id: string;
  name: string;
  slug: string;
  country: string;
  timezone: string;
  currency: string;
  termsOfEmployment: string | null;
}

export default function CompanySettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [form, setForm] = useState({ name: '', country: '', timezone: '', currency: '', termsOfEmployment: '' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Company>('/company')
      .then((c) => {
        setCompany(c);
        setForm({
          name: c.name,
          country: c.country,
          timezone: c.timezone,
          currency: c.currency,
          termsOfEmployment: c.termsOfEmployment ?? '',
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load company'));
  }, []);

  const set =
    (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const updated = await api.patch<Company>('/company', form);
      setCompany(updated);
      setNotice('Company settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!company && !error) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Company settings</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {company && (
        <Card>
          <form onSubmit={save} className="max-w-md space-y-3">
            <Field label="Company name">
              <Input value={form.name} onChange={set('name')} required minLength={2} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Country (ISO-2)">
                <Input value={form.country} onChange={set('country')} required maxLength={2} placeholder="NG" />
              </Field>
              <Field label="Currency (ISO-3)">
                <Input value={form.currency} onChange={set('currency')} required maxLength={3} placeholder="NGN" />
              </Field>
              <Field label="Timezone">
                <Input value={form.timezone} onChange={set('timezone')} required placeholder="Africa/Lagos" />
              </Field>
            </div>
            <p className="text-xs text-slate-400">
              The timezone controls how attendance days are bucketed. Workspace URL slug: <code>{company.slug}</code>
            </p>
            <Field label="Terms of employment (shown to employees during onboarding)">
              <textarea
                value={form.termsOfEmployment}
                onChange={set('termsOfEmployment')}
                rows={8}
                maxLength={20000}
                placeholder="Leave empty to use the platform default terms."
                className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
