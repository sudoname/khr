'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { BASE_DOMAIN, apexUrl, getCurrentSlug, workspaceUrl } from '@/lib/workspace';
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

interface LoginCompany {
  id: string;
  name: string;
  slug: string;
  role: string;
}

interface WorkspaceInfo {
  name: string;
  slug: string;
  hasLogo: boolean;
  logoVersion: number | null;
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const slug = getCurrentSlug();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(search.get('mfaToken'));
  const [code, setCode] = useState('');
  const [error, setError] = useState(search.get('error') === 'google' ? 'Google sign-in failed. Please try again or use your password.' : '');
  const [busy, setBusy] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [workspaceMissing, setWorkspaceMissing] = useState(false);
  const [picker, setPicker] = useState<LoginCompany[] | null>(null);

  useEffect(() => {
    api
      .get<{ google: boolean }>('/auth/providers')
      .then((p) => setGoogleEnabled(p.google))
      .catch(() => setGoogleEnabled(false));
  }, []);

  useEffect(() => {
    if (!slug) return;
    api
      .get<WorkspaceInfo>(`/workspaces/${slug}`)
      .then(setWorkspace)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setWorkspaceMissing(true);
      });
  }, [slug]);

  function routeAfterLogin(companies: LoginCompany[]) {
    // On a workspace subdomain (or local dev) the host already selects the
    // tenant — go straight in.
    if (slug || !BASE_DOMAIN) {
      router.replace('/dashboard');
      return;
    }
    // Apex login: send members to their workspace subdomain.
    const requested = search.get('workspace');
    const target =
      (requested && companies.find((c) => c.slug === requested)) ??
      (companies.length === 1 ? companies[0] : null);
    if (target) {
      window.location.href = workspaceUrl(target.slug);
      return;
    }
    if (companies.length > 1) {
      setPicker(companies);
      return;
    }
    router.replace('/dashboard');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mfaToken) {
        const result = await api.post<{ companies: LoginCompany[] }>('/auth/mfa/verify', { mfaToken, code });
        routeAfterLogin(result.companies ?? []);
        return;
      }
      const result = await api.post<{ mfaRequired: boolean; mfaToken?: string; companies?: LoginCompany[] }>(
        '/auth/login',
        { email, password },
      );
      if (result.mfaRequired && result.mfaToken) {
        setMfaToken(result.mfaToken);
      } else {
        routeAfterLogin(result.companies ?? []);
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

  if (workspaceMissing) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-lg font-semibold">Workspace not found</h2>
        <p className="text-sm text-slate-500">
          There is no workspace at <span className="font-mono">{slug}.{BASE_DOMAIN}</span>.
        </p>
        <a href={apexUrl('/login')} className="block text-sm text-brand-600 hover:underline">
          Go to {BASE_DOMAIN}
        </a>
      </div>
    );
  }

  if (picker) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Choose a workspace</h2>
        <p className="text-sm text-slate-500">You belong to more than one company. Pick where to go:</p>
        <div className="space-y-2">
          {picker.map((c) => (
            <a
              key={c.id}
              href={workspaceUrl(c.slug)}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm transition hover:border-cyan-400 hover:bg-cyan-50"
            >
              <span className="font-medium text-slate-800">{c.name}</span>
              <span className="font-mono text-xs text-slate-400">{c.slug}.{BASE_DOMAIN}</span>
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {workspace && (
        <div className="flex flex-col items-center gap-2 border-b border-slate-100 pb-4">
          {workspace.hasLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/workspaces/${workspace.slug}/logo${workspace.logoVersion ? `?v=${workspace.logoVersion}` : ''}`}
              alt={workspace.name}
              className="h-12 w-12 rounded-lg object-contain"
            />
          )}
          <div className="text-base font-semibold text-slate-900">{workspace.name}</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-slate-400">
            {workspace.slug}.{BASE_DOMAIN}
          </div>
        </div>
      )}
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
            href={`/api/auth/google${slug ? `?workspace=${encodeURIComponent(slug)}` : ''}`}
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
