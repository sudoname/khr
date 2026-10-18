'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { roleHas, MFA_REQUIRED_ROLES } from '@peopleflow/types';
import type { CompanyRole, Permission } from '@peopleflow/types';
import { api, ApiError } from './api';

export interface Me {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    mfaEnabled: boolean;
    isPlatformAdmin: boolean;
  };
  activeCompanyId: string | null;
  role: CompanyRole | null;
  employee: {
    id: string;
    employeeNo: string;
    jobTitle: string;
    onboardingStatus: 'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
    termsAcceptedAt: string | null;
  } | null;
  companies: { id: string; name: string; slug: string; role: CompanyRole }[];
}

interface SessionState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  can: (permission: Permission) => boolean;
  mfaRequiredButMissing: boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<Me>('/auth/me');
      setMe(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        router.replace('/login');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const can = useCallback(
    (permission: Permission) => (me?.role ? roleHas(me.role, permission) : false),
    [me],
  );

  const mfaRequiredButMissing =
    !!me?.role && MFA_REQUIRED_ROLES.includes(me.role) && !me.user.mfaEnabled;

  return (
    <SessionContext.Provider value={{ me, loading, refresh, can, mfaRequiredButMissing }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
