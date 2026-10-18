'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Badge, Card, Empty, Spinner } from '@/components/ui';

interface Balance {
  leaveTypeId: string;
  year: number;
  availableDays: number;
  leaveType: { id: string; name: string; code: string };
}

interface TodayAttendance {
  day: string;
  record: { clockInAt: string; clockOutAt: string | null; late: boolean } | null;
}

interface StatsOverview {
  headcount: { total: number; active: number; onLeave: number; suspended: number; terminated: number } | null;
  byDepartment: { name: string; count: number }[] | null;
  byStatus: { status: string; count: number }[] | null;
  attendanceToday: { clockedIn: number; late: number } | null;
  pendingLeave: number | null;
  pendingCorrections: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  SUSPENDED: 'Suspended',
  TERMINATED: 'Terminated',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#06b6d4',
  ON_LEAVE: '#f59e0b',
  SUSPENDED: '#94a3b8',
  TERMINATED: '#ef4444',
};

function Tile({
  caption,
  value,
  hint,
  href,
  accent = false,
}: {
  caption: string;
  value: React.ReactNode;
  hint?: string;
  href?: string;
  accent?: boolean;
}) {
  const body = (
    <div className="h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-cyan-500/50">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 ${accent ? 'bg-cyan-500' : 'bg-slate-300'}`} />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">{caption}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function DashboardPage() {
  const { me, can } = useSession();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [today, setToday] = useState<TodayAttendance | null>(null);
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [logoOk, setLogoOk] = useState(true);

  const isEmployee = !!me?.employee;

  useEffect(() => {
    api.get<StatsOverview>('/stats/overview').then(setStats).catch(() => null);
    if (isEmployee && can('leave.request.self')) {
      api.get<Balance[]>('/leave/balances/me').then(setBalances).catch(() => setBalances([]));
    }
    if (isEmployee && can('attendance.clock.self')) {
      api.get<TodayAttendance>('/attendance/today').then(setToday).catch(() => null);
    }
  }, [isEmployee, can]);

  const companyName = me?.companies.find((c) => c.id === me.activeCompanyId)?.name ?? me?.companies[0]?.name;

  const deptData = stats?.byDepartment ?? [];
  const statusData = (stats?.byStatus ?? [])
    .filter((s) => s.count > 0)
    .map((s) => ({ ...s, label: STATUS_LABELS[s.status] ?? s.status }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Welcome back, {me?.user.firstName}</h1>
          <p className="text-sm text-slate-500">
            {me?.employee
              ? `${me.employee.jobTitle} · ${me.employee.employeeNo}`
              : 'No employee profile in this company'}
          </p>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          {logoOk && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/api/company/logo"
              alt=""
              className="h-10 w-10 rounded-lg border border-slate-200 bg-white object-contain"
              onError={() => setLogoOk(false)}
            />
          )}
          <div className="text-right">
            <div className="text-sm font-medium text-slate-700">{companyName}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">Workspace</div>
          </div>
        </div>
      </div>

      {/* stat tiles */}
      {stats && (stats.headcount || stats.pendingLeave !== null || stats.pendingCorrections !== null) && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {stats.headcount && (
            <>
              <Tile caption="Employees" value={stats.headcount.total} hint="All records" href="/people" accent />
              <Tile caption="Active" value={stats.headcount.active} hint={`${stats.headcount.onLeave} on leave`} href="/people" />
            </>
          )}
          {stats.attendanceToday && (
            <Tile
              caption="Clocked in today"
              value={stats.attendanceToday.clockedIn}
              hint={`${stats.attendanceToday.late} late`}
              href="/attendance"
            />
          )}
          {stats.pendingLeave !== null && (
            <Tile caption="Pending leave" value={stats.pendingLeave} hint="Awaiting review" href="/leave" accent={stats.pendingLeave > 0} />
          )}
          {stats.pendingCorrections !== null && (
            <Tile
              caption="Corrections"
              value={stats.pendingCorrections}
              hint="Awaiting review"
              href="/attendance"
              accent={stats.pendingCorrections > 0}
            />
          )}
        </div>
      )}

      {/* charts */}
      {stats?.byDepartment && stats.byStatus && (deptData.length > 0 || statusData.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <Card title="Headcount by department">
              {deptData.length === 0 ? (
                <Empty>No departments yet.</Empty>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={deptData} margin={{ top: 4, right: 8, bottom: 4, left: -24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        axisLine={{ stroke: '#cbd5e1' }}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{ fill: 'rgba(6, 182, 212, 0.06)' }} contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e8f0' }} />
                      <Bar dataKey="count" name="Employees" fill="#06b6d4" radius={[3, 3, 0, 0]} maxBarSize={48} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
          <div className="lg:col-span-2">
            <Card title="Employees by status">
              {statusData.length === 0 ? (
                <Empty>No employees yet.</Empty>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="count"
                        nameKey="label"
                        innerRadius="55%"
                        outerRadius="80%"
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {statusData.map((s) => (
                          <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? '#0891b2'} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: '#e2e8f0' }} />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* personal cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isEmployee && can('attendance.clock.self') && (
          <Card title="Today">
            {today === null ? (
              <Spinner />
            ) : today.record ? (
              <div className="space-y-1 text-sm">
                <div>
                  Clocked in at <strong>{new Date(today.record.clockInAt).toLocaleTimeString()}</strong>{' '}
                  {today.record.late && <Badge tone="amber">Late</Badge>}
                </div>
                <div>
                  {today.record.clockOutAt
                    ? `Clocked out at ${new Date(today.record.clockOutAt).toLocaleTimeString()}`
                    : 'Not clocked out yet'}
                </div>
                <Link href="/attendance" className="text-xs text-brand-600 hover:underline">
                  Go to attendance →
                </Link>
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <p className="text-slate-500">You haven&apos;t clocked in today.</p>
                <Link href="/attendance" className="text-xs text-brand-600 hover:underline">
                  Clock in →
                </Link>
              </div>
            )}
          </Card>
        )}

        {isEmployee && can('leave.request.self') && (
          <Card title="Leave balances">
            {balances === null ? (
              <Spinner />
            ) : balances.length === 0 ? (
              <Empty>No leave balances yet.</Empty>
            ) : (
              <ul className="space-y-1 text-sm">
                {balances.map((b) => (
                  <li key={b.leaveTypeId} className="flex justify-between">
                    <span>{b.leaveType.name}</span>
                    <span className="font-medium">{b.availableDays} days left</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
