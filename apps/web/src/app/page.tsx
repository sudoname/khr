import Link from 'next/link';

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.3 6.1 29.4 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C41.1 35.2 44 30.1 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

const CAPABILITIES = [
  {
    n: '01',
    title: 'Tenant Isolation',
    body: 'Four independent enforcement layers — per-request membership checks, scoped context, a tenant-bound data client, and Postgres row-level security. Verified by automated cross-tenant attack tests.',
  },
  {
    n: '02',
    title: 'Access Control',
    body: 'Seven-role RBAC matrix enforced server-side. Mandatory TOTP multi-factor for privileged operators. Hashed, revocable sessions. No client-side trust, anywhere.',
  },
  {
    n: '03',
    title: 'Workforce Records',
    body: 'Complete employee lifecycle with field-level clearance: salary, BVN and bank data visible only to the subject and explicitly authorized roles.',
  },
  {
    n: '04',
    title: 'Org Graph',
    body: 'Live reporting structure with cycle-proof department trees and manager chains. The graph is validated on every mutation — bad topology cannot be committed.',
  },
  {
    n: '05',
    title: 'Leave Operations',
    body: 'Policy-driven entitlements, working-day computation against company calendars and public holidays, balance enforcement and a full approval trail.',
  },
  {
    n: '06',
    title: 'Attendance Telemetry',
    body: 'Server-timestamped clock events stored in UTC. Duplicate-proof by design. Corrections flow through review — history is never silently rewritten.',
  },
];

