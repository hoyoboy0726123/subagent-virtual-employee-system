import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker, ExportButtons, Citations, ProgressBar } from '../components/ui.jsx';
import PixelOffice from '../components/PixelOffice.jsx';
import { fileToImagePart, imagesFromPaste, imagesFromDrop } from '../lib/image.js';

const DEFAULT_FILTERS = { q: '', participantId: '', runtime: '', live: '', sort: 'newest', page: 1, pageSize: 5 };

export default function MeetingsPage({ refreshKey, onChange, onActivity, gotoMeetingId, onGotoHandled }) {
  const [employees, setEmployees] = useState([]);
  const [meetingData, setMeetingData] = useState({ items: [], total: 0, page: 1, totalPages: 1 });
  const [open, setOpen] = useState(null); // meeting being viewed
  const [topic, setTopic] = useState('');
  const [rounds, setRounds] = useState(3);
  const [outputMode, setOutputMode] = useState('full'); // 'full' | 'conclusion'
  const [agenda, setAgenda] = useState('');
  const [agendaImages, setAgendaImages] = useState([]); // whiteboard photos to parse
  const [organizing, setOrganizing] = useState(false);
  const [quickMode, setQuickMode] = useState(false); // ⚡ quick meeting room
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // Phase 16 — the meeting room: a discussion the MANAGER is chairing right now.
  // { meetingId, topic, transcript: [], runId, streaming, phase }
  const [room, setRoom] = useState(null);
  // Tell the shell a discussion is live — the tab shows a dot, and the page is
  // kept mounted (not unmounted) on tab switches so the stream survives.
  useEffect(() => { onActivity?.(Boolean(room)); }, [room, onActivity]);

  const reload = async (next = filters) => {
    const [employeeList, meetings] = await Promise.all([
      api.get('/employees'),
      api.get(`/meetings?${new URLSearchParams(next).toString()}`),
    ]);
    setEmployees(employeeList);
    setMeetingData(meetings);
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

  // Shared SSE event handler: every segment (start / continue) feeds the room.
  const roomEvents = (evt) => {
    if (evt.type === 'run') setRoom((r) => ({ ...r, runId: evt.runId }));
    else if (evt.type === 'round') setRoom((r) => ({ ...r, phase: `第 ${evt.round} 輪 — ${evt.roundTitle}`, roundNo: evt.round, roundTitle: evt.roundTitle }));
    else if (evt.type === 'turn') setRoom((r) => ({ ...r, transcript: [...(r?.transcript || []), evt.turn] }));
    else if (evt.type === 'synthesizing') setRoom((r) => ({ ...r, phase: '主管代理正在統整決議與報告…' }));
    else if (evt.type === 'memory') setRoom((r) => ({ ...r, phase: '正在為每位員工沉澱會議記憶…' }));
  };

  // Phase 16: start a DISCUSSION — it stops after the rounds and waits for the
  // manager (you) to continue / interject / conclude.
  // Paste / drop a whiteboard photo to parse into agenda items.
  const addAgendaImages = async (files) => {
    const parts = await Promise.all(files.map((f) => fileToImagePart(f).catch(() => null)));
    setAgendaImages((cur) => [...cur, ...parts.filter(Boolean)].slice(0, 4));
  };
  const onAgendaPaste = (e) => { const f = imagesFromPaste(e); if (f.length) { e.preventDefault(); addAgendaImages(f); } };
  const onAgendaDrop = (e) => { const f = imagesFromDrop(e); if (f.length) { e.preventDefault(); addAgendaImages(f); } };

  // Manager agent tidies the pasted mess (and/or whiteboard photos) into bullets.
  const organizeAgenda = async () => {
    if ((!agenda.trim() && !agendaImages.length) || organizing) return;
    setErr('');
    setOrganizing(true);
    try {
      const res = await api.post('/meetings/organize-agenda', {
        text: agenda, topic,
        images: agendaImages.map((im) => ({ mimeType: im.mimeType, data: im.data })),
      });
      if (res.agenda) { setAgenda(res.agenda); setAgendaImages([]); }
    } catch (e) { setErr(e.message); } finally { setOrganizing(false); }
  };

  const run = async () => {
    setErr('');
    if (!topic.trim() || selected.length === 0) {
      setErr('請輸入主題並至少選擇一位員工。');
      return;
    }
    setBusy(true);
    setRoom({ meetingId: null, topic, transcript: [], runId: null, streaming: true, phase: '準備中…' });
    try {
      const { meeting } = await api.stream(
        '/meetings/discuss/stream',
        {
          topic, participantIds: selected, rounds: Number(rounds),
          outputMode: quickMode ? 'conclusion' : outputMode, agenda, quick: quickMode,
        },
        roomEvents,
      );
      setTopic(''); setSelected([]); setAgenda('');
      setRoom((r) => ({
        ...r, meetingId: meeting.id, transcript: meeting.transcript, streaming: false, runId: null, phase: null,
      }));
      onChange?.();
    } catch (e) {
      // Keep the room (and everything already said) visible — the discussion
      // segment may already be persisted as 'discussing'; dropping the room
      // here made the streamed turns vanish in front of the user.
      setErr(e.message);
      setRoom((r) => (r ? { ...r, streaming: false, runId: null, phase: null } : r));
    } finally { setBusy(false); }
  };

  const continueRounds = async () => {
    if (!room?.meetingId) return;
    setErr('');
    setRoom((r) => ({ ...r, streaming: true, phase: '討論繼續…' }));
    try {
      const { meeting } = await api.stream(`/meetings/${room.meetingId}/continue/stream`, { rounds: 1 }, roomEvents);
      setRoom((r) => ({ ...r, transcript: meeting.transcript, streaming: false, runId: null, phase: null }));
      onChange?.();
    } catch (e) {
      setErr(e.message);
      setRoom((r) => (r ? { ...r, streaming: false, runId: null, phase: null } : r));
    }
  };

  const interject = async (text) => {
    if (!text.trim()) return;
    const res = await api.post('/meetings/interject', {
      meetingId: room?.meetingId, runId: room?.runId, text,
    });
    // Stored notes append immediately; live ones arrive through the stream.
    if (res.delivery === 'stored' && res.turn) {
      setRoom((r) => ({ ...r, transcript: [...r.transcript, res.turn] }));
    }
  };

  // Call on ONE employee to speak next (optional question). Runs a real turn;
  // the returned turn is appended to the room.
  const callOn = async (employeeId, question) => {
    if (!room?.meetingId) return;
    const res = await api.post(`/meetings/${room.meetingId}/call-on`, { employeeId, question });
    if (res.turn) setRoom((r) => ({ ...r, transcript: [...r.transcript, res.turn] }));
  };

  const conclude = async () => {
    if (!room?.meetingId) return;
    setErr('');
    setRoom((r) => ({ ...r, streaming: true, phase: '主管代理正在統整決議與報告…' }));
    try {
      const { meeting } = await api.stream(`/meetings/${room.meetingId}/conclude/stream`, {}, roomEvents);
      setRoom(null);
      onChange?.();
      setOpen(meeting);
    } catch (e) {
      setErr(e.message);
      setRoom((r) => (r ? { ...r, streaming: false, phase: null } : r));
    }
  };

  // Force convergence: up to 3 decision-focused rounds, then auto-conclude.
  const convergeConclude = async (rounds = 3) => {
    if (!room?.meetingId) return;
    setErr('');
    setRoom((r) => ({ ...r, streaming: true, phase: `限時收斂：最多 ${rounds} 輪內收斂出結論並結束…` }));
    try {
      const { meeting } = await api.stream(`/meetings/${room.meetingId}/converge/stream`, { rounds }, roomEvents);
      setRoom(null);
      onChange?.();
      setOpen(meeting);
    } catch (e) {
      setErr(e.message);
      setRoom((r) => (r ? { ...r, streaming: false, phase: null } : r));
    }
  };

  // List rows are lightweight (no transcript/report) — fetch the full record on
  // click, either into the read-only view or back into the meeting room.
  const openMeeting = async (m) => {
    try { setOpen(await api.get(`/meetings/${m.id}`)); } catch (e) { setErr(e.message); }
  };
  const reopenRoom = async (m) => {
    try {
      const full = await api.get(`/meetings/${m.id}`);
      setRoom({ meetingId: full.id, topic: full.topic, transcript: full.transcript, runId: null, streaming: false, phase: null });
    } catch (e) { setErr(e.message); }
  };

  // Close-the-loop: another tab (GoalsPage「帶成果回會議」) asked us to jump straight
  // into a specific meeting's room. Open it AND auto-run one discussion round so the
  // team immediately reacts to the 成果回報 turn (instead of sitting paused waiting
  // for the manager to click 繼續討論) — that automatic reaction IS the whole point
  // of feeding results back. It then pauses so the manager can converge/conclude.
  useEffect(() => {
    if (!gotoMeetingId) return;
    const id = gotoMeetingId;
    onGotoHandled?.();
    (async () => {
      setErr('');
      try {
        const full = await api.get(`/meetings/${id}`);
        setRoom({ meetingId: full.id, topic: full.topic, transcript: full.transcript, runId: null, streaming: true, phase: '團隊正在檢視上一輪成果…' });
        reload(filters);
        const { meeting } = await api.stream(`/meetings/${id}/continue/stream`, { rounds: 1 }, roomEvents);
        setRoom((r) => (r ? { ...r, transcript: meeting.transcript, streaming: false, runId: null, phase: null } : r));
        onChange?.();
      } catch (e) {
        setErr(e.message);
        setRoom((r) => (r ? { ...r, streaming: false, runId: null, phase: null } : r));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoMeetingId]);

  // Reopen a CONCLUDED meeting (mirrors the 1on1): status flips back to
  // 'discussing' and the room opens on the same transcript — continue,
  // interject, and conclude again (which REPLACES the minutes/report).
  const reopenConcluded = async (m) => {
    setErr('');
    try {
      const fresh = await api.post(`/meetings/${m.id}/reopen`);
      setOpen(null);
      setRoom({ meetingId: fresh.id, topic: fresh.topic, transcript: fresh.transcript, runId: null, streaming: false, phase: null });
      onChange?.(); // list badge: concluded → 討論中
    } catch (e) { setErr(e.message); }
  };

  const del = async (id) => { await api.del(`/meetings/${id}`); onChange?.(); };
  const patchFilters = (patch) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const meetings = meetingData.items || [];

  return (
    <div className="page">
      <div className="page-head"><div><h2>會議</h2><p className="muted">召集員工、設定主題並展開討論。你會得到逐字紀錄、會議記錄與報告。</p></div></div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>召開會議</h3>
          <div className="seg">
            <button className={`seg-btn${!quickMode ? ' on' : ''}`} onClick={() => setQuickMode(false)}>🧠 深度討論</button>
            <button className={`seg-btn${quickMode ? ' on' : ''}`} onClick={() => setQuickMode(true)}>⚡ 快速會議室</button>
          </div>
        </div>
        {quickMode && (
          <p className="muted sm" style={{ margin: '8px 0 0' }}>
            快速會議：員工只用角色身分快速給看法（不深入知識庫、不查資料），主管代理產出<strong>初步結論</strong>，不產待辦。適合先要一個方向。
          </p>
        )}
        {err && <div className="banner-err">{err}</div>}
        <label className="block">主題
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="例如：第三季路線圖的取捨" />
        </label>
        <label className="block">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span>待討論事項（選填）</span>
            <button
              className="btn-ghost sm"
              onClick={organizeAgenda}
              disabled={organizing || (!agenda.trim() && !agendaImages.length)}
              title="把雜亂貼上的文字，或任意截圖／照片／文件影像，用主管代理整理成條列式待討論事項（圖片辨識需 Gemini 金鑰）"
            >
              {organizing ? '⏳ 整理中…' : '✨ 整理成條列'}
            </button>
          </div>
          <div onPaste={onAgendaPaste} onDrop={onAgendaDrop} onDragOver={(e) => e.preventDefault()}>
            {agendaImages.length > 0 && (
              <div className="pending-images">
                {agendaImages.map((im, j) => (
                  <div key={j} className="pending-image">
                    <img src={im.dataUrl} alt="白板照片" />
                    <button className="pending-image-x" onClick={() => setAgendaImages((cur) => cur.filter((_, k) => k !== j))} title="移除">✕</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              rows={4}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="貼上雜亂的文字、片段訊息，或直接貼上/拖入任意截圖、照片、白板、文件影像…按「✨ 整理成條列」讓主管代理整理成待討論事項。會議會針對這些逐項收斂。"
            />
          </div>
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
          {!quickMode && (
            <label className="inline" title="完整＝決議＋可派成目標的待辦；結論＝只收斂出最終方案、不產待辦，討論也更聚焦不發散">
              產出
              <select value={outputMode} onChange={(e) => setOutputMode(e.target.value)}>
                <option value="full">完整（決議＋待辦）</option>
                <option value="conclusion">結論（只給方案，不產待辦）</option>
              </select>
            </label>
          )}
          <button className="btn" onClick={run} disabled={busy || Boolean(room)} title={room ? '請先結束目前開著的會議室' : ''}>
            {busy ? '開場中…' : '▶ 開始會議'}
          </button>
        </div>
        {busy && <ProgressBar label="員工代理正在依序發言，請稍候…" />}
      </div>

      {room && (
        <MeetingRoom
          room={room}
          employees={employees}
          selectedIds={selected}
          onInterject={interject}
          onCallOn={callOn}
          onContinue={continueRounds}
          onConverge={convergeConclude}
          onConclude={conclude}
          onLeave={() => setRoom(null)}
        />
      )}

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
                <button
                  className="list-main"
                  onClick={() => (m.status === 'discussing' ? reopenRoom(m) : openMeeting(m))}
                >
                  <strong>
                    {m.status === 'discussing' && <span className="tag tag-live">🟢 討論中</span>}
                    {m.topic}
                  </strong>
                  <span className="muted">
                    {(m.participants || []).map((p) => p.name).join('、')} · {new Date(m.createdAt).toLocaleString('zh-Hant')}
                    {m.groundingCount ? ` · 📚 ${m.groundingCount} 筆知識依據` : ''}
                  </span>
                </button>
                {m.status !== 'discussing' && <ExportButtons path={`/meetings/${m.id}`} compact />}
                <button className="icon-btn" onClick={() => del(m.id)} aria-label="刪除會議">🗑</button>
              </div>
            ))}
          </div>
          <Pagination page={meetingData.page} totalPages={meetingData.totalPages} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      )}

      {open && <MeetingView meeting={open} onClose={() => setOpen(null)} onReopen={() => reopenConcluded(open)} onChange={onChange} />}
    </div>
  );
}

// A single transcript turn — shared by the live meeting room and the archive
// view. Manager (human) turns render distinctly from employee agents. Memoized
// (C5): in a long/streaming transcript, already-rendered turns keep a stable
// `t` reference, so they skip re-render when the room's input state changes.
const TurnRow = React.memo(function TurnRow({ t }) {
  if (t.isManager) {
    return (
      <div className="turn turn-manager">
        <div className="turn-av turn-av-manager">👔</div>
        <div>
          <div className="turn-who">主管 <span className="muted">· 你</span></div>
          <div className="turn-text">{t.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="turn">
      <div className="turn-av">{t.speaker.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
      <div>
        <div className="turn-who">
          {t.speaker} <span className="muted">· {t.role}</span>
          {t.pickedBy === 'manager' && (
            <span className="tag" title={t.managerQuestion ? `主管代理追問：${t.managerQuestion}` : '主管代理點名發言'}>👔 點名</span>
          )}
          {t.toolCalls > 0 && <span className="tag" title="此發言前，代理自主查詢了知識庫／網路">🛠 {t.toolCalls} 次查證</span>}
        </div>
        {t.managerQuestion && <div className="muted turn-question">主管代理追問：「{t.managerQuestion}」</div>}
        <div className="turn-text">{t.text}</div>
        <Citations items={t.citations} />
      </div>
    </div>
  );
});

// Phase 16 — the meeting room. The discussion never ends on its own: the
// MANAGER (the user) interjects to steer, continues for more rounds, and
// decides when to conclude into minutes + report.
function MeetingRoom({ room, employees = [], selectedIds = [], onInterject, onCallOn, onContinue, onConverge, onConclude, onLeave }) {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [callTarget, setCallTarget] = useState('');
  const [callQuestion, setCallQuestion] = useState('');
  const [calling, setCalling] = useState(false);
  // Pixel office: shown by default, collapsible for users who want to focus on
  // the transcript. Preference persists across meetings.
  const [showOffice, setShowOffice] = useState(() => {
    try { return localStorage.getItem('veemp.showOffice') !== '0'; } catch { return true; }
  });
  const toggleOffice = () => setShowOffice((v) => {
    const next = !v;
    try { localStorage.setItem('veemp.showOffice', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  const endRef = React.useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [room.transcript.length]);

  // Who sits in the pixel office: everyone invited (new meeting) plus anyone
  // who has actually spoken (covers opened/reopened meetings without `selected`).
  const participants = useMemo(() => {
    const map = new Map();
    const byId = new Map(employees.map((e) => [e.id, e.name]));
    for (const id of selectedIds) if (byId.has(id)) map.set(id, byId.get(id));
    for (const t of room.transcript) if (t.speakerId && t.speakerId !== 'manager') map.set(t.speakerId, t.speaker);
    return [...map].map(([id, name]) => ({ id, name }));
  }, [employees, selectedIds, room.transcript]);

  // The current typist: the most recent non-manager speaker, but only while the
  // discussion is streaming — otherwise everyone just sits.
  const active = useMemo(() => {
    if (!room.streaming) return null;
    const last = [...room.transcript].reverse().find((t) => t.speakerId && t.speakerId !== 'manager');
    if (!last) return null;
    return { speakerId: last.speakerId, tool: last.toolCalls > 0 ? '查資料' : null, task: (last.text || '').slice(0, 60) };
  }, [room.streaming, room.transcript]);

  // Colleagues NOT in this meeting — the office picks 2–3 of them to wander in
  // the background so the room stays alive while participants sit.
  const wanderPool = useMemo(() => {
    const inMeeting = new Set(participants.map((p) => p.id));
    return employees.filter((e) => !inMeeting.has(e.id)).map((e) => ({ id: e.id, name: e.name }));
  }, [employees, participants]);

  const send = async () => {
    if (!note.trim() || sending) return;
    setSending(true);
    try { await onInterject(note); setNote(''); } finally { setSending(false); }
  };

  const callOn = async () => {
    if (!callTarget || calling) return;
    setCalling(true);
    try { await onCallOn(callTarget, callQuestion.trim()); setCallQuestion(''); }
    finally { setCalling(false); }
  };

  return (
    <div className="panel meeting-room">
      <div className="meeting-room-head">
        <div className="meeting-room-title">
          <h3>🗣️ 會議室：{room.topic}</h3>
          <div className="meeting-status-row">
            {room.streaming
              ? <span className="tag tag-live">🟢 進行中</span>
              : <span className="tag tag-wait">🟡 討論暫停 · 等待主管指示</span>}
          </div>
          <div className="meeting-round-line">
            {room.streaming
              ? (room.roundNo != null
                  ? `📍 第 ${room.roundNo} 輪${room.roundTitle ? ` · ${room.roundTitle}` : ''}`
                  : `📍 ${room.phase || '準備中…'}`)
              : '⏸ 討論到一段落——你可以繼續討論、收斂結束，或直接結束產出報告。'}
          </div>
        </div>
        {!room.streaming && (
          <button className="btn-ghost sm" onClick={onLeave} title="先離開，稍後可從過往會議列表回來繼續">離開會議室</button>
        )}
      </div>

      <div className="office-toggle-bar">
        <button className="btn-ghost sm" onClick={toggleOffice}>
          {showOffice ? '▾ 收折像素辦公室' : '▸ 展開像素辦公室'}
        </button>
      </div>
      {showOffice && <PixelOffice participants={participants} wanderPool={wanderPool} active={active} />}

      <div className={`live-progress meeting-room-transcript${showOffice ? '' : ' office-collapsed'}`}>
        {room.transcript.length === 0 && <p className="muted">（尚無發言）</p>}
        <div className="live-progress-turns">
          {room.transcript.map((t, i) => <TurnRow key={i} t={t} />)}
          <div ref={endRef} />
        </div>
      </div>

      <div className="meeting-room-controls">
        <div className="callon-row">
          <select value={callTarget} onChange={(e) => setCallTarget(e.target.value)} disabled={calling || room.streaming}>
            <option value="">👉 點名某位員工發言…</option>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            placeholder="（可留空）想問他的問題…"
            value={callQuestion}
            onChange={(e) => setCallQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') callOn(); }}
            disabled={calling || room.streaming}
          />
          <button className="btn sm" onClick={callOn} disabled={calling || room.streaming || !callTarget}>
            {calling ? '請他發言中…' : '📢 點名發言'}
          </button>
        </div>
        {calling && <ProgressBar label="被點名的員工正在思考回應…" />}
        <div className="interject-row">
          <input
            placeholder="以主管身分插話——員工會把這視為最高優先的討論方向…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          <button className="btn sm" onClick={send} disabled={sending || !note.trim()}>💬 插話</button>
        </div>
        {room.streaming ? (
          <ProgressBar label={room.phase || '主管代理處理中，請稍候…'} />
        ) : (
          <div className="row end">
            <button className="btn-ghost" onClick={onContinue} disabled={!room.meetingId}>
              ▶ 繼續討論 1 輪
            </button>
            <button
              className="btn-ghost"
              onClick={() => onConverge(3)}
              disabled={!room.meetingId}
              title="讓代理在最多 3 輪內收斂出決議與待辦，然後自動結束——避免無限發散"
            >
              🏁 3 輪內收斂並結束
            </button>
            <button className="btn" onClick={onConclude} disabled={!room.meetingId}>
              ✅ 直接結束，產出決議與報告
            </button>
          </div>
        )}
        <p className="muted sm">
          {room.streaming
            ? '討論進行中也可以插話——下一位發言者開口前就會看到你的指示。'
            : '會議不會自行結束：你可以插話後繼續討論，滿意了再產出報告。'}
        </p>
      </div>
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

function MeetingView({ meeting, onClose, onReopen, onChange }) {
  const [view, setView] = useState('transcript');
  const [spin, setSpin] = useState({ busy: false, msg: '', err: '' });
  const rounds = [...new Set(meeting.transcript.map((t) => t.round))];

  // How many action items have an owner who is an actual participant (only
  // those become tasks) — drives the "派成目標" affordance.
  const partNames = new Set((meeting.participants || []).map((p) => p.name));
  const assignable = (meeting.minutes?.actionItems || []).filter((a) => partNames.has(a.owner));

  const spinOffGoal = async () => {
    setSpin({ busy: true, msg: '', err: '' });
    try {
      const goal = await api.post(`/goals/from-meeting/${meeting.id}`);
      setSpin({ busy: false, msg: `已建立目標「${goal.title}」（${goal.tasks.length} 項任務）——切到「🎯 目標」分頁，逐項按「執行交付」讓負責人完成。`, err: '' });
      onChange?.(); // the new goal shows at the top of the goals list
    } catch (e) {
      setSpin({ busy: false, msg: '', err: e.message });
    }
  };

  return (
    <Modal title={`🗓️ ${meeting.topic}`} onClose={onClose} wide>
      <div className="view-meta">
        <RuntimeBadge runtime={meeting.runtime} />
        <ExportButtons path={`/meetings/${meeting.id}`} />
        {onReopen && meeting.status !== 'discussing' && (
          <button
            className="btn-ghost sm"
            onClick={onReopen}
            title="重新打開討論——團隊在原逐字稿上繼續；下次作結會以完整討論重寫決議與報告"
          >
            🔄 重啟討論
          </button>
        )}
        {assignable.length > 0 && (
          <button
            className="btn sm"
            onClick={spinOffGoal}
            disabled={spin.busy}
            title="把會議的行動項目變成可執行的目標——每項指派給負責人，之後在「目標」分頁按「執行交付」讓他們實際完成"
          >
            {spin.busy ? '建立中…' : `🎯 派成目標（${assignable.length}）`}
          </button>
        )}
      </div>
      {spin.err && <div className="banner-err sm">{spin.err}</div>}
      {spin.msg && <div className="banner-ok sm">{spin.msg}</div>}
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
                {turns.map((t, i) => <TurnRow key={i} t={t} />)}
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
          {assignable.length > 0 && (
            <p className="muted sm">💡 上方「🎯 派成目標」會把這些行動項目變成可執行的任務。</p>
          )}
        </div>
      )}

      {view === 'report' && <div className="report"><Markdown text={meeting.report} /></div>}

      {view === 'knowledge' && <Grounding grounding={meeting.grounding} />}
    </Modal>
  );
}
