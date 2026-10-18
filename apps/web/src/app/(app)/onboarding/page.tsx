'use client';

import { useEffect, useState } from 'react';
import { GENDERS, NIGERIAN_BANKS, NIGERIAN_STATES } from '@peopleflow/types';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Field, Input, Select, Spinner, statusTone } from '@/components/ui';

interface OnboardingMe {
  status: 'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submittedAt: string | null;
  reviewedAt: string | null;
  note: string | null;
  termsAcceptedAt: string | null;
  terms: string;
  profile: {
    employeeNo: string;
    firstName: string;
    middleName: string | null;
    lastName: string;
    preferredName: string | null;
    workEmail: string;
    personalEmail: string | null;
    phone: string | null;
    dateOfBirth: string | null;
    gender: 'MALE' | 'FEMALE' | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    country: string;
    bankName: string | null;
    bankAccountNumber: string | null;
    bvn: string | null;
    emergencyContact: { name: string; relationship: string | null; phone: string; email: string | null } | null;
  };
}

const EMPTY_FORM = {
  middleName: '',
  preferredName: '',
  personalEmail: '',
  phone: '',
  dateOfBirth: '',
  gender: '' as '' | 'MALE' | 'FEMALE',
  addressLine1: '',
  city: '',
  state: '',
  country: 'NG',
  bankName: '',
  bankAccountNumber: '',
  bvn: '',
  ecName: '',
  ecRelationship: '',
  ecPhone: '',
  ecEmail: '',
};

