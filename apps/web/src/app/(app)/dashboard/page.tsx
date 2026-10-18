'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

export default function DashboardPage() {
  const { me, can } = useSession();
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [today, setToday] = useState<TodayAttendance | null>(null);
  const [pendingLeave, setPendingLeave] = useState<number | null>(null);
  const [pendingCorrections, setPendingCorrections] = useState<number | null>(null);

  const isEmployee = !!me?.employee;

  useEffect(() => {
    if (isEmployee && can('leave.request.self')) {
      api.get<Balance[]>('/leave/balances/me').then(setBalances).catch(() => setBalances([]));
    }
    if (isEmployee && can('attendance.clock.self')) {
      api.get<TodayAttendance>('/attendance/today').then(setToday).catch(() => null);
    }
    if (can('leave.approve')) {
      api
        .get<unknown[]>('/leave/requests/pending')
        .then((r) => setPendingLeave(r.length))
        .catch(() => setPendingLeave(0));
    }
    if (can('attendance.correct.review')) {
      api
        .get<unknown[]>('/attendance/corrections/pending')
        .then((r) => setPendingCorrections(r.length))
        .catch(() => setPendingCorrections(0));
    }
  }, [isEmployee, can]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome back, {me?.user.firstName}</h1>
        <p className="text-sm text-slate-500">
          {me?.employee ? `${me.employee.jobTitle} · ${me.employee.employeeNo}` : 'No employee profile in this company'}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isEmployee && can('attendance.clock.self') && (
          <Card title="Today">
            {today === null ? (
              <Spinner />
            ) : today.record ? (
              <div className="space-y-1 text-sm">
                <div>
                  Clocked in at{' '}
                  <strong>{new Date(today.record.clockInAt).toLocaleTimeString()}</strong>{' '}
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

        {can('leave.approve') && (
          <Card title="Approvals waiting">
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-2xl font-semibold">{pendingLeave ?? '…'}</span> leave request
                {pendingLeave === 1 ? '' : 's'} pending your review.
              </p>
              <Link href="/leave" className="text-xs text-brand-600 hover:underline">
                Review requests →
              </Link>
            </div>
          </Card>
        )}

        {can('attendance.correct.review') && (
          <Card title="Attendance corrections">
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-2xl font-semibold">{pendingCorrections ?? '…'}</span> correction
                {pendingCorrections === 1 ? '' : 's'} pending review.
              </p>
              <Link href="/attendance" className="text-xs text-brand-600 hover:underline">
                Review corrections →
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
