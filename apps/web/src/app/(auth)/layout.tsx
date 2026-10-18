import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05070a] p-6 text-slate-300">
      <div className="hud-grid pointer-events-none absolute inset-0" />
      <div className="hud-glow pointer-events-none absolute inset-x-0 top-0 h-[60vh]" />
      <div className="hud-scanline pointer-events-none absolute inset-x-0 top-0 h-40" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center border border-cyan-400/60 font-mono text-sm font-bold text-cyan-300">
              K
            </span>
            <span className="font-mono text-base tracking-[0.3em] text-white">KHR</span>
          </Link>
          <p className="font-mono text-[10px] tracking-[0.25em] text-slate-500">PEOPLEFLOW HR SYSTEMS</p>
        </div>
        <div className="border border-white/10 bg-white/[0.03] p-6 text-slate-200 shadow-2xl shadow-cyan-500/5 backdrop-blur">
          {children}
        </div>
        <p className="mt-4 text-center font-mono text-[10px] tracking-[0.25em] text-slate-600">
          SECURE CHANNEL // TLS
        </p>
      </div>
    </div>
  );
}