export default function OnboardingPage() {
  const { refresh } = useSession();
  const [data, setData] = useState<OnboardingMe | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function hydrate(d: OnboardingMe) {
    setData(d);
    const p = d.profile;
    setForm({
      middleName: p.middleName ?? '',
      preferredName: p.preferredName ?? '',
      personalEmail: p.personalEmail ?? '',
      phone: p.phone ?? '',
      dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : '',
      gender: p.gender ?? '',
      addressLine1: p.addressLine1 ?? '',
      city: p.city ?? '',
      state: p.state ?? '',
      country: p.country || 'NG',
      bankName: p.bankName ?? '',
      bankAccountNumber: p.bankAccountNumber ?? '',
      bvn: p.bvn ?? '',
      ecName: p.emergencyContact?.name ?? '',
      ecRelationship: p.emergencyContact?.relationship ?? '',
      ecPhone: p.emergencyContact?.phone ?? '',
      ecEmail: p.emergencyContact?.email ?? '',
    });
  }

  useEffect(() => {
    api
      .get<OnboardingMe>('/onboarding/me')
      .then(hydrate)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load onboarding'));
  }, []);

  const set =
    (key: keyof typeof EMPTY_FORM) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const updated = await api.post<OnboardingMe>('/onboarding/submit', {
        middleName: form.middleName,
        preferredName: form.preferredName,
        personalEmail: form.personalEmail,
        phone: form.phone,
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        addressLine1: form.addressLine1,
        city: form.city,
        state: form.state,
        country: form.country,
        bankName: form.bankName,
        bankAccountNumber: form.bankAccountNumber,
        bvn: form.bvn,
        ...(form.ecName && form.ecPhone
          ? {
              emergencyContact: {
                name: form.ecName,
                relationship: form.ecRelationship,
                phone: form.ecPhone,
                email: form.ecEmail,
              },
            }
          : {}),
      });
      hydrate(updated);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setBusy(false);
    }
  }

  async function acceptTerms() {
    setError('');
    setBusy(true);
    try {
      const updated = await api.post<OnboardingMe>('/onboarding/accept-terms', {});
      hydrate(updated);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept terms');
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <Spinner />;

  const canEdit = data?.status === 'NOT_SUBMITTED' || data?.status === 'REJECTED';
  const done = data?.status === 'APPROVED' && !!data.termsAcceptedAt;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Employee setup</h1>
        {data && <Badge tone={statusTone(data.status)}>{data.status.replace('_', ' ')}</Badge>}
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      {data?.status === 'REJECTED' && data.note && (
        <Alert kind="error">
          Your submission was returned for changes: <span className="font-medium">{data.note}</span>
        </Alert>
      )}
      {data?.status === 'SUBMITTED' && (
        <Alert kind="info">
          Your profile was submitted{data.submittedAt ? ` on ${new Date(data.submittedAt).toLocaleString()}` : ''} and
          is awaiting review by HR. You will be notified once it has been reviewed.
        </Alert>
      )}
      {done && <Alert kind="success">Onboarding complete — your profile is approved and terms are accepted.</Alert>}

      {data && canEdit && (
        <Card title={`Profile details — ${data.profile.firstName} ${data.profile.lastName} (${data.profile.employeeNo})`}>
          <form onSubmit={submit} className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Middle name (optional)">
                <Input value={form.middleName} onChange={set('middleName')} maxLength={80} />
              </Field>
              <Field label="Preferred name (optional)">
                <Input value={form.preferredName} onChange={set('preferredName')} maxLength={80} />
              </Field>
              <Field label="Personal email (optional)">
                <Input type="email" value={form.personalEmail} onChange={set('personalEmail')} />
              </Field>
              <Field label="Mobile number">
                <Input value={form.phone} onChange={set('phone')} required minLength={7} placeholder="+2348012345678" />
              </Field>
              <Field label="Date of birth">
                <Input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} required />
              </Field>
              <Field label="Gender">
                <Select value={form.gender} onChange={set('gender')} required>
                  <option value="" disabled>
                    Select…
                  </option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>
                      {g === 'MALE' ? 'Male' : 'Female'}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Address</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Street address">
                  <Input value={form.addressLine1} onChange={set('addressLine1')} required minLength={3} />
                </Field>
                <Field label="City (optional)">
                  <Input value={form.city} onChange={set('city')} maxLength={80} />
                </Field>
                <Field label="State">
                  <Select value={form.state} onChange={set('state')} required>
                    <option value="" disabled>
                      Select state…
                    </option>
                    {NIGERIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Country (ISO-2)">
                  <Input value={form.country} onChange={set('country')} required maxLength={2} placeholder="NG" />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Bank details</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label="Bank">
                  <Input list="ng-banks" value={form.bankName} onChange={set('bankName')} required minLength={2} placeholder="Select or type your bank" />
                  <datalist id="ng-banks">
                    {NIGERIAN_BANKS.map((b) => (
                      <option key={b} value={b} />
                    ))}
                  </datalist>
                </Field>
                <Field label="Account number (NUBAN)">
                  <Input value={form.bankAccountNumber} onChange={set('bankAccountNumber')} required pattern="\d{10}" maxLength={10} inputMode="numeric" title="10 digits" />
                </Field>
                <Field label="BVN (optional)">
                  <Input value={form.bvn} onChange={set('bvn')} pattern="\d{11}" maxLength={11} inputMode="numeric" title="11 digits" />
                </Field>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Bank details and BVN are only visible to you and authorised payroll staff.
              </p>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Emergency contact (optional)
              </h3>
              <div className="grid gap-3 md:grid-cols-4">
                <Field label="Name">
                  <Input value={form.ecName} onChange={set('ecName')} maxLength={120} />
                </Field>
                <Field label="Relationship">
                  <Input value={form.ecRelationship} onChange={set('ecRelationship')} maxLength={60} />
                </Field>
                <Field label="Phone">
                  <Input value={form.ecPhone} onChange={set('ecPhone')} maxLength={40} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form.ecEmail} onChange={set('ecEmail')} />
                </Field>
              </div>
            </div>

            <Button type="submit" disabled={busy}>
              {busy ? 'Submitting…' : 'Submit for review'}
            </Button>
          </form>
        </Card>
      )}

      {data?.status === 'APPROVED' && !data.termsAcceptedAt && (
        <Card title="Terms of employment">
          <pre className="mb-4 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm text-slate-700">
            {data.terms}
          </pre>
          <Button onClick={() => void acceptTerms()} disabled={busy}>
            {busy ? 'Saving…' : 'I accept the terms of employment'}
          </Button>
        </Card>
      )}

      {done && (
        <Card title="Your submitted details">
          <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-400">Employee no</dt>
              <dd>{data.profile.employeeNo}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Terms accepted</dt>
              <dd>{data.termsAcceptedAt ? new Date(data.termsAcceptedAt).toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Phone</dt>
              <dd>{data.profile.phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">State</dt>
              <dd>{data.profile.state ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Bank</dt>
              <dd>{data.profile.bankName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-400">Account number</dt>
              <dd>{data.profile.bankAccountNumber ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-400">
            Need to change something? Contact HR — approved profiles are updated by your HR team.
          </p>
        </Card>
      )}
    </div>
  );
}
