import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker, ExportButtons } from '../components/ui.jsx';

// Goal-level status the MANAGER sets (dropdown). Task status is separate: a
// task is 'pending'(待執行) until ▶ 執行交付 delivers it → 'done'.
const STATUSES = ['in-progress', 'blocked', 'done'];
const STATUS_LABELS = { pending: '待執行', 'in-progress': '進行中', blocked: '受阻', done: '已完成' };
const DEFAULT_FILTERS = { q: '', assigneeId: '', runtime: '', live: '', status: '', sort: 'newest', page: 1, pageSize: 5 };

export default function GoalsPage({ refreshKey, onChange, onActivity }) {
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
      setErr('請輸入目標標題並至少選擇一位員工。');
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
            setProgress((p) => ({ ...p, phase: '主管代理正在整合各負責人的計畫…' }));
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
            setProgress((p) => ({ ...p, phase: '主管代理正在整合各負責人的計畫…' }));
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
    if (!open || executing !== null) return;
    setErr('');
    setExecuting(task.order);
    try {
      const updated = await api.post(`/goals/${open.id}/tasks/${task.order}/execute`);
      setOpen(updated);
      onChange?.();
    } catch (e) { setErr(e.message); } finally { setExecuting(null); }
  };

  const del = async (id) => { await api.del(`/goals/${id}`); onChange?.(); };
  const patchFilters = (patch) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const goals = goalData.items || [];

  return (
    <div className="page">
      <div className="page-head"><div><h2>目標</h2><p className="muted">將目標指派給一位或多位員工。他們會依專長分工，並產出協作成果。</p></div></div>

      <div className="panel">
        <h3>指派目標</h3>
        {err && <div className="banner-err">{err}</div>}
        <label className="block">目標標題
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="例如：啟動私人測試版" />
        </label>
        <label className="block">說明（選填）
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="背景、限制、期限…" />
        </label>
        <label className="block">負責人
          {employees.length === 0
            ? <p className="muted">請先建立員工。</p>
            : <EmployeePicker employees={employees} selected={selected} toggle={toggle} />}
        </label>
        <div className="row end">
          {busy && progress && (
            <span className="muted">
              {progress.phase
                || `⚡ 各負責人平行認領中 ${progress.doneTasks.length}/${progress.total}${progress.doneTasks.length ? `（最新完成：${progress.doneTasks[progress.doneTasks.length - 1].assignee}）` : ''}`}
            </span>
          )}
          <button className="btn" onClick={assign} disabled={busy}>{busy ? '指派中…' : '🎯 指派並協作'}</button>
        </div>
      </div>

      <div className="section-head">
        <h3 className="section-title">目標庫</h3>
        <span className="muted">共 {goalData.total || 0} 筆</span>
      </div>
      <div className="toolbar panel">
        <div className="toolbar-grid toolbar-grid-goals">
          <label>搜尋
            <input value={filters.q} onChange={(e) => patchFilters({ q: e.target.value })} placeholder="標題、描述、負責人、輸出內容" />
          </label>
          <label>負責人
            <select value={filters.assigneeId} onChange={(e) => patchFilters({ assigneeId: e.target.value })}>
              <option value="">全部</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>狀態
            <select value={filters.status} onChange={(e) => patchFilters({ status: e.target.value })}>
              <option value="">全部</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label>是否即時
            <select value={filters.live} onChange={(e) => patchFilters({ live: e.target.value })}>
              <option value="">全部</option>
              <option value="true">即時模型</option>
              <option value="false">離線 / 備援</option>
            </select>
          </label>
          <label>排序
            <select value={filters.sort} onChange={(e) => patchFilters({ sort: e.target.value })}>
              <option value="newest">最新優先</option>
              <option value="oldest">最舊優先</option>
              <option value="title-asc">標題 A→Z</option>
              <option value="title-desc">標題 Z→A</option>
              <option value="status">狀態優先</option>
            </select>
          </label>
          <label>每頁
            <select value={filters.pageSize} onChange={(e) => patchFilters({ pageSize: Number(e.target.value) })}>
              {[5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {goals.length === 0 ? (
        <Empty>目前沒有符合條件的目標。</Empty>
      ) : (
        <>
          <div className="list">
            {goals.map((g) => (
              <div key={g.id} className="list-item">
                <button className="list-main" onClick={() => openGoal(g)}>
                  <strong>{g.title}</strong>
                  <span className="muted">{(g.assignees || []).map((p) => p.name).join('、')} · {g.taskCount ?? g.tasks?.length ?? 0} 項任務</span>
                </button>
                <select value={g.status} onChange={(e) => setStatus(g, e.target.value)} className={`status status-${g.status}`}>
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                </select>
                <ExportButtons path={`/goals/${g.id}`} compact />
                <button className="icon-btn" onClick={() => del(g.id)} aria-label="刪除目標">🗑</button>
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
                ⚙ {open.runtime.label || open.runtime.mode}{open.runtime.fallback ? ' · 備援' : ''}
              </span>
              {open.runtime.live && !open.runtime.fallback && (
                <span className="runtime-badge" title={open.runtime.note || ''}>
                  {open.runtime.engine === 'openclaw-cli'
                    ? `🦞 真實子代理 ${open.runtime.liveTurns}/${open.runtime.totalTurns} 回合${open.runtime.model ? ` · ${open.runtime.model}` : ''}`
                    : `🤖 內建多代理即時 ${open.runtime.liveTurns}/${open.runtime.totalTurns} 回合${open.runtime.model ? ` · ${open.runtime.model}` : ''}`}
                </span>
              )}
              {open.grounding?.length > 0 && <span className="runtime-badge">📚 {open.grounding.length} 筆知識依據</span>}
            </div>
          )}
          {open.description && <p className="muted">{open.description}</p>}

          <div className="upload-box">
            <div className="interject-row">
              <input
                placeholder="修訂指示（選填）——例如「把時程壓到 6 週，聚焦行動端」"
                value={rerunNote}
                onChange={(e) => setRerunNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') rerunGoal(); }}
                disabled={rerunning}
              />
              <button className="btn-ghost sm" onClick={rerunGoal} disabled={rerunning}>
                {rerunning ? '重新執行中…' : '🔄 重新執行'}
              </button>
            </div>
            {rerunning && progress && (
              <p className="muted sm">
                ⚡ {progress.phase || `各負責人重新認領中 ${progress.doneTasks.length}/${progress.total}…`}
              </p>
            )}
            {!rerunning && (
              <p className="muted sm">團隊會在前一版計畫的基礎上重新協作；結果會取代目前的任務拆解與協作產出。</p>
            )}
            {err && <div className="banner-err sm">{err}</div>}
          </div>

          <h4>任務拆解</h4>
          <div className="tasks">
            {open.tasks.map((t, i) => (
              <div key={i} className="task">
                <div className="task-badge">{t.order}</div>
                <div>
                  <div className="turn-who">{t.assignee} <span className="muted">· {t.role}</span></div>
                  <div><strong>{t.subtask}</strong></div>
                  <div className="muted">{t.approach}</div>

                  {t.deliverable ? (
                    <div className="task-deliverable">
                      <div className="turn-who">
                        📦 交付物
                        {t.deliverableToolCalls > 0 && <span className="tag" title="產出前自主查證的次數">🛠 {t.deliverableToolCalls} 次查證</span>}
                        {t.deliveredAt && <span className="muted sm"> · {new Date(t.deliveredAt).toLocaleString('zh-Hant')}</span>}
                      </div>
                      <Markdown text={t.deliverable} />
                      {(t.deliverableCitations || []).length > 0 && (
                        <div className="citations">
                          {t.deliverableCitations.map((c, ci) => (
                            <span key={ci} className="cite" title={c.snippet}>{c.web ? '🌐' : '📎'} {c.documentTitle}</span>
                          ))}
                        </div>
                      )}
                      <div className="row end">
                        <button className="btn-ghost sm" onClick={() => executeTask(t)} disabled={executing !== null}>
                          {executing === t.order ? '⏳ 重新執行中…' : '🔁 重新執行交付'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn sm" onClick={() => executeTask(t)} disabled={executing !== null}>
                        {executing === t.order ? '⏳ 執行中（查證需要時間）…' : '▶ 執行交付'}
                      </button>
                      {executing !== t.order && (
                        <span className="muted sm">讓 {t.assignee} 真的完成這項任務——上網查證並交出成品</span>
                      )}
                    </div>
                  )}
                </div>
                <span className={`status status-${t.status}`}>{STATUS_LABELS[t.status] || t.status}</span>
              </div>
            ))}
          </div>
          <h4>協作產出</h4>
          <div className="report"><Markdown text={open.output} /></div>

          {open.grounding?.length > 0 && (
            <>
              <h4>📚 使用的知識</h4>
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
  if (!totalPages || totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button className="btn-ghost btn-sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>← 上一頁</button>
      <span className="muted">第 {page} / {totalPages} 頁</span>
      <button className="btn-ghost btn-sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>下一頁 →</button>
    </div>
  );
}
