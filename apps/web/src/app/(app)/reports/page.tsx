'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, Empty, Field, Input, Spinner, Table } from '@/components/ui';

interface Headcount {
  total: number;
  byStatus: { status: string; count: number }[];
  byEmploymentType: { employmentType: string; count: number }[];
  byDepartment: { name: string; count: number }[];
  trend: { month: string; hires: number; exits: number }[];
}

interface LeaveReport {
  year: number;
  pendingRequests: number;
  byType: { name: string; code: string; entitled: number; used: number; available: number; employees: number }[];
}

interface AttendanceReport {
  from: string;
  to: string;
  totalRecords: number;
  lateTotal: number;
  byEmployee: { employeeNo: string; name: string; daysPresent: number; lateDays: number }[];
}

interface PayrollReport {
  year: number;
  runs: {
    id: string;
    month: number;
    status: string;
    employees: number;
    totalGross: string;
    totalPaye: string;
    totalNet: string;
  }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const naira = (v: string) => `₦${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const year = new Date().getUTCFullYear();
  const [headcount, setHeadcount] = useState<Headcount | null>(null);
  const [leave, setLeave] = useState<LeaveReport | null>(null);
  const [payroll, setPayroll] = useState<PayrollReport | null>(null);
  const [attendance, setAttendance] = useState<AttendanceReport | null>(null);
  const [range, setRange] = useState(() => {
    const now = new Date();
    return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: iso(now) };
  });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [h, l, p] = await Promise.all([
        api.get<Headcount>('/reports/headcount'),
        api.get<LeaveReport>(`/reports/leave?year=${year}`),
        api.get<PayrollReport>(`/reports/payroll?year=${year}`),
      ]);
      setHeadcount(h);
      setLeave(l);
      setPayroll(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadAttendance() {
    setError('');
    try {
      setAttendance(await api.get<AttendanceReport>(`/reports/attendance?from=${range.from}&to=${range.to}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attendance report');
    }
  }

  if (!headcount || !leave || !payroll) {
    return error ? <Alert kind="error">{error}</Alert> : <Spinner />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <Card
        title={`Headcount (${headcount.total} employees)`}
        actions={
          <a className="text-sm font-medium text-cyan-600 hover:underline" href="/api/reports/headcount.csv">
            Export CSV
          </a>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">By status</div>
            <ul className="space-y-1 text-sm">
              {headcount.byStatus.map((s) => (
                <li key={s.status} className="flex justify-between">
                  <span>{s.status.replace('_', ' ')}</span>
                  <span className="font-medium">{s.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">By type</div>
            <ul className="space-y-1 text-sm">
              {headcount.byEmploymentType.map((t) => (
                <li key={t.employmentType} className="flex justify-between">
                  <span>{t.employmentType.replace('_', ' ')}</span>
                  <span className="font-medium">{t.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">By department</div>
            <ul className="space-y-1 text-sm">
              {headcount.byDepartment.slice(0, 8).map((d) => (
                <li key={d.name} className="flex justify-between">
                  <span>{d.name}</span>
                  <span className="font-medium">{d.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-slate-400">Hires / exits (12 months)</div>
          <Table headers={['Month', 'Hires', 'Exits']}>
            {headcount.trend.map((t) => (
              <tr key={t.month}>
                <td className="px-3 py-1.5">{t.month}</td>
                <td className="px-3 py-1.5">{t.hires}</td>
                <td className="px-3 py-1.5">{t.exits}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>

      <Card
        title={`Leave (${leave.year}) — ${leave.pendingRequests} pending request${leave.pendingRequests === 1 ? '' : 's'}`}
        actions={
          <a className="text-sm font-medium text-cyan-600 hover:underline" href={`/api/reports/leave.csv?year=${leave.year}`}>
            Export CSV
          </a>
        }
      >
        {leave.byType.length === 0 ? (
          <Empty>No leave balances for {leave.year}.</Empty>
        ) : (
          <Table headers={['Leave type', 'Employees', 'Entitled', 'Used', 'Available']}>
            {leave.byType.map((t) => (
              <tr key={t.code}>
                <td className="px-3 py-2 font-medium text-slate-800">
                  {t.name} <span className="text-xs text-slate-400">({t.code})</span>
                </td>
                <td className="px-3 py-2">{t.employees}</td>
                <td className="px-3 py-2">{t.entitled.toFixed(1)}</td>
                <td className="px-3 py-2">{t.used.toFixed(1)}</td>
                <td className="px-3 py-2">{t.available.toFixed(1)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card
        title="Attendance"
        actions={
          attendance && (
            <a
              className="text-sm font-medium text-cyan-600 hover:underline"
              href={`/api/reports/attendance.csv?from=${range.from}&to=${range.to}`}
            >
              Export CSV
            </a>
          )
        }
      >
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <Field label="From">
            <Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </Field>
          <Field label="To">
            <Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </Field>
          <Button variant="secondary" onClick={() => void loadAttendance()}>
            Run report
          </Button>
        </div>
        {attendance &&
          (attendance.byEmployee.length === 0 ? (
            <Empty>No attendance records in this range.</Empty>
          ) : (
            <>
              <p className="mb-2 text-sm text-slate-500">
                {attendance.totalRecords} records · {attendance.lateTotal} late
              </p>
              <Table headers={['Employee No', 'Name', 'Days present', 'Late days']}>
                {attendance.byEmployee.map((e) => (
                  <tr key={e.employeeNo}>
                    <td className="px-3 py-2 font-mono text-xs">{e.employeeNo}</td>
                    <td className="px-3 py-2">{e.name}</td>
                    <td className="px-3 py-2">{e.daysPresent}</td>
                    <td className="px-3 py-2">{e.lateDays}</td>
                  </tr>
                ))}
              </Table>
            </>
          ))}
      </Card>

      <Card
        title={`Payroll (${payroll.year})`}
        actions={
          <a className="text-sm font-medium text-cyan-600 hover:underline" href={`/api/reports/payroll.csv?year=${payroll.year}`}>
            Export CSV
          </a>
        }
      >
        {payroll.runs.length === 0 ? (
          <Empty>No payroll runs for {payroll.year}.</Empty>
        ) : (
          <Table headers={['Month', 'Status', 'Employees', 'Gross', 'PAYE', 'Net']}>
            {payroll.runs.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{MONTHS[r.month - 1]}</td>
                <td className="px-3 py-2">
                  <Badge tone={r.status === 'PAID' || r.status === 'APPROVED' ? 'green' : 'slate'}>{r.status}</Badge>
                </td>
                <td className="px-3 py-2">{r.employees}</td>
                <td className="px-3 py-2">{naira(r.totalGross)}</td>
                <td className="px-3 py-2">{naira(r.totalPaye)}</td>
                <td className="px-3 py-2 font-medium">{naira(r.totalNet)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
