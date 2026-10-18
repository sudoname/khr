'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, Field, Input, Spinner, statusTone } from '@/components/ui';

interface EmergencyContact {
  id: string;
  name: string;
  relationship: string | null;
  phone: string;
  email: string | null;
}

interface MyProfile {
  id: string;
  employeeNo: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  preferredName: string | null;
  workEmail: string;
  personalEmail: string | null;
  phone: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  jobTitle: string;
  status: string;
  hireDate: string;
  photoUrl: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  department: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string; jobTitle: string } | null;
  emergencyContacts: EmergencyContact[];
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [form, setForm] = useState({
    preferredName: '',
    personalEmail: '',
    phone: '',
    addressLine1: '',
    city: '',
    state: '',
  });
  const [contact, setContact] = useState({ name: '', relationship: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    api
      .get<MyProfile>('/employees/me')
      .then((p) => {
        setProfile(p);
        setForm({
          preferredName: p.preferredName ?? '',
          personalEmail: p.personalEmail ?? '',
          phone: p.phone ?? '',
          addressLine1: p.addressLine1 ?? '',
          city: p.city ?? '',
          state: p.state ?? '',
        });
        const c = p.emergencyContacts[0];
        if (c) setContact({ name: c.name, relationship: c.relationship ?? '', phone: c.phone, email: c.email ?? '' });
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Could not load your profile'));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const updated = await api.patch<MyProfile>('/employees/me', {
        ...form,
        ...(contact.name && contact.phone
          ? { emergencyContact: { name: contact.name, relationship: contact.relationship, phone: contact.phone, email: contact.email } }
          : {}),
      });
      setProfile(updated);
      setNotice('Profile updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhoto(file: File) {
    setError('');
    setNotice('');
    setPhotoBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch('/api/employees/me/avatar', { method: 'POST', credentials: 'include', body });
      const data = (await res.json().catch(() => null)) as { photoUrl?: string; message?: string } | null;
      if (!res.ok) throw new Error(data?.message ?? 'Upload failed');
      setProfile((p) => (p ? { ...p, photoUrl: data?.photoUrl ?? p.photoUrl } : p));
      setNotice('Profile photo updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removePhoto() {
    setError('');
    setNotice('');
    setPhotoBusy(true);
    try {
      await api.delete('/employees/me/avatar');
      setProfile((p) => (p ? { ...p, photoUrl: null } : p));
      setNotice('Profile photo removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setPhotoBusy(false);
    }
  }

  if (loadError) return <Alert kind="error">{loadError}</Alert>;
  if (!profile) return <Spinner />;

  const displayName = profile.preferredName || `${profile.firstName} ${profile.lastName}`;
  const initials = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">My profile</h1>
        <p className="text-sm text-slate-500">Your employee record and self-service details.</p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative">
            {profile.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.photoUrl}
                alt={displayName}
                className="h-24 w-24 rounded-full border border-slate-200 object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-brand-600/10 text-2xl font-semibold text-brand-700">
                {initials}
              </div>
            )}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{displayName}</h2>
              <Badge tone={statusTone(profile.status)}>{profile.status}</Badge>
            </div>
            <p className="text-sm text-slate-500">
              {profile.jobTitle}
              {profile.department ? ` · ${profile.department.name}` : ''}
              {profile.location ? ` · ${profile.location.name}` : ''}
            </p>
            <p className="text-xs text-slate-400">
              {profile.employeeNo} · {profile.workEmail} · joined {new Date(profile.hireDate).toLocaleDateString()}
              {profile.manager ? ` · reports to ${profile.manager.firstName} ${profile.manager.lastName}` : ''}
            </p>
          </div>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPhoto(file);
              }}
            />
            <Button variant="secondary" disabled={photoBusy} onClick={() => fileRef.current?.click()}>
              {photoBusy ? 'Uploading…' : profile.photoUrl ? 'Change photo' : 'Add photo'}
            </Button>
            {profile.photoUrl && (
              <Button variant="ghost" disabled={photoBusy} onClick={() => void removePhoto()}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">JPEG, PNG or WebP, up to 2&nbsp;MB.</p>
      </Card>

      <form onSubmit={save} className="grid gap-4 lg:grid-cols-2">
        <Card title="Contact details">
          <div className="space-y-3">
            <Field label="Preferred name">
              <Input
                value={form.preferredName}
                onChange={(e) => setForm((f) => ({ ...f, preferredName: e.target.value }))}
                placeholder={`${profile.firstName} ${profile.lastName}`}
              />
            </Field>
            <Field label="Personal email">
              <Input
                type="email"
                value={form.personalEmail}
                onChange={(e) => setForm((f) => ({ ...f, personalEmail: e.target.value }))}
              />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Address">
              <Input value={form.addressLine1} onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </Field>
              <Field label="State">
                <Input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
              </Field>
            </div>
          </div>
        </Card>

        <Card title="Emergency contact">
          <div className="space-y-3">
            <Field label="Full name">
              <Input value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} />
            </Field>
            <Field label="Relationship">
              <Input
                value={contact.relationship}
                onChange={(e) => setContact((c) => ({ ...c, relationship: e.target.value }))}
                placeholder="Spouse, parent, sibling…"
              />
            </Field>
            <Field label="Phone">
              <Input value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />
            </Field>
            <Field label="Email (optional)">
              <Input type="email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} />
            </Field>
          </div>
        </Card>

        <div className="lg:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>

      {(profile.bankName || profile.bankAccountNumber) && (
        <Card title="Bank details (from onboarding)">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <div className="text-xs text-slate-400">Bank</div>
              <div>{profile.bankName ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Account number</div>
              <div>{profile.bankAccountNumber ?? '—'}</div>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">Contact HR to change your bank details.</p>
        </Card>
      )}
    </div>
  );
}
