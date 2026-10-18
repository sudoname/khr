'use client';

import { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Field, Input, Spinner } from '@/components/ui';

interface SessionRow {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export default function AccountPage() {
  const { me, refresh, mfaRequiredButMissing } = useSession();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // change password
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);

  // MFA
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableForm, setDisableForm] = useState({ code: '', password: '' });
  const [mfaBusy, setMfaBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await api.get<SessionRow[]>('/auth/sessions'));
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (pwForm.newPassword !== pwForm.confirm) {
      setError('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
      setNotice('Password changed. Other sessions have been signed out.');
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setPwBusy(false);
    }
  }

  async function startMfaSetup() {
    setError('');
    setNotice('');
    setMfaBusy(true);
    try {
      setSetup(await api.post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', {}));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA setup failed');
    } finally {
      setMfaBusy(false);
    }
  }

  async function enableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMfaBusy(true);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code: mfaCode });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setMfaCode('');
      setNotice('Two-factor authentication enabled.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable MFA');
    } finally {
      setMfaBusy(false);
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setMfaBusy(true);
    try {
      await api.post('/auth/mfa/disable', disableForm);
      setDisableForm({ code: '', password: '' });
      setNotice('Two-factor authentication disabled.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable MFA');
    } finally {
      setMfaBusy(false);
    }
  }

  async function revokeSession(id: string) {
    setError('');
    try {
      await api.delete(`/auth/sessions/${id}`);
      await loadSessions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

  if (!me) return <Spinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Account</h1>
        <p className="text-sm text-slate-500">{me.user.email}</p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Two-factor authentication">
          {me.user.mfaEnabled ? (
            <div className="space-y-3">
              <p className="text-sm">
                <Badge tone="green">Enabled</Badge> Your account is protected with an authenticator app.
              </p>
              <form onSubmit={disableMfa} className="space-y-3 border-t border-slate-100 pt-3">
                <div className="text-xs font-medium text-slate-500">Disable MFA</div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Authenticator code">
                    <Input
                      value={disableForm.code}
                      onChange={(e) => setDisableForm((f) => ({ ...f, code: e.target.value }))}
                      required
                    />
                  </Field>
                  <Field label="Password">
                    <Input
                      type="password"
                      value={disableForm.password}
                      onChange={(e) => setDisableForm((f) => ({ ...f, password: e.target.value }))}
                      required
                    />
                  </Field>
                </div>
                <Button type="submit" variant="danger" disabled={mfaBusy}>
                  Disable MFA
                </Button>
              </form>
            </div>
          ) : recoveryCodes ? (
            <div className="space-y-3">
              <Alert kind="success">MFA is now enabled. Save these recovery codes somewhere safe — they are shown only once.</Alert>
              <pre className="rounded-lg bg-slate-900 p-3 font-mono text-xs text-slate-100">
                {recoveryCodes.join('\n')}
              </pre>
              <Button variant="secondary" onClick={() => setRecoveryCodes(null)}>
                I&apos;ve saved them
              </Button>
            </div>
          ) : setup ? (
            <form onSubmit={enableMfa} className="space-y-3">
              <p className="text-sm text-slate-600">
                Scan this QR code with your authenticator app (Google Authenticator, 1Password, Authy…), then enter
                the 6-digit code to confirm.
              </p>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-white p-3">
                  <QRCodeSVG value={setup.otpauthUrl} size={176} marginSize={1} />
                </div>
                <div className="min-w-0 rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Can&apos;t scan? Enter this secret manually</div>
                  <code className="break-all text-sm font-semibold">{setup.secret}</code>
                </div>
              </div>
              <Field label="Code from your app">
                <Input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} required placeholder="123456" autoFocus />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={mfaBusy}>
                  {mfaBusy ? 'Verifying…' : 'Confirm & enable'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setSetup(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              {mfaRequiredButMissing && (
                <Alert kind="info">Your role requires MFA — enable it to unlock all actions.</Alert>
              )}
              <p className="text-sm text-slate-600">
                Protect your account with a time-based one-time password (TOTP) app.
              </p>
              <Button onClick={() => void startMfaSetup()} disabled={mfaBusy}>
                {mfaBusy ? 'Preparing…' : 'Set up MFA'}
              </Button>
            </div>
          )}
        </Card>

        <Card title="Change password">
          <form onSubmit={changePassword} className="space-y-3">
            <Field label="Current password">
              <Input
                type="password"
                value={pwForm.currentPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, currentPassword: e.target.value }))}
                required
              />
            </Field>
            <Field label="New password (min 12 characters)">
              <Input
                type="password"
                value={pwForm.newPassword}
                onChange={(e) => setPwForm((f) => ({ ...f, newPassword: e.target.value }))}
                required
                minLength={12}
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                value={pwForm.confirm}
                onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                required
                minLength={12}
              />
            </Field>
            <Button type="submit" disabled={pwBusy}>
              {pwBusy ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </Card>
      </div>

      <Card title="Active sessions">
        {sessions === null ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-medium">
                    {s.ip ?? 'Unknown IP'} {s.current && <Badge tone="green">This device</Badge>}
                  </div>
                  <div className="max-w-md truncate text-xs text-slate-400">{s.userAgent ?? 'Unknown device'}</div>
                  <div className="text-xs text-slate-400">
                    Signed in {new Date(s.createdAt).toLocaleString()} · expires{' '}
                    {new Date(s.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                {!s.current && (
                  <Button variant="ghost" onClick={() => void revokeSession(s.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
