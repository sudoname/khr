'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Permission } from '@peopleflow/types';
import { api } from '@/lib/api';
import { SessionProvider, useSession } from '@/lib/session';
import { BASE_DOMAIN, apexUrl, getCurrentSlug, workspaceUrl } from '@/lib/workspace';
import { Alert, Spinner } from '@/components/ui';

interface NavItem {
  href: string;
  label: string;
  permission?: Permission;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/profile', label: 'My profile', permission: 'employee.read.self' },
  { href: '/people', label: 'People', permission: 'employee.read' },
  { href: '/org', label: 'Org chart', permission: 'org.read' },
  { href: '/leave', label: 'Leave', permission: 'leave.request.self' },
  { href: '/attendance', label: 'Attendance', permission: 'attendance.clock.self' },
  { href: '/payroll', label: 'Payroll', permission: 'payroll.read.self' },
  { href: '/recruitment', label: 'Recruitment', permission: 'recruitment.read' },
  { href: '/performance', label: 'Performance', permission: 'performance.read.self' },
  { href: '/training', label: 'Training', permission: 'training.read' },
  { href: '/documents', label: 'Documents', permission: 'document.read.self' },
  { href: '/reports', label: 'Reports', permission: 'report.read' },
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

  // Strict subdomain mode: members on the apex are sent to their workspace
  // subdomain. Platform admins keep apex access for /platform.
  const slug = getCurrentSlug();
  const apexRedirectTarget = (() => {
    if (!BASE_DOMAIN || slug || !me) return null;
    if (me.user.isPlatformAdmin && pathname.startsWith('/platform')) return null;
    const active =
      me.companies.find((c) => c.id === me.activeCompanyId) ??
      (me.companies.length === 1 ? me.companies[0] : null);
    return active ? workspaceUrl(active.slug, pathname) : null;
  })();

  useEffect(() => {
    if (apexRedirectTarget) window.location.replace(apexRedirectTarget);
  }, [apexRedirectTarget]);

  if (loading) return <Spinner />;
  if (!me) return <Spinner />; // 401 redirect to /login is in flight
  if (apexRedirectTarget) return <Spinner />; // hop to workspace subdomain in flight

  async function switchCompany(companyId: string) {
    if (BASE_DOMAIN) {
      const target = me?.companies.find((c) => c.id === companyId);
      if (target) {
        window.location.href = workspaceUrl(target.slug);
        return;
      }
    }
    await api.post('/auth/switch-company', { companyId });
    await refresh();
    router.replace('/dashboard');
  }

  async function logout() {
    await api.post('/auth/logout', {});
    router.replace('/login');
  }

  // On a workspace subdomain where the signed-in user is not a member.
  if (me.workspace && !me.workspace.member) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold">No access to this workspace</h2>
          <p className="text-sm text-slate-500">
            You are signed in as <span className="font-medium">{me.user.email}</span>, but you are
            not a member of{' '}
            <span className="font-mono">
              {me.workspace.slug}.{BASE_DOMAIN}
            </span>
            .
          </p>
          <a href={apexUrl('/dashboard')} className="block text-sm text-brand-600 hover:underline">
            Go to {BASE_DOMAIN}
          </a>
          <button
            onClick={() => void logout()}
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const visibleNav = NAV.filter((item) => !item.permission || can(item.permission));
  const visibleSettings = SETTINGS_NAV.filter((item) => !item.permission || can(item.permission));

  const linkClass = (href: string) =>
    `block rounded-lg px-3 py-1.5 text-sm transition ${
      pathname === href || pathname.startsWith(href + '/')
        ? 'bg-cyan-50 font-medium text-cyan-700'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white text-slate-700">
        <div className="border-b border-slate-200 px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center border border-cyan-500/70 font-mono text-[11px] font-bold text-cyan-600">
              K
            </span>
            <span className="font-mono text-sm tracking-[0.3em] text-slate-900">KHR</span>
          </Link>
          {me.companies.length > 1 ? (
            <select
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
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
            <div className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
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
              <div className="px-3 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Settings
              </div>
              {visibleSettings.map((item) => (
                <Link key={item.href} href={item.href} className={linkClass(item.href)}>
                  {item.label}
                </Link>
              ))}
            </>
          )}
          {me.user.isPlatformAdmin && (
            <>
              <div className="px-3 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Platform
              </div>
              <Link href="/platform" className={linkClass('/platform')}>
                Companies & plans
              </Link>
            </>
          )}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <Link href="/account" className={linkClass('/account')}>
            {me.user.firstName} {me.user.lastName}
          </Link>
          <div className="px-3 pt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {me.role ?? 'No role'}
          </div>
          <button
            onClick={() => void logout()}
            className="mt-2 w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900"
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
