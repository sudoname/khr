'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { BASE_DOMAIN, workspaceUrl } from '@/lib/workspace';
import { Alert, Spinner } from '@/components/ui';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const [workspaceSlug, setWorkspaceSlug] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (!token) {
      setState('error');
      setMessage('Missing verification token.');
      return;
    }
    api
      .post<{ workspaceSlug: string | null }>('/auth/verify-email', { token })
      .then((res) => {
        setWorkspaceSlug(res.workspaceSlug ?? null);
        setState('ok');
      })
      .catch((err) => {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Verification failed');
      });
  }, [token]);

  if (state === 'pending') return <Spinner />;

  const subdomainTarget = state === 'ok' && BASE_DOMAIN && workspaceSlug ? workspaceSlug : null;

  return (
    <div className="space-y-4">
      {state === 'ok' ? (
        <Alert kind="success">Your email has been verified. You can now sign in.</Alert>
      ) : (
        <Alert kind="error">{message}</Alert>
      )}
      {subdomainTarget ? (
        <a
          href={workspaceUrl(subdomainTarget, '/login')}
          className="block w-full rounded-md bg-cyan-600 px-4 py-2 text-center text-sm font-medium text-white transition hover:bg-cyan-500"
        >
          Continue to {subdomainTarget}.{BASE_DOMAIN}
        </a>
      ) : (
        <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
          Go to sign in
        </Link>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
