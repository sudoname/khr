'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table } from '@/components/ui';

interface Cycle {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  _count?: { goals: number; reviews: number };
}

interface Goal {
  id: string;
  title: string;
  description: string | null;
  weight: string;
  status: string;
  progress: number;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string };
  cycle: { id: string; name: string; status: string };
}

interface Review {
  id: string;
  rating: number | null;
  strengths: string | null;
  improvements: string | null;
  comment: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'ACKNOWLEDGED';
  submittedAt: string | null;
  employee: { id: string; firstName: string; lastName: string; employeeNo: string };
  cycle: { id: string; name: string };
}

interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeNo: string;
}

const d = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC' });

const cycleTone = (s: string): 'slate' | 'green' | 'red' | 'amber' | 'blue' =>
  s === 'ACTIVE' ? 'green' : s === 'CLOSED' ? 'slate' : 'amber';

export default function PerformancePage() {
  const { me, can } = useSession();
  const canManage = can('performance.manage');
  const canReview = can('performance.review');
  const selfEmployeeId = me?.employee?.id ?? null;

  const [tab, setTab] = useState<'goals' | 'reviews' | 'cycles'>('goals');
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const [showCycle, setShowCycle] = useState(false);
  const [cycleForm, setCycleForm] = useState({ name: '', startDate: '', endDate: '' });
  const [showGoal, setShowGoal] = useState(false);
  const [goalForm, setGoalForm] = useState({ cycleId: '', employeeId: '', title: '', description: '', weight: '0' });
  const [showReview, setShowReview] = useState(false);
  const [reviewForm, setReviewForm] = useState({
    cycleId: '',
    employeeId: '',
    rating: '3',
    strengths: '',
    improvements: '',
    comment: '',
  });

  const load = useCallback(async () => {
    try {
      const [c, g, r] = await Promise.all([
        api.get<Cycle[]>('/performance/cycles'),
        api.get<Goal[]>('/performance/goals'),
        api.get<Review[]>('/performance/reviews'),
      ]);
      setCycles(c);
      setGoals(g);
      setReviews(r);
      if (canReview) {
        api
          .get<{ items: EmployeeOption[] }>('/employees?pageSize=100')
          .then((res) => setEmployees(res.items ?? []))
          .catch(() => setEmployees([]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    }
  }, [canReview]);

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

  if (!cycles || !goals || !reviews) {
    return error ? <Alert kind="error">{error}</Alert> : <Spinner />;
  }

  const openCycles = cycles.filter((c) => c.status !== 'CLOSED');
  const tabClass = (t: string) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      tab === t ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-100'
    }`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Performance</h1>
        <div className="flex gap-2">
          {canManage && (
            <Button variant="secondary" onClick={() => { setShowCycle(true); setModalError(''); }}>
              New cycle
            </Button>
          )}
          {canReview && (
            <Button
              variant="secondary"
              onClick={() => {
                setShowReview(true);
                setModalError('');
                setReviewForm({ ...reviewForm, cycleId: openCycles[0]?.id ?? '' });
              }}
            >
              Write review
            </Button>
          )}
          <Button
            onClick={() => {
              setShowGoal(true);
              setModalError('');
              setGoalForm({ ...goalForm, cycleId: openCycles[0]?.id ?? '' });
            }}
          >
            New goal
          </Button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="flex gap-1">
        <button className={tabClass('goals')} onClick={() => setTab('goals')}>
          Goals ({goals.length})
        </button>
        <button className={tabClass('reviews')} onClick={() => setTab('reviews')}>
          Reviews ({reviews.length})
        </button>
        <button className={tabClass('cycles')} onClick={() => setTab('cycles')}>
          Cycles ({cycles.length})
        </button>
      </div>

      {tab === 'goals' && (
        <Card>
          {goals.length === 0 ? (
            <Empty>No goals yet.</Empty>
          ) : (
            <Table headers={['Goal', 'Employee', 'Cycle', 'Weight', 'Progress', 'Status', '']}>
              {goals.map((g) => {
                const own = g.employee.id === selfEmployeeId;
                const editable = (own || canManage) && g.status === 'ACTIVE' && g.cycle.status !== 'CLOSED';
                return (
                  <tr key={g.id}>
                    <td className="px-3 py-2 font-medium text-slate-800">{g.title}</td>
                    <td className="px-3 py-2">
                      {g.employee.firstName} {g.employee.lastName}
                    </td>
                    <td className="px-3 py-2">{g.cycle.name}</td>
                    <td className="px-3 py-2">{Number(g.weight).toFixed(0)}%</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-cyan-500" style={{ width: `${g.progress}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{g.progress}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={g.status === 'COMPLETED' ? 'green' : g.status === 'CANCELLED' ? 'slate' : 'blue'}>{g.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {editable && (
                        <>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => api.patch(`/performance/goals/${g.id}`, { progress: Math.min(100, g.progress + 25) }),
                                'Progress updated.',
                              )
                            }
                          >
                            +25%
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => api.patch(`/performance/goals/${g.id}`, { status: 'COMPLETED', progress: 100 }),
                                'Goal completed.',
                              )
                            }
                          >
                            Complete
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
      )}

      {tab === 'reviews' && (
        <Card>
          {reviews.length === 0 ? (
            <Empty>No reviews visible to you.</Empty>
          ) : (
            <Table headers={['Employee', 'Cycle', 'Rating', 'Status', 'Notes', '']}>
              {reviews.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {r.employee.firstName} {r.employee.lastName}
                  </td>
                  <td className="px-3 py-2">{r.cycle.name}</td>
                  <td className="px-3 py-2">{r.rating != null ? `${r.rating}/5` : '—'}</td>
                  <td className="px-3 py-2">
                    <Badge tone={r.status === 'ACKNOWLEDGED' ? 'green' : r.status === 'SUBMITTED' ? 'blue' : 'amber'}>{r.status}</Badge>
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 text-slate-500">{r.strengths ?? r.comment ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'SUBMITTED' && r.employee.id === selfEmployeeId && (
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void run(() => api.post(`/performance/reviews/${r.id}/acknowledge`, {}), 'Review acknowledged.')}
                      >
                        Acknowledge
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'cycles' && (
        <Card>
          {cycles.length === 0 ? (
            <Empty>No review cycles yet.</Empty>
          ) : (
            <Table headers={['Name', 'Period', 'Goals', 'Reviews', 'Status', '']}>
              {cycles.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{c.name}</td>
                  <td className="px-3 py-2">
                    {d(c.startDate)} – {d(c.endDate)}
                  </td>
                  <td className="px-3 py-2">{c._count?.goals ?? 0}</td>
                  <td className="px-3 py-2">{c._count?.reviews ?? 0}</td>
                  <td className="px-3 py-2">
                    <Badge tone={cycleTone(c.status)}>{c.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && c.status === 'DRAFT' && (
                      <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.post(`/performance/cycles/${c.id}/status`, { status: 'ACTIVE' }), 'Cycle activated.')}>
                        Activate
                      </Button>
                    )}
                    {canManage && c.status === 'ACTIVE' && (
                      <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.post(`/performance/cycles/${c.id}/status`, { status: 'CLOSED' }), 'Cycle closed.')}>
                        Close
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {showCycle && (
        <Modal title="New review cycle" onClose={() => setShowCycle(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api.post('/performance/cycles', cycleForm), 'Cycle created.', true).then((ok) => {
                if (ok) {
                  setShowCycle(false);
                  setCycleForm({ name: '', startDate: '', endDate: '' });
                }
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Name">
              <Input required placeholder="2026 Mid-year review" value={cycleForm.name} onChange={(e) => setCycleForm({ ...cycleForm, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <Input type="date" required value={cycleForm.startDate} onChange={(e) => setCycleForm({ ...cycleForm, startDate: e.target.value })} />
              </Field>
              <Field label="End date">
                <Input type="date" required value={cycleForm.endDate} onChange={(e) => setCycleForm({ ...cycleForm, endDate: e.target.value })} />
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              Create cycle
            </Button>
          </form>
        </Modal>
      )}

      {showGoal && (
        <Modal title="New goal" onClose={() => setShowGoal(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api.post('/performance/goals', {
                    cycleId: goalForm.cycleId,
                    employeeId: goalForm.employeeId || undefined,
                    title: goalForm.title,
                    description: goalForm.description || undefined,
                    weight: Number(goalForm.weight),
                  }),
                'Goal created.',
                true,
              ).then((ok) => {
                if (ok) {
                  setShowGoal(false);
                  setGoalForm({ cycleId: '', employeeId: '', title: '', description: '', weight: '0' });
                }
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Cycle">
              <Select required value={goalForm.cycleId} onChange={(e) => setGoalForm({ ...goalForm, cycleId: e.target.value })}>
                <option value="">Select a cycle…</option>
                {openCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {canManage && (
              <Field label="Employee (blank = yourself)">
                <Select value={goalForm.employeeId} onChange={(e) => setGoalForm({ ...goalForm, employeeId: e.target.value })}>
                  <option value="">Myself</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.firstName} {emp.lastName} ({emp.employeeNo})
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Title">
              <Input required value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })} />
            </Field>
            <Field label="Description (optional)">
              <Input value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} />
            </Field>
            <Field label="Weight (%)">
              <Input type="number" min={0} max={100} value={goalForm.weight} onChange={(e) => setGoalForm({ ...goalForm, weight: e.target.value })} />
            </Field>
            <Button type="submit" disabled={busy}>
              Create goal
            </Button>
          </form>
        </Modal>
      )}

      {showReview && (
        <Modal title="Write review" onClose={() => setShowReview(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
              const submit = submitter?.value === 'submit';
              void run(
                () =>
                  api.put('/performance/reviews', {
                    cycleId: reviewForm.cycleId,
                    employeeId: reviewForm.employeeId,
                    rating: Number(reviewForm.rating),
                    strengths: reviewForm.strengths || undefined,
                    improvements: reviewForm.improvements || undefined,
                    comment: reviewForm.comment || undefined,
                    submit,
                  }),
                submit ? 'Review submitted.' : 'Draft saved.',
                true,
              ).then((ok) => {
                if (ok) setShowReview(false);
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cycle">
                <Select required value={reviewForm.cycleId} onChange={(e) => setReviewForm({ ...reviewForm, cycleId: e.target.value })}>
                  <option value="">Select a cycle…</option>
                  {openCycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Employee">
                <Select required value={reviewForm.employeeId} onChange={(e) => setReviewForm({ ...reviewForm, employeeId: e.target.value })}>
                  <option value="">Select an employee…</option>
                  {employees
                    .filter((emp) => emp.id !== selfEmployeeId)
                    .map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.firstName} {emp.lastName} ({emp.employeeNo})
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            <Field label="Rating (1–5)">
              <Select value={reviewForm.rating} onChange={(e) => setReviewForm({ ...reviewForm, rating: e.target.value })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Strengths">
              <Input value={reviewForm.strengths} onChange={(e) => setReviewForm({ ...reviewForm, strengths: e.target.value })} />
            </Field>
            <Field label="Areas to improve">
              <Input value={reviewForm.improvements} onChange={(e) => setReviewForm({ ...reviewForm, improvements: e.target.value })} />
            </Field>
            <Field label="Comment">
              <Input value={reviewForm.comment} onChange={(e) => setReviewForm({ ...reviewForm, comment: e.target.value })} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" value="draft" variant="secondary" disabled={busy}>
                Save draft
              </Button>
              <Button type="submit" value="submit" disabled={busy}>
                Submit review
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
