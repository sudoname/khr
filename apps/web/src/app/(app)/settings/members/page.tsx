'use client';

import { useCallback, useEffect, useState } from 'react';
import { COMPANY_ROLES } from '@peopleflow/types';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table } from '@/components/ui';

interface Member {
  id: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    emailVerifiedAt: string | null;
    mfaEnabled: boolean;
  };
  employee: { id: string; employeeNo: string; jobTitle: string } | null;
}

export default function MembersSettingsPage() {
  const { me } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [invite, setInvite] = useState({ email: '', firstName: '', lastName: '', role: 'EMPLOYEE' });
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers(await api.get<Member[]>('/members'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setModalError('');
    setBusy(true);
    try {
      await api.post('/members/invite', invite);
      setShowInvite(false);
      setInvite({ email: '', firstName: '', lastName: '', role: 'EMPLOYEE' });
      setNotice('Invitation sent.');
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(memberId: string, role: string) {
    setError('');
    setNotice('');
    try {
      await api.patch(`/members/${memberId}/role`, { role });
      setNotice('Role updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role change failed');
      await load();
    }
  }

  async function removeMember(member: Member) {
    if (!window.confirm(`Remove ${member.user.firstName} ${member.user.lastName} from this company?`)) return;
    setError('');
    try {
      await api.delete(`/members/${member.id}`);
      setNotice('Member removed.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Removal failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <Button onClick={() => { setModalError(''); setShowInvite(true); }}>Invite member</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        {members === null ? (
          <Spinner />
        ) : members.length === 0 ? (
          <Empty>No members yet.</Empty>
        ) : (
          <Table headers={['Member', 'Role', 'Status', 'MFA', '']}>
            {members.map((m) => {
              const isSelf = m.user.id === me?.user.id;
              return (
                <tr key={m.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {m.user.firstName} {m.user.lastName} {isSelf && <Badge tone="blue">You</Badge>}
                    </div>
                    <div className="text-xs text-slate-400">
                      {m.user.email}
                      {m.employee ? ` · ${m.employee.employeeNo}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {isSelf ? (
                      <Badge>{m.role}</Badge>
                    ) : (
                      <Select
                        value={m.role}
                        onChange={(e) => void changeRole(m.id, e.target.value)}
                        className="w-auto"
                      >
                        {COMPANY_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {m.user.emailVerifiedAt ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Pending</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    {m.user.mfaEnabled ? <Badge tone="green">Enabled</Badge> : <Badge tone="slate">Off</Badge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!isSelf && (
                      <Button variant="ghost" onClick={() => void removeMember(m)}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {showInvite && (
        <Modal title="Invite member" onClose={() => setShowInvite(false)}>
          <form onSubmit={sendInvite} className="space-y-3">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <Input
                  value={invite.firstName}
                  onChange={(e) => setInvite((f) => ({ ...f, firstName: e.target.value }))}
                  required
                  autoFocus
                />
              </Field>
              <Field label="Last name">
                <Input
                  value={invite.lastName}
                  onChange={(e) => setInvite((f) => ({ ...f, lastName: e.target.value }))}
                  required
                />
              </Field>
            </div>
            <Field label="Email">
              <Input
                type="email"
                value={invite.email}
                onChange={(e) => setInvite((f) => ({ ...f, email: e.target.value }))}
                required
              />
            </Field>
            <Field label="Role">
              <Select value={invite.role} onChange={(e) => setInvite((f) => ({ ...f, role: e.target.value }))}>
                {COMPANY_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-slate-400">
              Admin, HR and payroll roles must enable two-factor authentication before they can act.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setShowInvite(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Sending…' : 'Send invitation'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
