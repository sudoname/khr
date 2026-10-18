import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 p-6 text-slate-700">
      <div className="hud-grid pointer-events-none absolute inset-0" />
      <div className="hud-glow pointer-events-none absolute inset-x-0 top-0 h-[60vh]" />
      <div className="hud-scanline pointer-events-none absolute inset-x-0 top-0 h-40" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center border border-cyan-500/70 font-mono text-sm font-bold text-cyan-600">
              K
            </span>
            <span className="font-mono text-base tracking-[0.3em] text-slate-900">KHR</span>
          </Link>
          <p className="font-mono text-[10px] tracking-[0.25em] text-slate-400">PEOPLEFLOW HR SYSTEMS</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-700 shadow-sm">
          {children}
        </div>
        <p className="mt-4 text-center font-mono text-[10px] tracking-[0.25em] text-slate-400">
          SECURE CHANNEL // TLS
        </p>
      </div>
    </div>
  );
}
