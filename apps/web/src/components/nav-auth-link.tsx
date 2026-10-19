'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Landing-page nav link that swaps "Sign in" for "Dashboard" when a session
 * cookie is live. Renders the signed-out link first, then upgrades.
 */
export function NavAuthLink({ className }: { className: string }) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get('/auth/me')
      .then(() => {
        if (!cancelled) setSignedIn(true);
      })
      .catch(() => {}); // not signed in — keep the default link
    return () => {
      cancelled = true;
    };
  }, []);

  return signedIn ? (
    <Link href="/dashboard" className={className}>
      DASHBOARD
    </Link>
  ) : (
    <Link href="/login" className={className}>
      SIGN IN
    </Link>
  );
}
