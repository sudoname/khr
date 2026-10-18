'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Button, Card, Field, Input, Spinner } from '@/components/ui';

interface Company {
  id: string;
  name: string;
  slug: string;
  country: string;
  timezone: string;
  currency: string;
  rcNumber: string | null;
  logoUrl: string | null;
  termsOfEmployment: string | null;
}

export default function CompanySettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [form, setForm] = useState({
    name: '',
    country: '',
    timezone: '',
    currency: '',
    rcNumber: '',
    termsOfEmployment: '',
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
          rcNumber: c.rcNumber ?? '',
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

  async function uploadLogo(file: File) {
    setError('');
    setNotice('');
    setLogoBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/company/logo', { method: 'POST', credentials: 'include', body });
      const data = (await res.json().catch(() => null)) as { logoUrl?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? 'Upload failed');
      setCompany((c) => (c ? { ...c, logoUrl: data?.logoUrl ?? c.logoUrl } : c));
      setNotice('Company logo updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeLogo() {
    setError('');
    setNotice('');
    setLogoBusy(true);
    try {
      await api.delete('/company/logo');
      setCompany((c) => (c ? { ...c, logoUrl: null } : c));
      setNotice('Company logo removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setLogoBusy(false);
    }
  }

  if (!company && !error) return <Spinner />;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Company settings</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {company && (
        <>
          <Card>
            <div className="flex items-center gap-4">
              {company.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={company.logoUrl}
                  alt={`${company.name} logo`}
                  className="h-16 w-16 rounded-lg border border-slate-200 object-contain bg-white"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
                  No logo
                </div>
              )}
              <div className="space-y-1">
                <div className="flex gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadLogo(file);
                    }}
                  />
                  <Button variant="secondary" disabled={logoBusy} onClick={() => fileRef.current?.click()}>
                    {logoBusy ? 'Working…' : company.logoUrl ? 'Change logo' : 'Upload logo'}
                  </Button>
                  {company.logoUrl && (
                    <Button variant="secondary" disabled={logoBusy} onClick={() => void removeLogo()}>
                      Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-slate-400">JPEG, PNG or WebP, up to 2 MB.</p>
              </div>
            </div>
          </Card>
          <Card>
            <form onSubmit={save} className="max-w-md space-y-3">
              <Field label="Company name">
                <Input value={form.name} onChange={set('name')} required minLength={2} />
              </Field>
              <Field label="RC number (CAC registration)">
                <Input value={form.rcNumber} onChange={set('rcNumber')} maxLength={40} placeholder="RC 1234567" />
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
        </>
      )}
    </div>
  );
}
