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
      setErr('Enter a topic and select at least one employee.');
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
      <div className="page-head"><div><h2>Meetings</h2><p className="muted">Summon employees, set a topic, and run a discussion. You get a transcript, minutes, and a report.</p></div></div>

      <div className="panel">
        <h3>Convene a meeting</h3>
        {err && <div className="banner-err">{err}</div>}
        <label className="block">Topic
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Q3 roadmap trade-offs" />
        </label>
        <label className="block">Participants
          {employees.length === 0
            ? <p className="muted">Create employees first.</p>
            : <EmployeePicker employees={employees} selected={selected} toggle={toggle} />}
        </label>
        <div className="row">
          <label className="inline">Rounds
            <select value={rounds} onChange={(e) => setRounds(e.target.value)}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn" onClick={run} disabled={busy}>{busy ? 'Running discussion…' : '▶ Run meeting'}</button>
        </div>
      </div>

      <h3 className="section-title">Past meetings</h3>
      {meetings.length === 0 ? (
        <Empty>No meetings yet.</Empty>
      ) : (
        <div className="list">
          {meetings.map((m) => (
            <div key={m.id} className="list-item">
              <button className="list-main" onClick={() => setOpen(m)}>
                <strong>{m.topic}</strong>
                <span className="muted">{(m.participants || []).map((p) => p.name).join(', ')} · {new Date(m.createdAt).toLocaleString()}</span>
              </button>
              <button className="icon-btn" onClick={() => del(m.id)} aria-label="Delete meeting">🗑</button>
            </div>
          ))}
        </div>
      )}

      {open && <MeetingView meeting={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function MeetingView({ meeting, onClose }) {
  const [view, setView] = useState('transcript');
  const rounds = [...new Set(meeting.transcript.map((t) => t.round))];

  return (
    <Modal title={`🗓️ ${meeting.topic}`} onClose={onClose} wide>
      <div className="subtabs">
        {['transcript', 'minutes', 'report'].map((v) => (
          <button key={v} className={view === v ? 'subtab on' : 'subtab'} onClick={() => setView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {view === 'transcript' && (
        <div className="transcript">
          {rounds.map((r) => {
            const turns = meeting.transcript.filter((t) => t.round === r);
            return (
              <div key={r} className="round">
                <div className="round-title">Round {r} — {turns[0]?.roundTitle}</div>
                {turns.map((t, i) => (
                  <div key={i} className="turn">
                    <div className="turn-av">{t.speaker.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
                    <div>
                      <div className="turn-who">{t.speaker} <span className="muted">· {t.role}</span></div>
                      <div className="turn-text">{t.text}</div>
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
          <h4>Attendees</h4>
          <ul>{meeting.minutes.attendees.map((a) => <li key={a}>{a}</li>)}</ul>
          <h4>Agenda</h4>
          <ul>{meeting.minutes.agenda.map((a) => <li key={a}>{a}</li>)}</ul>
          <h4>Key points</h4>
          <ul>{meeting.minutes.keyPoints.map((a, i) => <li key={i}>{a.replace(/^- /, '')}</li>)}</ul>
          <h4>Decisions</h4>
          <ul>{meeting.minutes.decisions.map((a, i) => <li key={i}>{a.replace(/^- /, '')}</li>)}</ul>
          <h4>Action items</h4>
          <ul>{meeting.minutes.actionItems.map((a, i) => <li key={i}><strong>{a.owner}</strong> — {a.action} <span className="muted">(due: {a.due})</span></li>)}</ul>
        </div>
      )}

      {view === 'report' && <div className="report"><Markdown text={meeting.report} /></div>}
    </Modal>
  );
}
