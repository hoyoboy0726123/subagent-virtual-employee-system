import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker, ExportButtons } from '../components/ui.jsx';

const DEFAULT_FILTERS = { q: '', participantId: '', runtime: '', live: '', sort: 'newest', page: 1, pageSize: 5 };

export default function MeetingsPage({ refreshKey, onChange }) {
  const [employees, setEmployees] = useState([]);
  const [meetingData, setMeetingData] = useState({ items: [], total: 0, page: 1, totalPages: 1 });
  const [open, setOpen] = useState(null); // meeting being viewed
  const [topic, setTopic] = useState('');
  const [rounds, setRounds] = useState(3);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Live progress while the multi-agent meeting streams (Phase 15).
  const [progress, setProgress] = useState(null); // { phase, round, roundTitle, turns: [] }

  const reload = async (next = filters) => {
    const [employeeList, meetings] = await Promise.all([
      api.get('/employees'),
      api.get(`/meetings?${new URLSearchParams(next).toString()}`),
    ]);
    setEmployees(employeeList);
    setMeetingData(meetings);
  };
  useEffect(() => { reload(DEFAULT_FILTERS); setFilters(DEFAULT_FILTERS); }, [refreshKey]);
  useEffect(() => { reload(filters); }, [filters]);

  const toggle = (id) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const run = async () => {
    setErr('');
    if (!topic.trim() || selected.length === 0) {
      setErr('請輸入主題並至少選擇一位員工。');
      return;
    }
    setBusy(true);
    setProgress({ phase: '準備中…', round: 0, roundTitle: '', turns: [] });
    try {
      const { meeting } = await api.stream(
        '/meetings/stream',
        { topic, participantIds: selected, rounds: Number(rounds) },
        (evt) => {
          if (evt.type === 'round') {
            setProgress((p) => ({ ...p, phase: null, round: evt.round, rounds: evt.rounds, roundTitle: evt.roundTitle }));
          } else if (evt.type === 'turn') {
            setProgress((p) => ({ ...p, turns: [...(p?.turns || []), evt.turn] }));
          } else if (evt.type === 'synthesizing') {
            setProgress((p) => ({ ...p, phase: '主管代理正在統整報告…' }));
          } else if (evt.type === 'memory') {
            setProgress((p) => ({ ...p, phase: '正在為每位員工沉澱會議記憶…' }));
          }
        },
      );
      setTopic(''); setSelected([]);
      onChange?.();
      setOpen(meeting);
    } catch (e) { setErr(e.message); } finally { setBusy(false); setProgress(null); }
  };

  const del = async (id) => { await api.del(`/meetings/${id}`); onChange?.(); };
  const patchFilters = (patch) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const meetings = meetingData.items || [];

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

        {busy && progress && (
          <div className="live-progress">
            <div className="live-progress-head">
              {progress.phase
                ? <span>⏳ {progress.phase}</span>
                : <span>🗣️ 第 {progress.round}/{progress.rounds} 輪 — {progress.roundTitle}（已 {progress.turns.length} 則發言）</span>}
            </div>
            <div className="live-progress-turns">
              {progress.turns.slice(-6).map((t, i) => (
                <div key={i} className="turn">
                  <div className="turn-av">{t.speaker.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
                  <div>
                    <div className="turn-who">
                      {t.speaker} <span className="muted">· {t.role}</span>
                      {t.pickedBy === 'manager' && <span className="tag" title={t.managerQuestion ? `主管追問：${t.managerQuestion}` : '主管代理點名'}>👔 點名</span>}
                      {t.toolCalls > 0 && <span className="tag" title="此發言前代理自主查詢了資料">🛠 {t.toolCalls}</span>}
                    </div>
                    <div className="turn-text">{t.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="section-head">
        <h3 className="section-title">過往會議</h3>
        <span className="muted">共 {meetingData.total || 0} 筆</span>
      </div>
      <div className="toolbar panel">
        <div className="toolbar-grid toolbar-grid-meetings">
          <label>搜尋
            <input value={filters.q} onChange={(e) => patchFilters({ q: e.target.value })} placeholder="主題、與會者、報告內容" />
          </label>
          <label>與會者
            <select value={filters.participantId} onChange={(e) => patchFilters({ participantId: e.target.value })}>
              <option value="">全部</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>執行模式
            <select value={filters.runtime} onChange={(e) => patchFilters({ runtime: e.target.value })}>
              <option value="">全部</option>
              <option value="standalone">內建多代理</option>
              <option value="openclaw">OpenClaw</option>
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
              <option value="topic-asc">主題 A→Z</option>
              <option value="topic-desc">主題 Z→A</option>
            </select>
          </label>
          <label>每頁
            <select value={filters.pageSize} onChange={(e) => patchFilters({ pageSize: Number(e.target.value) })}>
              {[5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {meetings.length === 0 ? (
        <Empty>目前沒有符合條件的會議。</Empty>
      ) : (
        <>
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
                <ExportButtons path={`/meetings/${m.id}`} compact />
                <button className="icon-btn" onClick={() => del(m.id)} aria-label="刪除會議">🗑</button>
              </div>
            ))}
          </div>
          <Pagination page={meetingData.page} totalPages={meetingData.totalPages} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}

      {open && <MeetingView meeting={open} onClose={() => setOpen(null)} />}
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

function RuntimeBadge({ runtime }) {
  if (!runtime?.mode) return null;
  const label = runtime.label || runtime.mode;
  const live = runtime.live && !runtime.fallback;
  const isOpenClaw = runtime.engine === 'openclaw-cli';
  const liveText = isOpenClaw
    ? `🦞 真實子代理 ${runtime.liveTurns}/${runtime.totalTurns} 回合${runtime.model ? ` · ${runtime.model}` : ''}`
    : `🤖 內建多代理即時 ${runtime.liveTurns}/${runtime.totalTurns} 回合${runtime.model ? ` · ${runtime.model}` : ''}`;
  return (
    <>
      <span className={`runtime-badge ${runtime.fallback ? 'runtime-fallback' : ''}`} title={runtime.note || ''}>
        ⚙ {label}{runtime.fallback ? ' · 備援' : ''}
      </span>
      {live && (
        <span className="runtime-badge" title={runtime.note || ''}>
          {liveText}
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
      <div className="view-meta">
        <RuntimeBadge runtime={meeting.runtime} />
        <ExportButtons path={`/meetings/${meeting.id}`} />
      </div>
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
                      <div className="turn-who">
                        {t.speaker} <span className="muted">· {t.role}</span>
                        {t.pickedBy === 'manager' && (
                          <span className="tag" title={t.managerQuestion ? `主管追問：${t.managerQuestion}` : '主管代理點名發言'}>👔 點名</span>
                        )}
                        {t.toolCalls > 0 && (
                          <span className="tag" title="此發言前，代理自主查詢了知識庫／網路">🛠 {t.toolCalls} 次查證</span>
                        )}
                      </div>
                      {t.managerQuestion && <div className="muted turn-question">主管追問：「{t.managerQuestion}」</div>}
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
