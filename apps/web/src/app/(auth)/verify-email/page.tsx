'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Alert, Spinner } from '@/components/ui';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState('');
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
      .post('/auth/verify-email', { token })
      .then(() => setState('ok'))
      .catch((err) => {
        setState('error');
        setMessage(err instanceof Error ? err.message : 'Verification failed');
      });
  }, [token]);

  if (state === 'pending') return <Spinner />;

  return (
    <div className="space-y-4">
      {state === 'ok' ? (
        <Alert kind="success">Your email has been verified. You can now sign in.</Alert>
      ) : (
        <Alert kind="error">{message}</Alert>
      )}
      <Link href="/login" className="block text-center text-sm text-brand-600 hover:underline">
        Go to sign in
      </Link>
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
