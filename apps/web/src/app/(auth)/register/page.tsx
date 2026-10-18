'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { COMPANY_SECTORS, COMPANY_SECTOR_LABELS, isAllocatableSlug } from '@peopleflow/types';
import { api, ApiError } from '@/lib/api';
import { BASE_DOMAIN } from '@/lib/workspace';
import { Alert, Button, Field, Input, Select } from '@/components/ui';

const SUFFIX = BASE_DOMAIN || 'khr.ng';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

type SlugStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

function RegisterForm() {
  const search = useSearchParams();
  const fromGoogle = search.get('google') === 'no_account';
  const [form, setForm] = useState({
    companyName: '',
    slug: '',
    sector: '',
    firstName: '',
    lastName: '',
    email: search.get('email') ?? '',
    password: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>('idle');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  function setCompanyName(e: React.ChangeEvent<HTMLInputElement>) {
    const companyName = e.target.value;
    // Suggest an address from the company name until the user edits it.
    setForm((f) => ({ ...f, companyName, ...(slugTouched ? {} : { slug: slugify(companyName) }) }));
  }

  function setSlug(e: React.ChangeEvent<HTMLInputElement>) {
    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 50);
    setSlugTouched(true);
    setForm((f) => ({ ...f, slug }));
  }

  // Debounced availability check against the public workspace lookup.
  useEffect(() => {
    const slug = form.slug;
    if (!slug) {
      setSlugStatus('idle');
      return;
    }
    if (!isAllocatableSlug(slug)) {
      setSlugStatus('invalid');
      return;
    }
    setSlugStatus('checking');
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get(`/workspaces/${slug}`)
        .then(() => {
          if (!cancelled) setSlugStatus('taken');
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof ApiError && err.status === 404) {
            setSlugStatus('available');
          } else {
            setSlugStatus('idle'); // network hiccup — the server still enforces
          }
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.slug]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.slug && slugStatus === 'taken') {
      setError(`${form.slug}.${SUFFIX} is already in use — choose a different name.`);
      return;
    }
    if (form.slug && slugStatus === 'invalid') {
      setError(`${form.slug}.${SUFFIX} is not available — choose a different name.`);
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/register', { ...form, slug: form.slug || undefined });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SLUG_TAKEN') {
        setSlugStatus('taken');
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : 'Registration failed');
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert kind="success">
          Almost there — we sent a verification link to <strong>{form.email}</strong>. Click it to activate your
          account. (In local dev, open Mailhog at http://localhost:8025.)
        </Alert>
        {form.slug && (
          <p className="text-center font-mono text-sm text-slate-600">
            Your workspace: {form.slug}.{SUFFIX}
          </p>
        )}
        <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold">Create your company workspace</h2>
      {fromGoogle && (
        <Alert kind="info">
          No workspace is linked to that Google account yet. Create one below — after that you can sign in with
          Google.
        </Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="Company name">
        <Input value={form.companyName} onChange={setCompanyName} required autoFocus />
      </Field>
      <Field label="Workspace address">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input value={form.slug} onChange={setSlug} required placeholder="khan" />
          </div>
          <span className="shrink-0 font-mono text-sm text-slate-500">.{SUFFIX}</span>
        </div>
        {form.slug ? (
          slugStatus === 'available' ? (
            <p className="mt-1 text-xs text-emerald-600">
              {form.slug}.{SUFFIX} is available
            </p>
          ) : slugStatus === 'taken' ? (
            <p className="mt-1 text-xs text-red-600">
              {form.slug}.{SUFFIX} is already in use — choose a different name
            </p>
          ) : slugStatus === 'invalid' ? (
            <p className="mt-1 text-xs text-red-600">
              {form.slug}.{SUFFIX} is not available — choose a different name
            </p>
          ) : slugStatus === 'checking' ? (
            <p className="mt-1 text-xs text-slate-400">Checking availability…</p>
          ) : null
        ) : (
          <p className="mt-1 text-xs text-slate-400">Short and memorable works best — your team signs in here.</p>
        )}
      </Field>
      <Field label="Sector">
        <Select
          value={form.sector}
          onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))}
          required
        >
          <option value="" disabled>
            Select your industry…
          </option>
          {COMPANY_SECTORS.map((s) => (
            <option key={s} value={s}>
              {COMPANY_SECTOR_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input value={form.firstName} onChange={set('firstName')} required />
        </Field>
        <Field label="Last name">
          <Input value={form.lastName} onChange={set('lastName')} required />
        </Field>
      </div>
      <Field label="Work email">
        <Input type="email" value={form.email} onChange={set('email')} required />
      </Field>
      <Field label="Password (min 12 characters)">
        <Input type="password" value={form.password} onChange={set('password')} required minLength={12} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full justify-center">
        {busy ? 'Creating…' : 'Create workspace'}
      </Button>
      <p className="text-center text-xs text-slate-500">
        Already have an account?{' '}
        <Link href="/login" className="text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
