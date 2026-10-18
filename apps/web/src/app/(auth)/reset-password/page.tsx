'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <Alert kind="error">Missing reset token. Use the link from your email.</Alert>;
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert kind="success">Password updated. All other sessions have been signed out.</Alert>
        <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
          Sign in with your new password
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold">Choose a new password</h2>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="New password (min 12 characters)">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          autoFocus
        />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full justify-center">
        {busy ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
