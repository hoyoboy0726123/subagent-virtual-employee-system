import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker, ExportButtons, Citations, ProgressBar } from '../components/ui.jsx';
import { useI18n } from '../i18n.jsx';

// Goal-level status the MANAGER sets (dropdown). Task status is separate: a
// task is 'pending'(待執行) until ▶ 執行交付 delivers it → 'done'.
const STATUSES = ['in-progress', 'blocked', 'done'];
const DEFAULT_FILTERS = { q: '', assigneeId: '', runtime: '', live: '', status: '', sort: 'newest', page: 1, pageSize: 5 };

export default function GoalsPage({ refreshKey, onChange, onActivity, onGotoMeeting }) {
  const { t } = useI18n();
  const STATUS_LABELS = {
    pending: t('goals.statusPending'), 'in-progress': t('goals.statusInProgress'),
    blocked: t('goals.statusBlocked'), done: t('goals.statusDone'),
  };
  const [employees, setEmployees] = useState([]);
  const [goalData, setGoalData] = useState({ items: [], total: 0, page: 1, totalPages: 1 });
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ title: '', description: '' });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [progress, setProgress] = useState(null); // Phase 15 live progress: { doneTasks, total, phase }
  const [rerunNote, setRerunNote] = useState('');
  const [rerunning, setRerunning] = useState(false);
  const [executing, setExecuting] = useState(null); // task order being executed
  const [executingAll, setExecutingAll] = useState(false); // batch run in progress
  const [reviewing, setReviewing] = useState(false); // feeding results back to the meeting
  const [reviewMsg, setReviewMsg] = useState(''); // success note after close-the-loop
  // Tell the shell a goal run is streaming — dot on the tab; page stays mounted
  // across tab switches so the run isn't dropped.
  useEffect(() => { onActivity?.(busy || rerunning || executing !== null); }, [busy, rerunning, executing, onActivity]);

  const reload = async (next = filters) => {
    const [employeeList, goals] = await Promise.all([
      api.get('/employees'),
      api.get(`/goals?${new URLSearchParams(next).toString()}`),
    ]);
    setEmployees(employeeList);
    setGoalData(goals);
  };
  // Single fetch path: [filters] owns loading; refreshKey just resets filters
  // (skipping the mount tick so the list isn't double-fetched or racy).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    setFilters({ ...DEFAULT_FILTERS });
  }, [refreshKey]);
  useEffect(() => { reload(filters); }, [filters]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const assign = async () => {
    setErr('');
    if (!form.title.trim() || selected.length === 0) {
      setErr(t('goals.errNeedTitleAndOne'));
      return;
    }
    setBusy(true);
    setProgress({ doneTasks: [], total: selected.length, phase: null });
    try {
      const { goal } = await api.stream(
        '/goals/stream',
        { ...form, assigneeIds: selected },
        (evt) => {
          if (evt.type === 'task') {
            setProgress((p) => ({ ...p, doneTasks: [...(p?.doneTasks || []), evt.task] }));
          } else if (evt.type === 'synthesizing') {
            setProgress((p) => ({ ...p, phase: t('goals.synthesizingPhase') }));
          }
        },
      );
      setForm({ title: '', description: '' }); setSelected([]);
      onChange?.();
      setOpen(goal);
    } catch (e) { setErr(e.message); } finally { setBusy(false); setProgress(null); }
  };

  // List rows are lightweight (no tasks/output/grounding) — fetch the full
  // record on click to open the detail modal.
  const openGoal = async (goal) => {
    try { setOpen(await api.get(`/goals/${goal.id}`)); } catch (e) { setErr(e.message); }
  };

  const setStatus = async (goal, status) => {
    const updated = await api.put(`/goals/${goal.id}`, { status });
    // Patch only the status so the lightweight list row keeps its shape.
    setGoalData((data) => ({ ...data, items: data.items.map((g) => (g.id === goal.id ? { ...g, status: updated.status } : g)) }));
    if (open?.id === goal.id) setOpen(updated);
  };

  // Re-run the collaboration (the goal's「重啟」): the team builds on the
  // previous plan plus the manager's revision instruction; the fresh result
  // REPLACES tasks/output. Streams the same task-by-task progress as assign.
  // Close the loop: feed this goal's deliverables back into its source meeting,
  // then jump straight into that meeting's room (one click, no tab hunting).
  const reviewInMeeting = async () => {
    if (!open || reviewing) return;
    setErr(''); setReviewMsg('');
    setReviewing(true);
    try {
      const meeting = await api.post(`/goals/${open.id}/review-in-meeting`, {});
      setOpen(null); // close the goal modal
      onGotoMeeting?.(meeting.id); // App switches to 會議 tab + opens the room
    } catch (e) { setErr(e.message); } finally { setReviewing(false); }
  };

  const rerunGoal = async () => {
    if (!open || rerunning) return;
    setErr('');
    setRerunning(true);
    setProgress({ doneTasks: [], total: (open.assignees || []).length, phase: null });
    try {
      const { goal } = await api.stream(
        `/goals/${open.id}/rerun/stream`,
        { instruction: rerunNote },
        (evt) => {
          if (evt.type === 'task') {
            setProgress((p) => ({ ...p, doneTasks: [...(p?.doneTasks || []), evt.task] }));
          } else if (evt.type === 'synthesizing') {
            setProgress((p) => ({ ...p, phase: t('goals.synthesizingPhase') }));
          }
        },
      );
      setRerunNote('');
      onChange?.();
      setOpen(goal);
    } catch (e) { setErr(e.message); } finally { setRerunning(false); setProgress(null); }
  };

  // EXECUTE one task (Phase 20): the assignee actually does the work — web
  // research + citations — and the deliverable lands on the task card.
  const executeTask = async (task) => {
    if (!open || executing !== null || executingAll) return;
    setErr('');
    setExecuting(task.order);
    try {
      const updated = await api.post(`/goals/${open.id}/tasks/${task.order}/execute`);
      setOpen(updated);
      onChange?.();
    } catch (e) { setErr(e.message); } finally { setExecuting(null); }
  };

  // Run every not-yet-delivered task IN ORDER, so each assignee's deliverable
  // feeds the next (priorDeliverables). One click instead of returning to press
  // ▶ 執行交付 on each task.
  const executeAll = async () => {
    if (!open || executing !== null || executingAll) return;
    setErr('');
    setExecutingAll(true);
    const pending = open.tasks.filter((t) => t.status !== 'done' && !t.deliverable).map((t) => t.order);
    let current = open;
    let failures = 0;
    try {
      for (const order of pending) {
        setExecuting(order);
        try {
          current = await api.post(`/goals/${current.id}/tasks/${order}/execute`);
          setOpen(current);
        } catch (e) { failures += 1; setErr(t('goals.execFailedErr', { order, msg: e.message })); }
      }
      onChange?.();
      if (!failures) setErr('');
    } finally { setExecuting(null); setExecutingAll(false); }
  };

  const del = async (id) => { await api.del(`/goals/${id}`); onChange?.(); };
  const patchFilters = (patch) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const goals = goalData.items || [];

  return (
    <div className="page">
      <div className="page-head"><div><h2>{t('goals.pageTitle')}</h2><p className="muted">{t('goals.pageDesc')}</p></div></div>

      <div className="panel">
        <h3>{t('goals.assignTitle')}</h3>
        {err && <div className="banner-err">{err}</div>}
        <label className="block">{t('goals.titleLabel')}
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('goals.titlePlaceholder')} />
        </label>
        <label className="block">{t('goals.descLabel')}
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('goals.descPlaceholder')} />
        </label>
        <label className="block">{t('goals.assigneesLabel')}
          {employees.length === 0
            ? <p className="muted">{t('goals.noEmployeesYet')}</p>
            : <EmployeePicker employees={employees} selected={selected} toggle={toggle} />}
        </label>
        <div className="row end">
          <button className="btn" onClick={assign} disabled={busy}>{busy ? t('goals.assigningBtn') : t('goals.assignBtn')}</button>
        </div>
        {busy && (
          <ProgressBar label={progress?.phase
            || t('goals.assignProgress', { done: progress?.doneTasks.length || 0, total: progress?.total || '?' })
              + (progress?.doneTasks.length ? t('goals.latestDone', { name: progress.doneTasks[progress.doneTasks.length - 1].assignee }) : '')} />
        )}
      </div>

      <div className="section-head">
        <h3 className="section-title">{t('goals.goalLibraryHeading')}</h3>
        <span className="muted">{t('goals.totalCount', { n: goalData.total || 0 })}</span>
      </div>
      <div className="toolbar panel">
        <div className="toolbar-grid toolbar-grid-goals">
          <label>{t('goals.searchLabel')}
            <input value={filters.q} onChange={(e) => patchFilters({ q: e.target.value })} placeholder={t('goals.searchPlaceholder')} />
          </label>
          <label>{t('goals.assigneeFilterLabel')}
            <select value={filters.assigneeId} onChange={(e) => patchFilters({ assigneeId: e.target.value })}>
              <option value="">{t('goals.allOption')}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>{t('goals.statusFilterLabel')}
            <select value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })}>
              <option value="">{t('goals.allOption')}</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label>{t('goals.liveFilterLabel')}
            <select value={filters.live} onChange={(e) => patchFilters({ live: e.target.value })}>
              <option value="">{t('goals.allOption')}</option>
              <option value="true">{t('goals.liveOption')}</option>
              <option value="false">{t('goals.offlineOption')}</option>
            </select>
          </label>
          <label>{t('goals.sortLabel')}
            <select value={filters.sort} onChange={(e) => patchFilters({ sort: e.target.value })}>
              <option value="newest">{t('goals.sortNewest')}</option>
              <option value="oldest">{t('goals.sortOldest')}</option>
              <option value="title-asc">{t('goals.sortTitleAsc')}</option>
              <option value="title-desc">{t('goals.sortTitleDesc')}</option>
              <option value="status">{t('goals.sortStatus')}</option>
            </select>
          </label>
          <label>{t('goals.perPageLabel')}
            <select value={filters.pageSize} onChange={(e) => patchFilters({ pageSize: Number(e.target.value) })}>
              {[5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {goals.length === 0 ? (
        <Empty>{t('goals.emptyGoals')}</Empty>
      ) : (
        <>
          <div className="list">
            {goals.map((g) => (
              <div key={g.id} className="list-item">
                <button className="list-main" onClick={() => openGoal(g)}>
                  <strong>{g.title}</strong>
                  <span className="muted">{(g.assignees || []).map((p) => p.name).join('、')}{t('goals.taskCountSuffix', { n: g.taskCount ?? g.tasks?.length ?? 0 })}</span>
                </button>
                <select value={g.status} onChange={(e) => setStatus(g, e.target.value)} className={`status status-${g.status}`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                </select>
                <ExportButtons path={`/goals/${g.id}`} compact />
                <button className="icon-btn" onClick={() => del(g.id)} aria-label={t('goals.deleteGoalAria')}>🗑</button>
              </div>
            ))}
          </div>
          <Pagination page={goalData.page} totalPages={goalData.totalPages} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}

      {open && (
        <Modal title={`🎯 ${open.title}`} onClose={() => setOpen(null)} wide>
          <div className="view-meta"><ExportButtons path={`/goals/${open.id}`} /></div>
          {open.runtime?.mode && (
            <div className="view-meta">
              <span className={`runtime-badge ${open.runtime.fallback ? 'runtime-fallback' : ''}`} title={open.runtime.note || ''}>
                ⚙ {open.runtime.label || open.runtime.mode}{open.runtime.fallback ? t('meetings.runtimeFallbackSuffix') : ''}
              </span>
              {open.runtime.live && !open.runtime.fallback && (
                <span className="runtime-badge" title={open.runtime.note || ''}>
                  {t(open.runtime.engine === 'openclaw-cli' ? 'meetings.openClawLiveText' : 'meetings.builtinLiveText', { live: open.runtime.liveTurns, total: open.runtime.totalTurns })}
                  {open.runtime.model ? t('meetings.modelSuffix', { model: open.runtime.model }) : ''}
                </span>
              )}
              {open.grounding?.length > 0 && <span className="runtime-badge">{t('goals.groundingCountBadge', { n: open.grounding.length })}</span>}
            </div>
          )}
          {open.description && <p className="muted">{open.description}</p>}

          {/* Close the loop: goals born from a meeting can feed their delivered
              results back for a follow-up decision. */}
          {(open.sourceMeetingId || /來源會議/.test(open.runtime?.note || '')) && open.tasks.some((tk) => tk.deliverable) && (
            <div className="loop-box">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', margin: 0 }}>
                <span className="muted sm">{t('goals.loopHint')}</span>
                <button className="btn sm" onClick={reviewInMeeting} disabled={reviewing}>
                  {reviewing ? t('goals.reviewingBtn') : t('goals.reviewBtn')}
                </button>
              </div>
              {reviewMsg && <div className="loop-note">{reviewMsg}</div>}
            </div>
          )}

          <div className="upload-box">
            <div className="interject-row">
              <input
                placeholder={t('goals.rerunPlaceholder')}
                value={rerunNote}
                onChange={(e) => setRerunNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') rerunGoal(); }}
                disabled={rerunning}
              />
              <button className="btn-ghost sm" onClick={rerunGoal} disabled={rerunning}>
                {rerunning ? t('goals.rerunningBtn') : t('goals.rerunBtn')}
              </button>
            </div>
            {rerunning ? (
              <ProgressBar label={progress?.phase || t('goals.rerunProgress', { done: progress?.doneTasks.length || 0, total: progress?.total || '?' })} />
            ) : (
              <p className="muted sm">{t('goals.rerunHint')}</p>
            )}
            {err && <div className="banner-err sm">{err}</div>}
          </div>

          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <h4 style={{ margin: 0 }}>{t('goals.taskBreakdownHeading')}</h4>
            {open.tasks.some((tk) => tk.status !== 'done' && !tk.deliverable) && (
              <button className="btn sm" onClick={executeAll} disabled={executing !== null || executingAll}>
                {executingAll ? t('goals.executingAllBtn', { n: executing }) : t('goals.executeAllBtn')}
              </button>
            )}
          </div>
          {executingAll && <ProgressBar label={t('goals.executingAllProgress', { n: executing })} />}
          <div className="tasks">
            {open.tasks.map((task, i) => (
              <div key={i} className="task">
                <div className="task-badge">{task.order}</div>
                <div>
                  <div className="turn-who">{task.assignee} <span className="muted">· {task.role}</span></div>
                  <div><strong>{task.subtask}</strong></div>
                  <div className="muted">{task.approach}</div>

                  {task.deliverable ? (
                    <div className="task-deliverable">
                      <div className="turn-who">
                        {t('goals.deliverableHeading')}
                        {task.deliverableToolCalls > 0 && <span className="tag" title={t('goals.deliverableToolCallsTitle')}>{t('goals.deliverableToolCallsTag', { n: task.deliverableToolCalls })}</span>}
                        {task.deliveredAt && <span className="muted sm"> · {new Date(task.deliveredAt).toLocaleString('zh-Hant')}</span>}
                      </div>
                      <Markdown text={task.deliverable} />
                      <Citations items={task.deliverableCitations} />
                      <div className="row end">
                        <button className="btn-ghost sm" onClick={() => executeTask(task)} disabled={executing !== null}>
                          {executing === task.order ? t('goals.reexecutingBtn') : t('goals.reexecuteBtn')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 8 }}>
                      <div className="row">
                        <button className="btn sm" onClick={() => executeTask(task)} disabled={executing !== null}>
                          {executing === task.order ? t('goals.executingBtn') : t('goals.executeBtn')}
                        </button>
                        {executing !== task.order && (
                          <span className="muted sm">{t('goals.executeHint', { name: task.assignee })}</span>
                        )}
                      </div>
                      {executing === task.order && (
                        <ProgressBar label={t('goals.executingProgress', { name: task.assignee })} />
                      )}
                    </div>
                  )}
                </div>
                <span className={`status status-${task.status}`}>{STATUS_LABELS[task.status] || task.status}</span>
              </div>
            ))}
          </div>
          <h4>{t('goals.outputHeading')}</h4>
          <div className="report"><Markdown text={open.output} /></div>

          {open.grounding?.length > 0 && (
            <>
              <h4>{t('goals.usedKnowledgeHeading')}</h4>
              <ul className="notes">
                {open.grounding.map((g) => (
                  <li key={g.chunkId} className="note">
                    <div>
                      <strong>{g.documentTitle}</strong> <span className="muted">· {g.employeeName}</span>
                      <p className="muted">{g.content}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, onPage }) {
  const { t } = useI18n();
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn-ghost btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>{t('common.prevPage')}</button>
      <span className="muted">{t('common.pageOf', { page, total: totalPages })}</span>
      <button className="btn-ghost btn-sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>{t('common.nextPage')}</button>
    </div>
  );
}
