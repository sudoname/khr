'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Button, Card, Empty, Field, Input, Modal, Spinner, Table } from '@/components/ui';

interface PendingRow {
  id: string;
  employeeNo: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  workEmail: string;
  personalEmail: string | null;
  jobTitle: string;
  department: { id: string; name: string } | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  country: string;
  submittedAt: string | null;
  emergencyContact: { name: string; relationship: string | null; phone: string; email: string | null } | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bvn: string | null;
}

export default function OnboardingApprovalsPage() {
  const { can } = useSession();
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<PendingRow | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<PendingRow[]>('/onboarding/pending')
      .then(setRows)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load submissions'));
  }, []);

  useEffect(() => {
    if (can('employee.write')) load();
  }, [can, load]);

  if (!can('employee.write')) {
    return <Alert kind="error">You do not have permission to review onboarding submissions.</Alert>;
  }

  async function review(employeeId: string, decision: 'APPROVED' | 'REJECTED') {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.post<{ message: string }>(`/onboarding/${employeeId}/review`, { decision, note });
      setNotice(`Profile ${decision.toLowerCase()}.`);
      setSelected(null);
      setNote('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Onboarding approvals</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title="Pending submissions">
        {!rows ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No profiles are awaiting review.</Empty>
        ) : (
          <Table headers={['Employee', 'Job title', 'Department', 'Submitted', '']}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {r.firstName} {r.lastName}
                  </div>
                  <div className="text-xs text-slate-400">
                    {r.employeeNo} · {r.workEmail}
                  </div>
                </td>
                <td className="px-3 py-2">{r.jobTitle}</td>
                <td className="px-3 py-2">{r.department?.name ?? '—'}</td>
                <td className="px-3 py-2">{r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—'}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="secondary" onClick={() => { setSelected(r); setNote(''); }}>
                    Review
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selected && (
        <Modal title={`Review — ${selected.firstName} ${selected.lastName}`} onClose={() => setSelected(null)}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-slate-400">Employee no</dt>
              <dd>{selected.employeeNo}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Gender</dt>
              <dd>{selected.gender === 'MALE' ? 'Male' : selected.gender === 'FEMALE' ? 'Female' : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Date of birth</dt>
              <dd>{selected.dateOfBirth ? new Date(selected.dateOfBirth).toLocaleDateString() : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Phone</dt>
              <dd>{selected.phone ?? '—'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-slate-400">Address</dt>
              <dd>
                {[selected.addressLine1, selected.city, selected.state, selected.country].filter(Boolean).join(', ') ||
                  '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Personal email</dt>
              <dd>{selected.personalEmail ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Emergency contact</dt>
              <dd>
                {selected.emergencyContact
                  ? `${selected.emergencyContact.name} (${selected.emergencyContact.relationship || 'contact'}) · ${selected.emergencyContact.phone}`
                  : '—'}
              </dd>
            </div>
            {(selected.bankName || selected.bankAccountNumber || selected.bvn) && (
              <>
                <div>
                  <dt className="text-xs text-slate-400">Bank</dt>
                  <dd>{selected.bankName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Account / BVN</dt>
                  <dd>
                    {selected.bankAccountNumber ?? '—'} {selected.bvn ? `· BVN ${selected.bvn}` : ''}
                  </dd>
                </div>
              </>
            )}
          </dl>

          <div className="mt-4 space-y-3">
            <Field label="Note (required when rejecting, optional otherwise)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. account number does not match bank" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="danger" disabled={busy || !note.trim()} onClick={() => void review(selected.id, 'REJECTED')}>
                Reject
              </Button>
              <Button disabled={busy} onClick={() => void review(selected.id, 'APPROVED')}>
                Approve
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
