'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table } from '@/components/ui';

interface Doc {
  id: string;
  name: string;
  category: string;
  mime: string;
  size: number;
  createdAt: string;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string } | null;
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string;
}

const CATEGORIES = ['CONTRACT', 'ID_DOCUMENT', 'CERTIFICATE', 'POLICY', 'OTHER'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  CONTRACT: 'Contract',
  ID_DOCUMENT: 'ID document',
  CERTIFICATE: 'Certificate',
  POLICY: 'Policy',
  OTHER: 'Other',
};

const fmtSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export default function DocumentsPage() {
  const { can } = useSession();
  const canManage = can('document.manage');

  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [modalError, setModalError] = useState('');
  const [form, setForm] = useState({ name: '', category: 'OTHER', employeeId: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setDocs(await api.get<Doc[]>('/documents'));
      if (canManage) {
        api
          .get<{ items?: EmployeeOption[] } | EmployeeOption[]>('/employees?pageSize=100')
          .then((res) => setEmployees(Array.isArray(res) ? res : (res.items ?? [])))
          .catch(() => setEmployees([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load documents');
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setModalError('Choose a file to upload');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', form.name || file.name);
      fd.append('category', form.category);
      if (form.employeeId) fd.append('employeeId', form.employeeId);
      const res = await fetch('/api/documents', { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Upload failed (${res.status})`);
      }
      setShowUpload(false);
      setForm({ name: '', category: 'OTHER', employeeId: '' });
      setNotice('Document uploaded.');
      await load();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError('');
    setBusy(true);
    try {
      await api.delete(`/documents/${id}`);
      setNotice('Document deleted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  if (!docs) return error ? <Alert kind="error">{error}</Alert> : <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Documents</h1>
        {canManage && (
          <Button onClick={() => { setShowUpload(true); setModalError(''); }}>Upload document</Button>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        {docs.length === 0 ? (
          <Empty>No documents yet.</Empty>
        ) : (
          <Table headers={['Name', 'Category', 'Belongs to', 'Size', 'Uploaded', '']}>
            {docs.map((doc) => (
              <tr key={doc.id}>
                <td className="px-3 py-2 font-medium text-slate-800">{doc.name}</td>
                <td className="px-3 py-2">
                  <Badge>{CATEGORY_LABELS[doc.category] ?? doc.category}</Badge>
                </td>
                <td className="px-3 py-2">
                  {doc.employee ? `${doc.employee.firstName} ${doc.employee.lastName} (${doc.employee.employeeNo})` : 'Company'}
                </td>
                <td className="px-3 py-2">{fmtSize(doc.size)}</td>
                <td className="px-3 py-2">{new Date(doc.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-right">
                  <a
                    className="text-sm font-medium text-cyan-600 hover:underline"
                    href={`/api/documents/${doc.id}/download`}
                  >
                    Download
                  </a>
                  {canManage && (
                    <Button variant="ghost" className="ml-2 text-red-600" disabled={busy} onClick={() => void remove(doc.id)}>
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {showUpload && (
        <Modal title="Upload document" onClose={() => setShowUpload(false)}>
          <form className="space-y-3" onSubmit={(e) => void upload(e)}>
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="File (PDF, image or Office document, max 10 MB)">
              <input
                ref={fileRef}
                type="file"
                required
                className="w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
              />
            </Field>
            <Field label="Name (defaults to file name)">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Employee (blank = company-wide)">
                <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">Company-wide</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName} ({emp.employeeNo})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              Upload
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
