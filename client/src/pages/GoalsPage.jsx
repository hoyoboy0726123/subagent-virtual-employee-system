import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker } from '../components/ui.jsx';

const STATUSES = ['in-progress', 'blocked', 'done'];
const STATUS_LABELS = { 'in-progress': '進行中', blocked: '受阻', done: '已完成' };

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
      setErr('請輸入目標標題並至少選擇一位員工。');
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
          <button className="btn" onClick={assign} disabled={busy}>{busy ? '指派中…' : '🎯 指派並協作'}</button>
        </div>
      </div>

      <h3 className="section-title">進行中的目標</h3>
      {goals.length === 0 ? (
        <Empty>尚無目標。</Empty>
      ) : (
        <div className="list">
          {goals.map((g) => (
            <div key={g.id} className="list-item">
              <button className="list-main" onClick={() => setOpen(g)}>
                <strong>{g.title}</strong>
                <span className="muted">{(g.assignees || []).map((p) => p.name).join('、')} · {g.tasks?.length || 0} 項任務</span>
              </button>
              <select value={g.status} onChange={(e) => setStatus(g, e.target.value)} className={`status status-${g.status}`}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
              </select>
              <button className="icon-btn" onClick={() => del(g.id)} aria-label="刪除目標">🗑</button>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal title={`🎯 ${open.title}`} onClose={() => setOpen(null)} wide>
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
          <h4>任務拆解</h4>
          <div className="tasks">
            {open.tasks.map((t, i) => (
              <div key={i} className="task">
                <div className="task-badge">{t.order}</div>
                <div>
                  <div className="turn-who">{t.assignee} <span className="muted">· {t.role}</span></div>
                  <div><strong>{t.subtask}</strong></div>
                  <div className="muted">{t.approach}</div>
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
