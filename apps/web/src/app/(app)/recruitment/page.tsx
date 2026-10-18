'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Alert, Badge, Button, Card, Empty, Field, Input, Modal, Select, Spinner, Table, statusTone } from '@/components/ui';

interface Posting {
  id: string;
  title: string;
  description: string | null;
  employmentType: string;
  status: 'DRAFT' | 'OPEN' | 'CLOSED';
  openings: number;
  salaryMin: string | null;
  salaryMax: string | null;
  department: { id: string; name: string } | null;
  _count?: { applications: number };
}

interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  source: string | null;
}

interface Application {
  id: string;
  stage: string;
  rejectionReason: string | null;
  offerSalary: string | null;
  offerStartDate: string | null;
  hiredEmployeeId: string | null;
  jobPosting: { id: string; title: string; status: string };
  candidate: { id: string; firstName: string; lastName: string; email: string };
  interviews?: { id: string; scheduledAt: string; mode: string; status: string; rating: number | null; feedback: string | null }[];
}

interface Department {
  id: string;
  name: string;
}

const stageTone = (stage: string): 'slate' | 'green' | 'red' | 'amber' | 'blue' => {
  switch (stage) {
    case 'HIRED':
      return 'green';
    case 'REJECTED':
    case 'WITHDRAWN':
      return 'red';
    case 'OFFER':
      return 'amber';
    default:
      return 'blue';
  }
};

const dt = (iso: string) => new Date(iso).toLocaleString();

