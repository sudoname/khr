'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Button, Field, Input } from '@/components/ui';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1-.8 2.6-2.4 3.7l-.02.14 3.5 2.7.24.02c2.2-2 3.5-5 3.5-8.5z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2a7.2 7.2 0 0 1-6.8-5l-.14.01-3.6 2.8-.05.13A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.4a7.4 7.4 0 0 1 0-4.7l-.01-.16-3.7-2.8-.12.06a12 12 0 0 0 0 10.7l3.8-3z" />
      <path fill="#EA4335" d="M12 4.7c2.3 0 3.9 1 4.8 1.8l3.5-3.4C18 1.2 15.2 0 12 0A12 12 0 0 0 1.3 6.6l3.9 3a7.2 7.2 0 0 1 6.8-5z" />
    </svg>
  );
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(search.get('mfaToken'));
  const [code, setCode] = useState('');
  const [error, setError] = useState(search.get('error') === 'google' ? 'Google sign-in failed. Please try again or use your password.' : '');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    api
      .get<{ google: boolean }>('/auth/providers')
      .then((p) => setGoogleEnabled(p.google))
      .catch(() => setGoogleEnabled(false));
  }, []);

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

      {!mfaToken && googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            or
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <GoogleIcon />
            Continue with Google
          </a>
        </>
      )}

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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
