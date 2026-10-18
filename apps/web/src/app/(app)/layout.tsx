'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Permission } from '@peopleflow/types';
import { api } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';
import { Alert, Spinner } from '@/components/ui';

interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/people', label: 'People', permission: 'employee.read' },
  { href: '/org', label: 'Org chart', permission: 'org.read' },
  { href: '/leave', label: 'Leave', permission: 'leave.request.self' },
  { href: '/attendance', label: 'Attendance', permission: 'attendance.clock.self' },
];

const SETTINGS_NAV: NavItem[] = [
  { href: '/settings/company', label: 'Company', permission: 'company.manage' },
  { href: '/settings/members', label: 'Members', permission: 'members.manage' },
  { href: '/settings/structure', label: 'Departments & locations', permission: 'department.manage' },
  { href: '/settings/audit', label: 'Audit log', permission: 'audit.read' },
];

function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, can, refresh, mfaRequiredButMissing } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (loading) return <Spinner />;
  if (!me) return <Spinner />; // 401 redirect to /login is in flight

  const visibleNav = NAV.filter((item) => !item.permission || can(item.permission));
  const visibleSettings = SETTINGS_NAV.filter((item) => !item.permission || can(item.permission));

  async function switchCompany(companyId: string) {
    await api.post('/auth/switch-company', { companyId });
    await refresh();
    router.replace('/dashboard');
  }

  async function logout() {
    await api.post('/auth/logout', {});
    router.replace('/login');
  }

  const linkClass = (href: string) =>
    `block rounded-lg px-3 py-1.5 text-sm transition ${
      pathname === href || pathname.startsWith(href + '/')
        ? 'bg-cyan-500/15 text-cyan-300'
        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
    }`;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-white/10 bg-[#05070a] text-slate-300">
        <div className="border-b border-white/10 px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center border border-cyan-400/60 font-mono text-[11px] font-bold text-cyan-300">
              K
            </span>
            <span className="font-mono text-sm tracking-[0.3em] text-white">KHR</span>
          </Link>
          {me.companies.length > 1 ? (
            <select
              className="mt-3 w-full rounded-lg border border-slate-700 bg-[#0b1016] px-2 py-1 text-xs text-slate-200"
              value={me.activeCompanyId ?? ''}
              onChange={(e) => void switchCompany(e.target.value)}
            >
              {me.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
              {me.companies[0]?.name}
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {visibleNav.map((item) => (
            <Link key={item.href} href={item.href} className={linkClass(item.href)}>
              {item.label}
            </Link>
          ))}
          {visibleSettings.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-600">
                Settings
              </div>
              {visibleSettings.map((item) => (
                <Link key={item.href} href={item.href} className={linkClass(item.href)}>
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>

        <div className="border-t border-white/10 p-3">
          <Link href="/account" className={linkClass('/account')}>
            {me.user.firstName} {me.user.lastName}
          </Link>
          <div className="px-3 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
            {me.role ?? 'No role'}
          </div>
          <button
            onClick={() => void logout()}
            className="mt-2 w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-400 hover:bg-white/5 hover:text-slate-200"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        {mfaRequiredButMissing && (
          <div className="mb-4">
            <Alert kind="info">
              Your role requires two-factor authentication. Most actions are blocked until you{' '}
              <Link href="/account" className="font-medium underline">
                enable MFA in your account settings
              </Link>
              .
            </Alert>
          </div>
        )}
        {me.employee &&
          (me.employee.onboardingStatus !== 'APPROVED' || !me.employee.termsAcceptedAt) &&
          pathname !== '/onboarding' && (
            <div className="mb-4">
              <Alert kind="info">
                {me.employee.onboardingStatus === 'SUBMITTED' ? (
                  <>Your employee profile has been submitted and is awaiting HR review.</>
                ) : me.employee.onboardingStatus === 'APPROVED' ? (
                  <>Your profile is approved — please accept your terms of employment.</>
                ) : me.employee.onboardingStatus === 'REJECTED' ? (
                  <>Your profile submission needs changes.</>
                ) : (
                  <>Welcome! Please complete your employee profile setup.</>
                )}{' '}
                <Link href="/onboarding" className="font-medium underline">
                  Go to onboarding
                </Link>
              </Alert>
            </div>
          )}
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Shell>{children}</Shell>
    </SessionProvider>
  );
}
