'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mfaToken) {
        await api.post('/auth/mfa/verify', { mfaToken, code });
        router.replace('/dashboard');
        return;
      }
      const result = await api.post<{ mfaRequired: boolean; mfaToken?: string }>('/auth/login', {
        email,
        password,
      });
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
      } else {
        router.replace('/dashboard');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') {
        setError('Please verify your email first — check your inbox for the verification link.');
      } else {
        setError(err instanceof Error ? err.message : 'Login failed');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="text-lg font-semibold">{mfaToken ? 'Two-factor authentication' : 'Sign in'}</h2>
      {error && <Alert kind="error">{error}</Alert>}

      {!mfaToken ? (
        <>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
        </>
      ) : (
        <Field label="Authenticator code (or a recovery code)">
          <Input value={code} onChange={(e) => setCode(e.target.value)} required autoFocus placeholder="123456" />
        </Field>
      )}

      <Button type="submit" disabled={busy} className="w-full justify-center">
        {busy ? 'Please wait…' : mfaToken ? 'Verify' : 'Sign in'}
      </Button>

      <div className="flex justify-between text-xs text-slate-500">
        <Link href="/forgot-password" className="hover:text-brand-600">
          Forgot password?
        </Link>
        <Link href="/register" className="hover:text-brand-600">
          Create a company
        </Link>
      </div>
    </form>
  );
}
