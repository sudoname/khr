'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Alert, Button, Field, Input, Spinner } from '@/components/ui';

function AcceptInviteInner() {
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
      await api.post('/auth/accept-invite', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <Alert kind="error">Missing invitation token. Use the link from your invitation email.</Alert>;
  }

  if (done) {
    return (
      <div className="space-y-4">
        <Alert kind="success">Invitation accepted — your account is ready.</Alert>
        <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold">Join your team</h2>
      <p className="text-sm text-slate-500">Set a password to accept the invitation.</p>
      {error && <Alert kind="error">{error}</Alert>}
      <Field label="Password (min 12 characters)">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          autoFocus
        />
      </Field>
      <Field label="Confirm password">
        <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full justify-center">
        {busy ? 'Joining…' : 'Accept invitation'}
      </Button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <AcceptInviteInner />
    </Suspense>
  );
}