const STACK = ['NEXT.JS 14', 'NESTJS', 'POSTGRES // RLS', 'PRISMA', 'REDIS', 'BULLMQ', 'ARGON2ID', 'TOTP MFA', 'ZOD', 'DOCKER'];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05070a] font-sans text-slate-300">
      {/* backdrop */}
      <div className="hud-grid pointer-events-none absolute inset-0" />
      <div className="hud-glow pointer-events-none absolute inset-x-0 top-0 h-[60vh]" />
      <div className="hud-scanline pointer-events-none absolute inset-x-0 top-0 h-40" />

      {/* nav */}
      <header className="relative z-10 border-b border-white/5 bg-[#05070a]/70 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center border border-cyan-400/60 font-mono text-xs font-bold text-cyan-300">
              K
            </span>
            <span className="font-mono text-sm tracking-[0.3em] text-white">KHR</span>
            <span className="hidden font-mono text-[10px] tracking-[0.25em] text-slate-500 sm:inline">
              PEOPLEFLOW HR SYSTEMS
            </span>
          </Link>
          <nav className="flex items-center gap-6">
            <a href="#capabilities" className="hidden font-mono text-[11px] tracking-[0.2em] text-slate-400 hover:text-cyan-300 md:inline">
              CAPABILITIES
            </a>
            <a href="#security" className="hidden font-mono text-[11px] tracking-[0.2em] text-slate-400 hover:text-cyan-300 md:inline">
              SECURITY
            </a>
            <Link href="/login" className="font-mono text-[11px] tracking-[0.2em] text-slate-300 hover:text-cyan-300">
              SIGN IN
            </Link>
            <Link
              href="/register"
              className="border border-cyan-400/60 px-4 py-1.5 font-mono text-[11px] tracking-[0.2em] text-cyan-300 transition hover:bg-cyan-400/10"
            >
              DEPLOY
            </Link>
          </nav>
        </div>
      </header>

      {/* hero */}
      <main className="relative z-10">
        <section className="mx-auto max-w-6xl px-6 pb-24 pt-24 md:pt-32">
          <p className="mb-6 font-mono text-[11px] tracking-[0.35em] text-cyan-400">
            <span className="hud-blink mr-2 inline-block h-2 w-2 bg-cyan-400 align-middle" />
            WORKFORCE OPERATING SYSTEM — NIGERIA FIRST
          </p>
          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl">
            People operations,
            <br />
            engineered like <span className="text-cyan-300">infrastructure.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
            KHR is a multi-tenant HR platform built to defense-grade standards: hard tenant isolation, enforced
            multi-factor access, auditable by default. Employees, org graph, leave and attendance — one command
            surface.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/login"
              className="bg-white px-6 py-3 font-mono text-xs tracking-[0.2em] text-black transition hover:bg-cyan-200"
            >
              LAUNCH CONSOLE →
            </Link>
            <Link
              href="/register"
              className="border border-white/20 px-6 py-3 font-mono text-xs tracking-[0.2em] text-white transition hover:border-cyan-400/60 hover:text-cyan-300"
            >
              CREATE WORKSPACE
            </Link>
            <a
              href="/api/auth/google"
              className="flex items-center gap-2.5 border border-white/20 bg-white/5 px-6 py-3 font-mono text-xs tracking-[0.15em] text-white transition hover:border-white/50 hover:bg-white/10"
            >
              <GoogleIcon />
              CONTINUE WITH GOOGLE
            </a>
          </div>

          {/* status strip */}
          <div className="mt-20 grid grid-cols-2 gap-px border border-white/10 bg-white/10 font-mono md:grid-cols-4">
            {[
              ['ISOLATION', '4-LAYER / RLS'],
              ['ACCESS', 'RBAC + TOTP MFA'],
              ['AUDIT', 'APPEND-ONLY'],
              ['REGION', 'NG / UTC CORE'],
            ].map(([k, v]) => (
              <div key={k} className="bg-[#05070a] px-5 py-4">
                <div className="text-[10px] tracking-[0.3em] text-slate-500">{k}</div>
                <div className="mt-1 text-xs tracking-[0.15em] text-cyan-300">{v}</div>
              </div>
            ))}
          </div>
        </section>

        {/* capabilities */}
        <section id="capabilities" className="border-t border-white/5">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <p className="font-mono text-[11px] tracking-[0.35em] text-slate-500">/ 01 — CAPABILITIES</p>
            <h2 className="mt-4 max-w-xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Every module, mission-ready.
            </h2>
            <div className="mt-14 grid gap-px border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
              {CAPABILITIES.map((c) => (
                <div key={c.n} className="group bg-[#05070a] p-7 transition hover:bg-[#081018]">
                  <div className="font-mono text-[11px] tracking-[0.3em] text-slate-600 transition group-hover:text-cyan-400">
                    {c.n}
                  </div>
                  <h3 className="mt-4 text-base font-semibold tracking-wide text-white">{c.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* security */}
        <section id="security" className="border-t border-white/5">
          <div className="mx-auto grid max-w-6xl gap-14 px-6 py-24 lg:grid-cols-2">
            <div>
              <p className="font-mono text-[11px] tracking-[0.35em] text-slate-500">/ 02 — SECURITY POSTURE</p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                Zero trust between tenants. Zero exceptions.
              </h2>
              <ul className="mt-8 space-y-4 text-sm text-slate-400">
                {[
                  'Membership re-verified on every request — revoked access fails closed, instantly.',
                  'Postgres row-level security backs the application layer: even raw SQL cannot cross a tenant boundary.',
                  'Argon2id credentials, hashed opaque sessions, enumeration-resistant auth flows.',
                  'TOTP multi-factor is mandatory for privileged operators, with hashed recovery codes.',
                  'Compensation, BVN and bank data are field-level restricted to the subject and cleared roles.',
                ].map((line) => (
                  <li key={line} className="flex gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-cyan-400" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-white/10 bg-black/40 p-6 font-mono text-xs leading-7">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                <span className="tracking-[0.25em] text-slate-500">AUDIT // LIVE FEED</span>
                <span className="hud-blink h-2 w-2 bg-emerald-400" />
              </div>
              <p><span className="text-slate-600">02:14:07Z</span> <span className="text-cyan-300">auth.login</span> <span className="text-slate-500">mfa=totp ok</span></p>
              <p><span className="text-slate-600">02:14:22Z</span> <span className="text-cyan-300">employee.updated</span> <span className="text-slate-500">fields=[jobTitle]</span></p>
              <p><span className="text-slate-600">02:15:01Z</span> <span className="text-amber-300">leave.approved</span> <span className="text-slate-500">days=5 policy=annual</span></p>
              <p><span className="text-slate-600">02:15:38Z</span> <span className="text-red-400">cross-tenant read</span> <span className="text-slate-500">→ DENIED 404</span></p>
              <p><span className="text-slate-600">02:16:10Z</span> <span className="text-cyan-300">attendance.clock_in</span> <span className="text-slate-500">utc server-ts</span></p>
              <p><span className="text-slate-600">02:16:44Z</span> <span className="text-cyan-300">member.invited</span> <span className="text-slate-500">role=HR_MANAGER</span></p>
              <p><span className="text-slate-600">02:17:03Z</span> <span className="text-emerald-300">onboarding.approved</span> <span className="text-slate-500">terms=accepted</span></p>
            </div>
          </div>
        </section>

        {/* stack strip */}
        <section className="border-t border-white/5">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-10 gap-y-3 px-6 py-8">
            {STACK.map((s) => (
              <span key={s} className="font-mono text-[10px] tracking-[0.3em] text-slate-600">
                {s}
              </span>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="border-t border-white/5">
          <div className="mx-auto max-w-6xl px-6 py-24 text-center">
            <p className="font-mono text-[11px] tracking-[0.35em] text-slate-500">/ 03 — DEPLOY</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-5xl">
              Stand up your workforce command center.
            </h2>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/register"
                className="bg-cyan-400 px-8 py-3 font-mono text-xs tracking-[0.2em] text-black transition hover:bg-cyan-300"
              >
                CREATE WORKSPACE →
              </Link>
              <a
                href="/api/auth/google"
                className="flex items-center gap-2.5 border border-white/20 px-8 py-3 font-mono text-xs tracking-[0.15em] text-white transition hover:border-white/50 hover:bg-white/5"
              >
                <GoogleIcon />
                SIGN IN WITH GOOGLE
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 font-mono text-[10px] tracking-[0.25em] text-slate-600 sm:flex-row">
          <span>KHR // PEOPLEFLOW HR — © {new Date().getFullYear()}</span>
          <div className="flex gap-8">
            <Link href="/login" className="hover:text-cyan-300">CONSOLE</Link>
            <a href="/docs" className="hover:text-cyan-300">API</a>
            <a href="#security" className="hover:text-cyan-300">SECURITY</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
