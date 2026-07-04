import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker } from '../components/ui.jsx';

export default function MeetingsPage({ refreshKey }) {
  const [employees, setEmployees] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [open, setOpen] = useState(null); // meeting being viewed
  const [topic, setTopic] = useState('');
  const [rounds, setRounds] = useState(3);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const reload = () => Promise.all([
    api.get('/employees').then(setEmployees),
    api.get('/meetings').then(setMeetings),
  ]);
  useEffect(() => { reload(); }, [refreshKey]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const run = async () => {
    setErr('');
    if (!topic.trim() || selected.length === 0) {
      setErr('請輸入主題並至少選擇一位員工。');
      return;
    }
    setBusy(true);
    try {
      const m = await api.post('/meetings', { topic, participantIds: selected, rounds: Number(rounds) });
      setTopic(''); setSelected([]);
      await api.get('/meetings').then(setMeetings);
      setOpen(m);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const del = async (id) => { await api.del(`/meetings/${id}`); reload(); };

  return (
    <div className="page">
      <div className="page-head"><div><h2>會議</h2><p className="muted">召集員工、設定主題並展開討論。你會得到逐字紀錄、會議記錄與報告。</p></div></div>

      <div className="panel">
        <h3>召開會議</h3>
        {err && <div className="banner-err">{err}</div>}
        <label className="block">主題
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：第三季路線圖的取捨" />
        </label>
        <label className="block">與會者
          {employees.length === 0
            ? <p className="muted">請先建立員工。</p>
            : <EmployeePicker employees={employees} selected={selected} toggle={toggle} />}
        </label>
        <div className="row">
          <label className="inline">輪數
            <select value={rounds} onChange={(e) => setRounds(e.target.value)}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn" onClick={run} disabled={busy}>{busy ? '討論進行中…' : '▶ 開始會議'}</button>
        </div>
      </div>

      <h3 className="section-title">過往會議</h3>
      {meetings.length === 0 ? (
        <Empty>尚無會議。</Empty>
      ) : (
        <div className="list">
          {meetings.map((m) => (
            <div key={m.id} className="list-item">
              <button className="list-main" onClick={() => setOpen(m)}>
                <strong>{m.topic}</strong>
                <span className="muted">
                  {(m.participants || []).map((p) => p.name).join('、')} · {new Date(m.createdAt).toLocaleString('zh-Hant')}
                  {m.grounding?.length ? ` · 📚 ${m.grounding.length} 筆知識依據` : ''}
                </span>
              </button>
              <button className="icon-btn" onClick={() => del(m.id)} aria-label="刪除會議">🗑</button>
            </div>
          ))}
        </div>
      )}

      {open && <MeetingView meeting={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RuntimeBadge({ runtime }) {
  if (!runtime?.mode) return null;
  const label = runtime.label || runtime.mode;
  const live = runtime.engine === 'openclaw-cli' && !runtime.fallback;
  return (
    <>
      <span className={`runtime-badge ${runtime.fallback ? 'runtime-fallback' : ''}`} title={runtime.note || ''}>
        ⚙ {label}{runtime.fallback ? ' · 備援' : ''}
      </span>
      {live && (
        <span className="runtime-badge" title={runtime.note || ''}>
          🦞 真實子代理 {runtime.liveTurns}/{runtime.totalTurns} 回合{runtime.model ? ` · ${runtime.model}` : ''}
        </span>
      )}
    </>
  );
}

function Grounding({ grounding }) {
  if (!grounding?.length) {
    return <p className="muted">此主題未檢索到任何知識片段。為與會者的知識庫新增筆記，即可作為未來討論的依據。</p>;
  }
  return (
    <div className="grounding">
      <p className="muted">以下知識片段（限定於與會者範圍）已被檢索並用來作為討論的依據：</p>
      <ul className="notes">
        {grounding.map((g) => (
          <li key={g.chunkId} className="note">
            <div>
              <strong>{g.documentTitle}</strong> <span className="muted">· {g.employeeName}</span>
              <p className="muted">{g.content}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SUBTAB_LABELS = { transcript: '逐字紀錄', minutes: '會議記錄', report: '報告', knowledge: '知識' };

function MeetingView({ meeting, onClose }) {
  const [view, setView] = useState('transcript');
  const rounds = [...new Set(meeting.transcript.map((t) => t.round))];

  return (
    <Modal title={`🗓️ ${meeting.topic}`} onClose={onClose} wide>
      <div className="view-meta"><RuntimeBadge runtime={meeting.runtime} /></div>
      <div className="subtabs">
        {['transcript', 'minutes', 'report', 'knowledge'].map((v) => (
          <button key={v} className={view === v ? 'subtab on' : 'subtab'} onClick={() => setView(v)}>
            {v === 'knowledge' ? `知識（${meeting.grounding?.length || 0}）` : SUBTAB_LABELS[v]}
          </button>
        ))}
      </div>

      {view === 'transcript' && (
        <div className="transcript">
          {rounds.map((r) => {
            const turns = meeting.transcript.filter((t) => t.round === r);
            return (
              <div key={r} className="round">
                <div className="round-title">第 {r} 輪 — {turns[0]?.roundTitle}</div>
                {turns.map((t, i) => (
                  <div key={i} className="turn">
                    <div className="turn-av">{t.speaker.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
                    <div>
                      <div className="turn-who">{t.speaker} <span className="muted">· {t.role}</span></div>
                      <div className="turn-text">{t.text}</div>
                      {t.citations?.length > 0 && (
                        <div className="citations">
                          {t.citations.map((c, ci) => (
                            <span key={ci} className="cite" title={c.snippet}>📎 {c.documentTitle}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {view === 'minutes' && (
        <div className="minutes">
          <h4>與會者</h4>
          <ul>{meeting.minutes.attendees.map((a) => <li key={a}>{a}</li>)}</ul>
          <h4>議程</h4>
          <ul>{meeting.minutes.agenda.map((a) => <li key={a}>{a}</li>)}</ul>
          <h4>重點</h4>
          <ul>{meeting.minutes.keyPoints.map((a, i) => <li key={i}>{a.replace(/^- /, '')}</li>)}</ul>
          <h4>決議</h4>
          <ul>{meeting.minutes.decisions.map((a, i) => <li key={i}>{a.replace(/^- /, '')}</li>)}</ul>
          <h4>行動項目</h4>
          <ul>{meeting.minutes.actionItems.map((a, i) => <li key={i}><strong>{a.owner}</strong> — {a.action} <span className="muted">（期限：{a.due}）</span></li>)}</ul>
        </div>
      )}

      {view === 'report' && <div className="report"><Markdown text={meeting.report} /></div>}

      {view === 'knowledge' && <Grounding grounding={meeting.grounding} />}
    </Modal>
  );
}
