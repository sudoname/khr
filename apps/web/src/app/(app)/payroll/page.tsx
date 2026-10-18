'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Spinner, Table } from '@/components/ui';
import { MONTHS, formatNgn, runStatusTone } from './format';

interface PayrollRunRow {
  id: string;
  year: number;
  month: number;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PAID';
  note: string | null;
  totalGross: string;
  totalNet: string;
  totalPaye: string;
  paidAt: string | null;
}

interface MyPayslip {
  id: string;
  grossMonthly: string;
  paye: string;
  pensionEmployee: string;
  nhf: string;
  netPay: string;
  run: { year: number; month: number; paidAt: string | null };
}

interface Settings {
  basicPercent: string | number;
  housingPercent: string | number;
  transportPercent: string | number;
  pensionEnabled: boolean;
  pensionEmployeePercent: string | number;
  pensionEmployerPercent: string | number;
  nhfEnabled: boolean;
  nhfPercent: string | number;
}

export default function PayrollPage() {
  const { can } = useSession();
  const manage = can('payroll.manage');

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // self-service payslips
  const [payslips, setPayslips] = useState<MyPayslip[] | null>(null);

  // runs (managers)
  const [runs, setRuns] = useState<PayrollRunRow[] | null>(null);
  const now = new Date();
  const [newRun, setNewRun] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [creating, setCreating] = useState(false);

  // settings
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [slips, runList, cfg] = await Promise.all([
        api.get<MyPayslip[]>('/payroll/payslips/me'),
        manage ? api.get<PayrollRunRow[]>('/payroll/runs') : Promise.resolve(null),
        manage ? api.get<Settings>('/payroll/settings') : Promise.resolve(null),
      ]);
      setPayslips(slips);
      if (runList) setRuns(runList);
      if (cfg) setSettings(cfg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payroll data');
      setPayslips((p) => p ?? []);
    }
  }, [manage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRun(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setCreating(true);
    try {
      const run = await api.post<PayrollRunRow & { skipped: unknown[] }>('/payroll/runs', newRun);
      setNotice(
        `Draft run for ${MONTHS[newRun.month - 1]} ${newRun.year} created${
          run.skipped.length ? ` — ${run.skipped.length} employee(s) skipped (no compensation record)` : ''
        }.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create run');
    } finally {
      setCreating(false);
    }
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setError('');
    setSettingsBusy(true);
    try {
      const saved = await api.put<Settings>('/payroll/settings', {
        basicPercent: Number(settings.basicPercent),
        housingPercent: Number(settings.housingPercent),
        transportPercent: Number(settings.transportPercent),
        pensionEnabled: settings.pensionEnabled,
        pensionEmployeePercent: Number(settings.pensionEmployeePercent),
        pensionEmployerPercent: Number(settings.pensionEmployerPercent),
        nhfEnabled: settings.nhfEnabled,
        nhfPercent: Number(settings.nhfPercent),
      });
      setSettings(saved);
      setShowSettings(false);
      setNotice('Payroll settings saved. Recompute draft runs to apply them.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setSettingsBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Payroll</h1>
          <p className="text-sm text-slate-500">
            {manage ? 'Monthly runs, PAYE and statutory deductions.' : 'Your payslips.'}
          </p>
        </div>
        {manage && settings && (
          <Button variant="secondary" onClick={() => setShowSettings(true)}>
            Settings
          </Button>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {manage && (
        <Card
          title="Payroll runs"
          actions={
            <form onSubmit={createRun} className="flex items-end gap-2">
              <select
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={newRun.month}
                onChange={(e) => setNewRun((r) => ({ ...r, month: Number(e.target.value) }))}
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min={2000}
                max={2100}
                value={newRun.year}
                onChange={(e) => setNewRun((r) => ({ ...r, year: Number(e.target.value) }))}
                className="w-24"
              />
              <Button type="submit" disabled={creating}>
                {creating ? 'Computing…' : 'New run'}
              </Button>
            </form>
          }
        >
          {runs === null ? (
            <Spinner />
          ) : runs.length === 0 ? (
            <Empty>No payroll runs yet — create your first run for this month.</Empty>
          ) : (
            <Table headers={['Period', 'Status', 'Gross', 'PAYE', 'Net', '']}>
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium">
                    {MONTHS[run.month - 1]} {run.year}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={runStatusTone(run.status)}>{run.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-3 py-2">{formatNgn(run.totalGross)}</td>
                  <td className="px-3 py-2">{formatNgn(run.totalPaye)}</td>
                  <td className="px-3 py-2 font-medium">{formatNgn(run.totalNet)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/payroll/${run.id}`} className="text-sm font-medium text-brand-600 hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      <Card title="My payslips">
        {payslips === null ? (
          <Spinner />
        ) : payslips.length === 0 ? (
          <Empty>No payslips yet. They appear here once a payroll run is marked as paid.</Empty>
        ) : (
          <Table headers={['Period', 'Gross', 'PAYE', 'Pension', 'NHF', 'Net pay']}>
            {payslips.map((slip) => (
              <tr key={slip.id}>
                <td className="px-3 py-2 font-medium">
                  {MONTHS[slip.run.month - 1]} {slip.run.year}
                </td>
                <td className="px-3 py-2">{formatNgn(slip.grossMonthly)}</td>
                <td className="px-3 py-2">{formatNgn(slip.paye)}</td>
                <td className="px-3 py-2">{formatNgn(slip.pensionEmployee)}</td>
                <td className="px-3 py-2">{formatNgn(slip.nhf)}</td>
                <td className="px-3 py-2 font-semibold">{formatNgn(slip.netPay)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {showSettings && settings && (
        <Modal title="Payroll settings" onClose={() => setShowSettings(false)}>
          <form onSubmit={saveSettings} className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-medium text-slate-500">Salary split (% of gross)</div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Basic %">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={settings.basicPercent}
                    onChange={(e) => setSettings((s) => s && { ...s, basicPercent: e.target.value })}
                  />
                </Field>
                <Field label="Housing %">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={settings.housingPercent}
                    onChange={(e) => setSettings((s) => s && { ...s, housingPercent: e.target.value })}
                  />
                </Field>
                <Field label="Transport %">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={settings.transportPercent}
                    onChange={(e) => setSettings((s) => s && { ...s, transportPercent: e.target.value })}
                  />
                </Field>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.pensionEnabled}
                  onChange={(e) => setSettings((s) => s && { ...s, pensionEnabled: e.target.checked })}
                />
                Pension (PenCom) enabled
              </label>
              {settings.pensionEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Employee % (of BHT)">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={settings.pensionEmployeePercent}
                      onChange={(e) => setSettings((s) => s && { ...s, pensionEmployeePercent: e.target.value })}
                    />
                  </Field>
                  <Field label="Employer % (of BHT)">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={settings.pensionEmployerPercent}
                      onChange={(e) => setSettings((s) => s && { ...s, pensionEmployerPercent: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.nhfEnabled}
                  onChange={(e) => setSettings((s) => s && { ...s, nhfEnabled: e.target.checked })}
                />
                NHF (National Housing Fund) enabled
              </label>
              {settings.nhfEnabled && (
                <Field label="NHF % (of basic)">
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={settings.nhfPercent}
                    onChange={(e) => setSettings((s) => s && { ...s, nhfPercent: e.target.value })}
                  />
                </Field>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setShowSettings(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={settingsBusy}>
                {settingsBusy ? 'Saving…' : 'Save settings'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
