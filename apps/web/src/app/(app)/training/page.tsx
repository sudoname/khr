'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table } from '@/components/ui';

interface Course {
  id: string;
  title: string;
  description: string | null;
  provider: string | null;
  url: string | null;
  durationHours: string | null;
  mandatory: boolean;
  _count?: { enrollments: number };
}

interface Enrollment {
  id: string;
  status: 'ENROLLED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  score: number | null;
  enrolledAt: string;
  completedAt: string | null;
  course: { id: string; title: string; provider: string | null; mandatory: boolean };
  employee: { id: string; firstName: string; lastName: string; employeeNo: string };
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string;
}

const enrollTone = (s: string): 'slate' | 'green' | 'red' | 'amber' | 'blue' =>
  s === 'COMPLETED' ? 'green' : s === 'CANCELLED' ? 'slate' : s === 'IN_PROGRESS' ? 'amber' : 'blue';

export default function TrainingPage() {
  const { me, can } = useSession();
  const canManage = can('training.manage');
  const selfEmployeeId = me?.employee?.id ?? null;

  const [courses, setCourses] = useState<Course[] | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const [showCourse, setShowCourse] = useState(false);
  const [courseForm, setCourseForm] = useState({ title: '', description: '', provider: '', url: '', durationHours: '', mandatory: false });
  const [enrollTarget, setEnrollTarget] = useState<Course | null>(null);
  const [enrollEmployeeId, setEnrollEmployeeId] = useState('');

  const load = useCallback(async () => {
    try {
      const [c, e] = await Promise.all([
        api.get<Course[]>('/training/courses'),
        api.get<Enrollment[]>('/training/enrollments'),
      ]);
      setCourses(c);
      setEnrollments(e);
      if (canManage) {
        api
          .get<{ items: EmployeeOption[] }>('/employees?pageSize=100')
          .then((res) => setEmployees(res.items ?? []))
          .catch(() => setEmployees([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load training data');
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, successMsg: string, inModal = false) {
    setBusy(true);
    setModalError('');
    setError('');
    try {
      await fn();
      setNotice(successMsg);
      await load();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      if (inModal) setModalError(msg);
      else setError(msg);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!courses || !enrollments) {
    return error ? <Alert kind="error">{error}</Alert> : <Spinner />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Training</h1>
        {canManage && (
          <Button onClick={() => { setShowCourse(true); setModalError(''); }}>New course</Button>
        )}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title="Course catalogue">
        {courses.length === 0 ? (
          <Empty>No courses yet.</Empty>
        ) : (
          <Table headers={['Course', 'Provider', 'Duration', 'Mandatory', 'Enrollments', '']}>
            {courses.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-medium text-slate-800">
                  {c.url ? (
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-cyan-600 hover:underline">
                      {c.title}
                    </a>
                  ) : (
                    c.title
                  )}
                  {c.description && <div className="text-xs text-slate-400">{c.description}</div>}
                </td>
                <td className="px-3 py-2">{c.provider ?? '—'}</td>
                <td className="px-3 py-2">{c.durationHours ? `${Number(c.durationHours)} h` : '—'}</td>
                <td className="px-3 py-2">{c.mandatory ? <Badge tone="amber">Mandatory</Badge> : '—'}</td>
                <td className="px-3 py-2">{c._count?.enrollments ?? 0}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    variant="secondary"
                    disabled={busy || (!selfEmployeeId && !canManage)}
                    onClick={() => {
                      if (canManage) {
                        setEnrollTarget(c);
                        setEnrollEmployeeId('');
                        setModalError('');
                      } else {
                        void run(() => api.post(`/training/courses/${c.id}/enroll`, {}), 'Enrolled.');
                      }
                    }}
                  >
                    Enroll
                  </Button>
                  {canManage && (
                    <Button
                      variant="ghost"
                      className="ml-1 text-red-600"
                      disabled={busy}
                      onClick={() => void run(() => api.delete(`/training/courses/${c.id}`), 'Course deleted.')}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={canManage ? 'All enrollments' : 'My enrollments'}>
        {enrollments.length === 0 ? (
          <Empty>No enrollments yet.</Empty>
        ) : (
          <Table headers={['Course', 'Employee', 'Status', 'Score', 'Enrolled', '']}>
            {enrollments.map((en) => {
              const own = en.employee.id === selfEmployeeId;
              const openStatus = en.status === 'ENROLLED' || en.status === 'IN_PROGRESS';
              const actionable = (own || canManage) && openStatus;
              return (
                <tr key={en.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{en.course.title}</td>
                  <td className="px-3 py-2">
                    {en.employee.firstName} {en.employee.lastName}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={enrollTone(en.status)}>{en.status.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-3 py-2">{en.score != null ? `${en.score}%` : '—'}</td>
                  <td className="px-3 py-2">{new Date(en.enrolledAt).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right">
                    {actionable && en.status === 'ENROLLED' && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void run(() => api.patch(`/training/enrollments/${en.id}`, { status: 'IN_PROGRESS' }), 'Marked in progress.')}
                      >
                        Start
                      </Button>
                    )}
                    {actionable && (
                      <>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void run(() => api.patch(`/training/enrollments/${en.id}`, { status: 'COMPLETED', score: 100 }), 'Marked completed.')}
                        >
                          Complete
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void run(() => api.patch(`/training/enrollments/${en.id}`, { status: 'CANCELLED' }), 'Enrollment cancelled.')}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {showCourse && (
        <Modal title="New course" onClose={() => setShowCourse(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api.post('/training/courses', {
                    title: courseForm.title,
                    description: courseForm.description || undefined,
                    provider: courseForm.provider || undefined,
                    url: courseForm.url || undefined,
                    durationHours: courseForm.durationHours ? Number(courseForm.durationHours) : undefined,
                    mandatory: courseForm.mandatory,
                  }),
                'Course created.',
                true,
              ).then((ok) => {
                if (ok) {
                  setShowCourse(false);
                  setCourseForm({ title: '', description: '', provider: '', url: '', durationHours: '', mandatory: false });
                }
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Title">
              <Input required value={courseForm.title} onChange={(e) => setCourseForm({ ...courseForm, title: e.target.value })} />
            </Field>
            <Field label="Description (optional)">
              <Input value={courseForm.description} onChange={(e) => setCourseForm({ ...courseForm, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Provider (optional)">
                <Input value={courseForm.provider} onChange={(e) => setCourseForm({ ...courseForm, provider: e.target.value })} />
              </Field>
              <Field label="Duration (hours, optional)">
                <Input type="number" min={0} max={1000} value={courseForm.durationHours} onChange={(e) => setCourseForm({ ...courseForm, durationHours: e.target.value })} />
              </Field>
            </div>
            <Field label="Course URL (optional)">
              <Input type="url" value={courseForm.url} onChange={(e) => setCourseForm({ ...courseForm, url: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={courseForm.mandatory}
                onChange={(e) => setCourseForm({ ...courseForm, mandatory: e.target.checked })}
              />
              Mandatory for all employees
            </label>
            <Button type="submit" disabled={busy}>
              Create course
            </Button>
          </form>
        </Modal>
      )}

      {enrollTarget && (
        <Modal title={`Enroll — ${enrollTarget.title}`} onClose={() => setEnrollTarget(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api.post(`/training/courses/${enrollTarget.id}/enroll`, {
                    employeeId: enrollEmployeeId || undefined,
                  }),
                'Enrolled.',
                true,
              ).then((ok) => {
                if (ok) setEnrollTarget(null);
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Employee (blank = yourself)">
              <Select value={enrollEmployeeId} onChange={(e) => setEnrollEmployeeId(e.target.value)}>
                <option value="">Myself</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.employeeNo})
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>
              Enroll
            </Button>
          </form>
        </Modal>
      )}
    </div>
  );
}