export default function RecruitmentPage() {
  const { can } = useSession();
  const canManage = can('recruitment.manage');
  const canHire = can('recruitment.hire');

  const [tab, setTab] = useState<'pipeline' | 'postings' | 'candidates'>('pipeline');
  const [postings, setPostings] = useState<Posting[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState('');

  const [showPosting, setShowPosting] = useState(false);
  const [postingForm, setPostingForm] = useState({ title: '', description: '', employmentType: 'FULL_TIME', openings: '1', departmentId: '' });
  const [showCandidate, setShowCandidate] = useState(false);
  const [candidateForm, setCandidateForm] = useState({ firstName: '', lastName: '', email: '', phone: '', source: '' });
  const [showApplication, setShowApplication] = useState(false);
  const [applicationForm, setApplicationForm] = useState({ jobPostingId: '', candidateId: '' });

  const [detail, setDetail] = useState<Application | null>(null);
  const [interviewForm, setInterviewForm] = useState({ scheduledAt: '', mode: 'VIDEO' });
  const [offerForm, setOfferForm] = useState({ salary: '', startDate: '', note: '' });
  const [hireForm, setHireForm] = useState({ jobTitle: '', departmentId: '' });
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, c, a] = await Promise.all([
        api.get<Posting[]>('/recruitment/postings'),
        api.get<Candidate[]>('/recruitment/candidates'),
        api.get<Application[]>('/recruitment/applications'),
      ]);
      setPostings(p);
      setCandidates(c);
      setApplications(a);
      api.get<Department[]>('/departments').then(setDepartments).catch(() => setDepartments([]));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recruitment data');
    }
  }, []);

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

  async function openDetail(id: string) {
    setError('');
    try {
      setDetail(await api.get<Application>(`/recruitment/applications/${id}`));
      setInterviewForm({ scheduledAt: '', mode: 'VIDEO' });
      setOfferForm({ salary: '', startDate: '', note: '' });
      setHireForm({ jobTitle: '', departmentId: '' });
      setRejectReason('');
      setModalError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load application');
    }
  }

  async function refreshDetail() {
    if (detail) await openDetail(detail.id);
  }

  if (!postings || !candidates || !applications) {
    return error ? <Alert kind="error">{error}</Alert> : <Spinner />;
  }

  const tabClass = (t: string) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      tab === t ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-100'
    }`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Recruitment</h1>
        <div className="flex gap-2">
          {canManage && (
            <>
              <Button variant="secondary" onClick={() => { setShowCandidate(true); setModalError(''); }}>
                New candidate
              </Button>
              <Button variant="secondary" onClick={() => { setShowPosting(true); setModalError(''); }}>
                New posting
              </Button>
              <Button onClick={() => { setShowApplication(true); setModalError(''); }}>New application</Button>
            </>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="flex gap-1">
        <button className={tabClass('pipeline')} onClick={() => setTab('pipeline')}>
          Pipeline ({applications.length})
        </button>
        <button className={tabClass('postings')} onClick={() => setTab('postings')}>
          Postings ({postings.length})
        </button>
        <button className={tabClass('candidates')} onClick={() => setTab('candidates')}>
          Candidates ({candidates.length})
        </button>
      </div>

      {tab === 'pipeline' && (
        <Card>
          {applications.length === 0 ? (
            <Empty>No applications yet.</Empty>
          ) : (
            <Table headers={['Candidate', 'Posting', 'Stage', '']}>
              {applications.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2">
                    {a.candidate.firstName} {a.candidate.lastName}
                    <div className="text-xs text-slate-400">{a.candidate.email}</div>
                  </td>
                  <td className="px-3 py-2">{a.jobPosting.title}</td>
                  <td className="px-3 py-2">
                    <Badge tone={stageTone(a.stage)}>{a.stage}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" onClick={() => void openDetail(a.id)}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === 'postings' && (
        <Card>
          {postings.length === 0 ? (
            <Empty>No job postings yet.</Empty>
          ) : (
            <Table headers={['Title', 'Department', 'Type', 'Openings', 'Applications', 'Status', '']}>
              {postings.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">{p.title}</td>
                  <td className="px-3 py-2">{p.department?.name ?? '—'}</td>
                  <td className="px-3 py-2">{p.employmentType.replace('_', ' ')}</td>
                  <td className="px-3 py-2">{p.openings}</td>
                  <td className="px-3 py-2">{p._count?.applications ?? 0}</td>
                  <td className="px-3 py-2">
                    <Badge tone={p.status === 'OPEN' ? 'green' : p.status === 'CLOSED' ? 'red' : 'slate'}>{p.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {canManage && p.status === 'DRAFT' && (
                      <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.patch(`/recruitment/postings/${p.id}`, { status: 'OPEN' }), 'Posting opened.')}>
                        Open
                      </Button>
                    )}
                    {canManage && p.status === 'OPEN' && (
                      <Button variant="ghost" disabled={busy} onClick={() => void run(() => api.patch(`/recruitment/postings/${p.id}`, { status: 'CLOSED' }), 'Posting closed.')}>
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

      {tab === 'candidates' && (
        <Card>
          {candidates.length === 0 ? (
            <Empty>No candidates yet.</Empty>
          ) : (
            <Table headers={['Name', 'Email', 'Phone', 'Source']}>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-medium text-slate-800">
                    {c.firstName} {c.lastName}
                  </td>
                  <td className="px-3 py-2">{c.email}</td>
                  <td className="px-3 py-2">{c.phone ?? '—'}</td>
                  <td className="px-3 py-2">{c.source ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {showPosting && (
        <Modal title="New job posting" onClose={() => setShowPosting(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api.post('/recruitment/postings', {
                    title: postingForm.title,
                    description: postingForm.description || undefined,
                    employmentType: postingForm.employmentType,
                    openings: Number(postingForm.openings),
                    departmentId: postingForm.departmentId || undefined,
                  }),
                'Posting created.',
                true,
              ).then((ok) => {
                if (ok) {
                  setShowPosting(false);
                  setPostingForm({ title: '', description: '', employmentType: 'FULL_TIME', openings: '1', departmentId: '' });
                }
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Title">
              <Input required value={postingForm.title} onChange={(e) => setPostingForm({ ...postingForm, title: e.target.value })} />
            </Field>
            <Field label="Description">
              <Input value={postingForm.description} onChange={(e) => setPostingForm({ ...postingForm, description: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employment type">
                <Select value={postingForm.employmentType} onChange={(e) => setPostingForm({ ...postingForm, employmentType: e.target.value })}>
                  {['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY'].map((t) => (
                    <option key={t} value={t}>
                      {t.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Openings">
                <Input type="number" min={1} max={999} value={postingForm.openings} onChange={(e) => setPostingForm({ ...postingForm, openings: e.target.value })} />
              </Field>
            </div>
            <Field label="Department (optional)">
              <Select value={postingForm.departmentId} onChange={(e) => setPostingForm({ ...postingForm, departmentId: e.target.value })}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>
              Create posting
            </Button>
          </form>
        </Modal>
      )}

      {showCandidate && (
        <Modal title="New candidate" onClose={() => setShowCandidate(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  api.post('/recruitment/candidates', {
                    firstName: candidateForm.firstName,
                    lastName: candidateForm.lastName,
                    email: candidateForm.email,
                    phone: candidateForm.phone || undefined,
                    source: candidateForm.source || undefined,
                  }),
                'Candidate created.',
                true,
              ).then((ok) => {
                if (ok) {
                  setShowCandidate(false);
                  setCandidateForm({ firstName: '', lastName: '', email: '', phone: '', source: '' });
                }
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <Input required value={candidateForm.firstName} onChange={(e) => setCandidateForm({ ...candidateForm, firstName: e.target.value })} />
              </Field>
              <Field label="Last name">
                <Input required value={candidateForm.lastName} onChange={(e) => setCandidateForm({ ...candidateForm, lastName: e.target.value })} />
              </Field>
            </div>
            <Field label="Email">
              <Input type="email" required value={candidateForm.email} onChange={(e) => setCandidateForm({ ...candidateForm, email: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Phone (optional)">
                <Input value={candidateForm.phone} onChange={(e) => setCandidateForm({ ...candidateForm, phone: e.target.value })} />
              </Field>
              <Field label="Source (optional)">
                <Select value={candidateForm.source} onChange={(e) => setCandidateForm({ ...candidateForm, source: e.target.value })}>
                  <option value="">—</option>
                  {['REFERRAL', 'LINKEDIN', 'JOB_BOARD', 'WEBSITE', 'AGENCY', 'OTHER'].map((s) => (
                    <option key={s} value={s}>
                      {s.replace('_', ' ')}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Button type="submit" disabled={busy}>
              Create candidate
            </Button>
          </form>
        </Modal>
      )}

      {showApplication && (
        <Modal title="New application" onClose={() => setShowApplication(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => api.post('/recruitment/applications', applicationForm),
                'Application created.',
                true,
              ).then((ok) => {
                if (ok) {
                  setShowApplication(false);
                  setApplicationForm({ jobPostingId: '', candidateId: '' });
                }
              });
            }}
          >
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <Field label="Job posting">
              <Select required value={applicationForm.jobPostingId} onChange={(e) => setApplicationForm({ ...applicationForm, jobPostingId: e.target.value })}>
                <option value="">Select a posting…</option>
                {postings
                  .filter((p) => p.status !== 'CLOSED')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Candidate">
              <Select required value={applicationForm.candidateId} onChange={(e) => setApplicationForm({ ...applicationForm, candidateId: e.target.value })}>
                <option value="">Select a candidate…</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} ({c.email})
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>
              Create application
            </Button>
          </form>
        </Modal>
      )}

      {detail && (
        <Modal
          title={`${detail.candidate.firstName} ${detail.candidate.lastName} — ${detail.jobPosting.title}`}
          onClose={() => setDetail(null)}
        >
          <div className="space-y-4">
            {modalError && <Alert kind="error">{modalError}</Alert>}
            <div className="flex items-center gap-2">
              <Badge tone={stageTone(detail.stage)}>{detail.stage}</Badge>
              {detail.offerSalary && (
                <span className="text-sm text-slate-500">
                  Offer: ₦{Number(detail.offerSalary).toLocaleString()} from {detail.offerStartDate?.slice(0, 10)}
                </span>
              )}
              {detail.rejectionReason && <span className="text-sm text-slate-500">Reason: {detail.rejectionReason}</span>}
            </div>

            {(detail.interviews?.length ?? 0) > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Interviews</div>
                <ul className="space-y-1 text-sm">
                  {detail.interviews!.map((iv) => (
                    <li key={iv.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                      <span>
                        {dt(iv.scheduledAt)} · {iv.mode} · <Badge tone={statusTone(iv.status)}>{iv.status}</Badge>
                        {iv.rating != null && <span className="ml-2 text-slate-500">Rating {iv.rating}/5</span>}
                      </span>
                      {canManage && iv.status === 'SCHEDULED' && (
                        <span className="flex gap-1">
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => api.post(`/recruitment/interviews/${iv.id}/feedback`, { status: 'COMPLETED', rating: 4 }),
                                'Interview completed.',
                                true,
                              ).then(refreshDetail)
                            }
                          >
                            Complete
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => api.post(`/recruitment/interviews/${iv.id}/feedback`, { status: 'CANCELLED' }),
                                'Interview cancelled.',
                                true,
                              ).then(refreshDetail)
                            }
                          >
                            Cancel
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canManage && ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'].includes(detail.stage) && (
              <div className="space-y-3 border-t border-slate-100 pt-3">
                {detail.stage !== 'OFFER' && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {detail.stage === 'APPLIED' && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(() => api.post(`/recruitment/applications/${detail.id}/stage`, { stage: 'SCREENING' }), 'Moved to screening.', true).then(refreshDetail)
                          }
                        >
                          Move to screening
                        </Button>
                      )}
                      <Button
                        variant="danger"
                        disabled={busy || !rejectReason}
                        onClick={() =>
                          void run(
                            () => api.post(`/recruitment/applications/${detail.id}/stage`, { stage: 'REJECTED', rejectionReason: rejectReason }),
                            'Application rejected.',
                            true,
                          ).then(refreshDetail)
                        }
                      >
                        Reject
                      </Button>
                      <Input
                        placeholder="Rejection reason…"
                        className="max-w-xs"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                    </div>

                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(
                          () =>
                            api.post(`/recruitment/applications/${detail.id}/interviews`, {
                              scheduledAt: new Date(interviewForm.scheduledAt).toISOString(),
                              mode: interviewForm.mode,
                            }),
                          'Interview scheduled.',
                          true,
                        ).then(refreshDetail);
                      }}
                    >
                      <Field label="Schedule interview">
                        <Input
                          type="datetime-local"
                          required
                          value={interviewForm.scheduledAt}
                          onChange={(e) => setInterviewForm({ ...interviewForm, scheduledAt: e.target.value })}
                        />
                      </Field>
                      <Field label="Mode">
                        <Select value={interviewForm.mode} onChange={(e) => setInterviewForm({ ...interviewForm, mode: e.target.value })}>
                          {['PHONE', 'VIDEO', 'ONSITE'].map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button type="submit" variant="secondary" disabled={busy}>
                        Schedule
                      </Button>
                    </form>

                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(
                          () =>
                            api.post(`/recruitment/applications/${detail.id}/offer`, {
                              salary: offerForm.salary,
                              startDate: offerForm.startDate,
                              note: offerForm.note || undefined,
                            }),
                          'Offer made.',
                          true,
                        ).then(refreshDetail);
                      }}
                    >
                      <Field label="Offer salary (annual ₦)">
                        <Input required placeholder="12000000" value={offerForm.salary} onChange={(e) => setOfferForm({ ...offerForm, salary: e.target.value })} />
                      </Field>
                      <Field label="Start date">
                        <Input type="date" required value={offerForm.startDate} onChange={(e) => setOfferForm({ ...offerForm, startDate: e.target.value })} />
                      </Field>
                      <Button type="submit" variant="secondary" disabled={busy}>
                        Make offer
                      </Button>
                    </form>
                  </>
                )}

                {detail.stage === 'OFFER' && canHire && (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(
                        () =>
                          api.post(`/recruitment/applications/${detail.id}/hire`, {
                            jobTitle: hireForm.jobTitle,
                            departmentId: hireForm.departmentId || undefined,
                          }),
                        'Candidate hired — employee record created.',
                        true,
                      ).then(refreshDetail);
                    }}
                  >
                    <Field label="Job title">
                      <Input required value={hireForm.jobTitle} onChange={(e) => setHireForm({ ...hireForm, jobTitle: e.target.value })} />
                    </Field>
                    <Field label="Department">
                      <Select value={hireForm.departmentId} onChange={(e) => setHireForm({ ...hireForm, departmentId: e.target.value })}>
                        <option value="">—</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button type="submit" disabled={busy}>
                      Hire
                    </Button>
                  </form>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
