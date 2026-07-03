import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker } from '../components/ui.jsx';

const STATUSES = ['in-progress', 'blocked', 'done'];

export default function GoalsPage({ refreshKey }) {
  const [employees, setEmployees] = useState([]);
  const [goals, setGoals] = useState([]);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ title: '', description: '' });
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reload = () => Promise.all([
    api.get('/employees').then(setEmployees),
    api.get('/goals').then(setGoals),
  ]);
  useEffect(() => { reload(); }, [refreshKey]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const assign = async () => {
    setErr('');
    if (!form.title.trim() || selected.length === 0) {
      setErr('Enter a goal title and select at least one employee.');
      return;
    }
    setBusy(true);
    try {
      const g = await api.post('/goals', { ...form, assigneeIds: selected });
      setForm({ title: '', description: '' }); setSelected([]);
      await api.get('/goals').then(setGoals);
      setOpen(g);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const setStatus = async (goal, status) => {
    const updated = await api.put(`/goals/${goal.id}`, { status });
    setGoals((gs) => gs.map((g) => (g.id === goal.id ? updated : g)));
    if (open?.id === goal.id) setOpen(updated);
  };

  const del = async (id) => { await api.del(`/goals/${id}`); reload(); };

  return (
    <div className="page">
      <div className="page-head"><div><h2>Goals</h2><p className="muted">Assign a goal to one or more employees. They split the work by expertise and produce a collaboration output.</p></div></div>

      <div className="panel">
        <h3>Assign a goal</h3>
        {err && <div className="banner-err">{err}</div>}
        <label className="block">Goal title
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Launch the private beta" />
        </label>
        <label className="block">Description (optional)
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Context, constraints, deadline…" />
        </label>
        <label className="block">Assignees
          {employees.length === 0
            ? <p className="muted">Create employees first.</p>
            : <EmployeePicker employees={employees} selected={selected} toggle={toggle} />}
        </label>
        <div className="row end">
          <button className="btn" onClick={assign} disabled={busy}>{busy ? 'Assigning…' : '🎯 Assign & collaborate'}</button>
        </div>
      </div>

      <h3 className="section-title">Active goals</h3>
      {goals.length === 0 ? (
        <Empty>No goals yet.</Empty>
      ) : (
        <div className="list">
          {goals.map((g) => (
            <div key={g.id} className="list-item">
              <button className="list-main" onClick={() => setOpen(g)}>
                <strong>{g.title}</strong>
                <span className="muted">{(g.assignees || []).map((p) => p.name).join(', ')} · {g.tasks?.length || 0} task(s)</span>
              </button>
              <select value={g.status} onChange={(e) => setStatus(g, e.target.value)} className={`status status-${g.status}`}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="icon-btn" onClick={() => del(g.id)} aria-label="Delete goal">🗑</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal title={`🎯 ${open.title}`} onClose={() => setOpen(null)} wide>
          {open.runtime?.mode && (
            <div className="view-meta">
              <span className={`runtime-badge ${open.runtime.fallback ? 'runtime-fallback' : ''}`} title={open.runtime.note || ''}>
                ⚙ {open.runtime.label || open.runtime.mode}{open.runtime.fallback ? ' · fallback' : ''}
              </span>
              {open.grounding?.length > 0 && <span className="runtime-badge">📚 {open.grounding.length} grounded</span>}
            </div>
          )}
          {open.description && <p className="muted">{open.description}</p>}
          <h4>Task breakdown</h4>
          <div className="tasks">
            {open.tasks.map((t, i) => (
              <div key={i} className="task">
                <div className="task-badge">{t.order}</div>
                <div>
                  <div className="turn-who">{t.assignee} <span className="muted">· {t.role}</span></div>
                  <div><strong>{t.subtask}</strong></div>
                  <div className="muted">{t.approach}</div>
                </div>
                <span className={`status status-${t.status}`}>{t.status}</span>
              </div>
            ))}
          </div>
          <h4>Collaboration output</h4>
          <div className="report"><Markdown text={open.output} /></div>

          {open.grounding?.length > 0 && (
            <>
              <h4>📚 Knowledge used</h4>
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
