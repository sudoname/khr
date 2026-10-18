'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';

function RegisterForm() {
  const search = useSearchParams();
  const fromGoogle = search.get('google') === 'no_account';
  const [form, setForm] = useState({
    companyName: '',
    firstName: '',
    lastName: '',
    email: search.get('email') ?? '',
    password: '',
  });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post('/auth/register', form);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
        <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline dark:text-cyan-300">
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
        <Input value={form.companyName} onChange={set('companyName')} required autoFocus />
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
        <Link href="/login" className="text-brand-600 hover:underline dark:text-cyan-300">
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
