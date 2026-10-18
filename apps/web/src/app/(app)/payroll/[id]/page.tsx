'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Modal, Spinner, Table } from '@/components/ui';
import { MONTHS, formatNgn, runStatusTone } from '../format';

interface Payslip {
  id: string;
  employeeName: string;
  employeeNo: string;
  bankName: string | null;
  bankAccountNumber: string | null;
  grossMonthly: string;
  basic: string;
  housing: string;
  transport: string;
  pensionEmployee: string;
  pensionEmployer: string;
  nhf: string;
  nhis: string;
  rentRelief: string;
  paye: string;
  netPay: string;
}

interface RunDetail {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID';
  note: string | null;
  totalGross: string;
  totalPaye: string;
  totalPensionEmployee: string;
  totalPensionEmployer: string;
  totalNhf: string;
  totalNhis: string;
  totalRentRelief: string;
  totalNet: string;
  taxRegime: string | null;
  engineVersion: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  payslips: Payslip[];
}

export default function PayrollRunPage() {
  const params = useParams<{ id: string }>();
  const { can } = useSession();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    try {
      setRun(await api.get<RunDetail>(`/payroll/runs/${params.id}`));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load run');
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(path: string, body?: unknown) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.post(`/payroll/runs/${params.id}/${path}`, body ?? {});
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <Alert kind="error">{loadError}</Alert>;
  if (!run) return <Spinner />;

  const period = `${MONTHS[run.month - 1]} ${run.year}`;
  const manage = can('payroll.manage');
  const approvePerm = can('payroll.approve');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/payroll" className="text-xs text-slate-400 hover:text-slate-600">
            ← Payroll
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{period}</h1>
            <Badge tone={runStatusTone(run.status)}>{run.status.replace('_', ' ')}</Badge>
            {run.engineVersion && (
              <span className="font-mono text-xs text-slate-400" title="Tax engine version used for this run">
                {run.engineVersion}
              </span>
            )}
          </div>
          {run.note && run.status === 'DRAFT' && (
            <p className="text-sm text-amber-600">Returned with note: {run.note}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {manage && run.status === 'DRAFT' && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => void action('recompute')}>
                Recompute
              </Button>
              <Button disabled={busy || run.payslips.length === 0} onClick={() => void action('submit')}>
                Submit for approval
              </Button>
            </>
          )}
          {approvePerm && run.status === 'PENDING_APPROVAL' && (
            <>
              <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
                Reject
              </Button>
              <Button disabled={busy} onClick={() => void action('approve')}>
                Approve
              </Button>
            </>
          )}
          {approvePerm && run.status === 'APPROVED' && (
            <Button disabled={busy} onClick={() => void action('mark-paid')}>
              Mark as paid
            </Button>
          )}
          {manage && (run.status === 'APPROVED' || run.status === 'PAID') && (
            <a
              href={`/api/payroll/runs/${run.id}/bank-schedule`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Bank schedule (CSV)
            </a>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[
          ['Gross', run.totalGross],
          ['PAYE', run.totalPaye],
          ['Pension (employee)', run.totalPensionEmployee],
          ['Pension (employer)', run.totalPensionEmployer],
          ['NHF', run.totalNhf],
          ['NHIS', run.totalNhis],
          ['Rent relief', run.totalRentRelief],
          ['Net pay', run.totalNet],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 text-sm font-semibold">{formatNgn(value)}</div>
          </div>
        ))}
      </div>

      <Card title={`Payslips (${run.payslips.length})`}>
        {run.payslips.length === 0 ? (
          <Empty>
            No payslips in this run. Add compensation records for your employees, then recompute.
          </Empty>
        ) : (
          <Table headers={['Employee', 'Bank', 'Gross', 'PAYE', 'Pension', 'NHF', 'NHIS', 'Net pay']}>
            {run.payslips.map((slip) => (
              <tr key={slip.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">{slip.employeeName}</div>
                  <div className="text-xs text-slate-400">{slip.employeeNo}</div>
                </td>
                <td className="px-3 py-2">
                  {slip.bankName ? (
                    <>
                      <div>{slip.bankName}</div>
                      <div className="text-xs text-slate-400">{slip.bankAccountNumber}</div>
                    </>
                  ) : (
                    <span className="text-xs text-amber-600">No bank details</span>
                  )}
                </td>
                <td className="px-3 py-2">{formatNgn(slip.grossMonthly)}</td>
                <td className="px-3 py-2">{formatNgn(slip.paye)}</td>
                <td className="px-3 py-2">{formatNgn(slip.pensionEmployee)}</td>
                <td className="px-3 py-2">{formatNgn(slip.nhf)}</td>
                <td className="px-3 py-2">{formatNgn(slip.nhis)}</td>
                <td className="px-3 py-2 font-semibold">{formatNgn(slip.netPay)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {rejecting && (
        <Modal title="Reject payroll run" onClose={() => setRejecting(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRejecting(false);
              void action('reject', { note: rejectNote });
              setRejectNote('');
            }}
            className="space-y-3"
          >
            <p className="text-sm text-slate-600">
              The run returns to draft so the payroll officer can make corrections.
            </p>
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              rows={3}
              placeholder="What needs to change?"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              required
              minLength={3}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger">
                Reject run
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
