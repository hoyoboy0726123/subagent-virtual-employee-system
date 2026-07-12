import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, EmployeePicker, ExportButtons, Citations, ProgressBar } from '../components/ui.jsx';
import PixelOffice from '../components/PixelOffice.jsx';
import { fileToImagePart, imagesFromPaste, imagesFromDrop } from '../lib/image.js';
import { useI18n } from '../i18n.jsx';

const DEFAULT_FILTERS = { q: '', participantId: '', runtime: '', live: '', sort: 'newest', page: 1, pageSize: 5 };

export default function MeetingsPage({ refreshKey, onChange, onActivity, gotoMeetingId, onGotoHandled }) {
  const { t } = useI18n();
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
    else if (evt.type === 'round') setRoom((r) => ({ ...r, phase: t('meetings.roundPhase', { round: evt.round, title: evt.roundTitle }), roundNo: evt.round, roundTitle: evt.roundTitle }));
    else if (evt.type === 'turn') setRoom((r) => ({ ...r, transcript: [...(r?.transcript || []), evt.turn] }));
    else if (evt.type === 'synthesizing') setRoom((r) => ({ ...r, phase: t('meetings.synthesizingPhase') }));
    else if (evt.type === 'memory') setRoom((r) => ({ ...r, phase: t('meetings.memoryPhase') }));
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

  // Upload a MEETING RECORDING → the dedicated Gemini audio model transcribes it
  // into agenda bullets (large files route through the Files API server-side).
  const [transcribing, setTranscribing] = useState(false);
  const audioInputRef = useRef(null);
  const transcribeAudio = async (file) => {
    if (!file || transcribing) return;
    setErr('');
    setTranscribing(true);
    try {
      const res = await api.upload('/meetings/transcribe-audio', file, 'file', { topic });
      if (res.agenda) setAgenda((cur) => (cur.trim() ? `${cur.trim()}\n${res.agenda}` : res.agenda));
    } catch (e) { setErr(e.message); } finally {
      setTranscribing(false);
      if (audioInputRef.current) audioInputRef.current.value = '';
    }
  };

  const run = async () => {
    setErr('');
    if (!topic.trim() || selected.length === 0) {
      setErr(t('meetings.errNeedTopicAndOne'));
      return;
    }
    setBusy(true);
    setRoom({ meetingId: null, topic, transcript: [], runId: null, streaming: true, phase: t('meetings.preparingProgress') });
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
    setRoom((r) => ({ ...r, streaming: true, phase: t('meetings.continuingPhase') }));
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
    setRoom((r) => ({ ...r, streaming: true, phase: t('meetings.concludingPhase') }));
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
    setRoom((r) => ({ ...r, streaming: true, phase: t('meetings.convergePhase', { rounds }) }));
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
  // into a specific meeting's room. Open it, let the team react to the 成果回報 turn,
  // and CONVERGE TO A FINAL CONCLUSION — the meeting is now in 結論 mode (set server
  // -side on review), so this produces a decision-only report with NO new action
  // items. That truly closes the loop: delivered results → final decision, instead
  // of spawning yet another round of tasks (which would never end). Lands on the
  // report; if the manager wants to keep going they can 重啟討論.
  useEffect(() => {
    if (!gotoMeetingId) return;
    const id = gotoMeetingId;
    onGotoHandled?.();
    (async () => {
      setErr('');
      try {
        const full = await api.get(`/meetings/${id}`);
        setRoom({ meetingId: full.id, topic: full.topic, transcript: full.transcript, runId: null, streaming: true, phase: t('meetings.gotoConvergePhase') });
        reload(filters);
        const { meeting } = await api.stream(`/meetings/${id}/converge/stream`, { rounds: 2 }, roomEvents);
        setRoom(null);
        onChange?.();
        setOpen(meeting); // show the final 結論 report (no 派成目標 — the loop is closed)
      } catch (e) {
        setErr(e.message);
        setRoom((r) => (r ? { ...r, streaming: false, runId: null, phase: null } : r));
      }
    })();
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
      <div className="page-head"><div><h2>{t('meetings.pageTitle')}</h2><p className="muted">{t('meetings.pageDesc')}</p></div></div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>{t('meetings.startMeetingTitle')}</h3>
          <div className="seg">
            <button className={`seg-btn${!quickMode ? ' on' : ''}`} onClick={() => setQuickMode(false)}>{t('meetings.deepDiscussTab')}</button>
            <button className={`seg-btn${quickMode ? ' on' : ''}`} onClick={() => setQuickMode(true)}>{t('meetings.quickRoomTab')}</button>
          </div>
        </div>
        {quickMode && (
          <p className="muted sm" style={{ margin: '8px 0 0' }}>
            {t('meetings.quickModeDesc')}<strong>{t('meetings.quickModeDescBold')}</strong>{t('meetings.quickModeDescEnd')}
          </p>
        )}
        {err && <div className="banner-err">{err}</div>}
        <label className="block">{t('meetings.topicLabel')}
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t('meetings.topicPlaceholder')} />
        </label>
        <label className="block">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('meetings.agendaLabel')}</span>
            <div className="row" style={{ gap: 6, margin: 0 }}>
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm"
                style={{ display: 'none' }}
                onChange={(e) => transcribeAudio(e.target.files?.[0])}
              />
              <button
                className="btn-ghost sm"
                onClick={() => audioInputRef.current?.click()}
                disabled={transcribing || organizing}
                title={t('meetings.transcribeAudioTitle')}
              >
                {transcribing ? t('meetings.transcribingBtn') : t('meetings.transcribeAudioBtn')}
              </button>
              <button
                className="btn-ghost sm"
                onClick={organizeAgenda}
                disabled={organizing || (!agenda.trim() && !agendaImages.length)}
                title={t('meetings.organizeAgendaTitle')}
              >
                {organizing ? t('meetings.organizingBtn') : t('meetings.organizeBtn')}
              </button>
            </div>
          </div>
          <div onPaste={onAgendaPaste} onDrop={onAgendaDrop} onDragOver={(e) => e.preventDefault()}>
            {agendaImages.length > 0 && (
              <div className="pending-images">
                {agendaImages.map((im, j) => (
                  <div key={j} className="pending-image">
                    <img src={im.dataUrl} alt={t('meetings.whiteboardAlt')} />
                    <button className="pending-image-x" onClick={() => setAgendaImages((cur) => cur.filter((_, k) => k !== j))} title={t('meetings.removeImageTitle')}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              rows={4}
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder={t('meetings.agendaPlaceholder')}
            />
          </div>
        </label>
        <label className="block">{t('meetings.participantsLabel')}
          {employees.length === 0
            ? <p className="muted">{t('meetings.noEmployeesYet')}</p>
            : <EmployeePicker employees={employees} selected={selected} toggle={toggle} />}
        </label>
        <div className="row">
          <label className="inline">{t('meetings.roundsLabel')}
            <select value={rounds} onChange={(e) => setRounds(e.target.value)}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {!quickMode && (
            <label className="inline" title={t('meetings.outputModeTitle')}>
              {t('meetings.outputModeLabel')}
              <select value={outputMode} onChange={(e) => setOutputMode(e.target.value)}>
                <option value="full">{t('meetings.outputFull')}</option>
                <option value="conclusion">{t('meetings.outputConclusion')}</option>
              </select>
            </label>
          )}
          <button className="btn" onClick={run} disabled={busy || Boolean(room)} title={room ? t('meetings.startDisabledTitle') : ''}>
            {busy ? t('meetings.startingBtn') : t('meetings.startMeetingBtn')}
          </button>
        </div>
        {busy && <ProgressBar label={t('meetings.startingProgress')} />}
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
        <h3 className="section-title">{t('meetings.pastMeetingsHeading')}</h3>
        <span className="muted">{t('meetings.totalCount', { n: meetingData.total || 0 })}</span>
      </div>
      <div className="toolbar panel">
        <div className="toolbar-grid toolbar-grid-meetings">
          <label>{t('meetings.searchLabel')}
            <input value={filters.q} onChange={(e) => patchFilters({ q: e.target.value })} placeholder={t('meetings.searchPlaceholder')} />
          </label>
          <label>{t('meetings.participantFilterLabel')}
            <select value={filters.participantId} onChange={(e) => patchFilters({ participantId: e.target.value })}>
              <option value="">{t('meetings.allOption')}</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>{t('meetings.liveFilterLabel')}
            <select value={filters.live} onChange={(e) => patchFilters({ live: e.target.value })}>
              <option value="">{t('meetings.allOption')}</option>
              <option value="true">{t('meetings.liveOption')}</option>
              <option value="false">{t('meetings.offlineOption')}</option>
            </select>
          </label>
          <label>{t('meetings.sortLabel')}
            <select value={filters.sort} onChange={(e) => patchFilters({ sort: e.target.value })}>
              <option value="newest">{t('meetings.sortNewest')}</option>
              <option value="oldest">{t('meetings.sortOldest')}</option>
              <option value="topic-asc">{t('meetings.sortTopicAsc')}</option>
              <option value="topic-desc">{t('meetings.sortTopicDesc')}</option>
            </select>
          </label>
          <label>{t('meetings.perPageLabel')}
            <select value={filters.pageSize} onChange={(e) => patchFilters({ pageSize: Number(e.target.value) })}>
              {[5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </div>

      {meetings.length === 0 ? (
        <Empty>{t('meetings.emptyMeetings')}</Empty>
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
                    {m.status === 'discussing' && <span className="tag tag-live">{t('meetings.liveTag')}</span>}
                    {m.topic}
                  </strong>
                  <span className="muted">
                    {(m.participants || []).map((p) => p.name).join('、')} · {new Date(m.createdAt).toLocaleString('zh-Hant')}
                    {m.groundingCount ? t('meetings.groundingCountSuffix', { n: m.groundingCount }) : ''}
                  </span>
                </button>
                {m.status !== 'discussing' && <ExportButtons path={`/meetings/${m.id}`} compact />}
                <button className="icon-btn" onClick={() => del(m.id)} aria-label={t('meetings.deleteMeetingAria')}>🗑</button>
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
const TurnRow = React.memo(function TurnRow({ t: turn }) {
  const { t } = useI18n();
  if (turn.isManager) {
    return (
      <div className="turn turn-manager">
        <div className="turn-av turn-av-manager">👔</div>
        <div>
          <div className="turn-who">{t('meetings.managerLabel')} <span className="muted">{t('meetings.youSuffix')}</span></div>
          <div className="turn-text">{turn.text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="turn">
      <div className="turn-av">{turn.speaker.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
      <div>
        <div className="turn-who">
          {turn.speaker} <span className="muted">· {turn.role}</span>
          {turn.pickedBy === 'manager' && (
            <span className="tag" title={turn.managerQuestion ? t('meetings.calledOnByManager', { q: turn.managerQuestion }) : t('meetings.calledOnDefaultTitle')}>{t('meetings.calledOnTag')}</span>
          )}
          {turn.toolCalls > 0 && <span className="tag" title={t('meetings.toolCallsTitle')}>{t('meetings.toolCallsTag', { n: turn.toolCalls })}</span>}
        </div>
        {turn.managerQuestion && <div className="muted turn-question">{t('meetings.managerQuestionLine', { q: turn.managerQuestion })}</div>}
        <div className="turn-text">{turn.text}</div>
        <Citations items={turn.citations} />
      </div>
    </div>
  );
});

// Phase 16 — the meeting room. The discussion never ends on its own: the
// MANAGER (the user) interjects to steer, continues for more rounds, and
// decides when to conclude into minutes + report.
function MeetingRoom({ room, employees = [], selectedIds = [], onInterject, onCallOn, onContinue, onConverge, onConclude, onLeave }) {
  const { t } = useI18n();
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
    return { speakerId: last.speakerId, tool: last.toolCalls > 0 ? t('meetings.lookingUpDataTag') : null, task: (last.text || '').slice(0, 60) };
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
          <h3>{t('meetings.roomTitle', { topic: room.topic })}</h3>
          <div className="meeting-status-row">
            {room.streaming
              ? <span className="tag tag-live">{t('meetings.liveTagRoom')}</span>
              : <span className="tag tag-wait">{t('meetings.pausedTag')}</span>}
          </div>
          <div className="meeting-round-line">
            {room.streaming
              ? (room.roundNo != null
                  ? (room.roundTitle ? t('meetings.roundLine', { round: room.roundNo, title: room.roundTitle }) : t('meetings.roundLineNoTitle', { round: room.roundNo }))
                  : t('meetings.preparingLine', { phase: room.phase || t('meetings.preparingProgress') }))
              : t('meetings.pausedLine')}
          </div>
        </div>
        {!room.streaming && (
          <button className="btn-ghost sm" onClick={onLeave} title={t('meetings.leaveRoomTitle')}>{t('meetings.leaveRoomBtn')}</button>
        )}
      </div>

      <div className="office-toggle-bar">
        <button className="btn-ghost sm" onClick={toggleOffice}>
          {showOffice ? t('meetings.collapseOfficeBtn') : t('meetings.expandOfficeBtn')}
        </button>
      </div>
      {showOffice && <PixelOffice participants={participants} wanderPool={wanderPool} active={active} />}

      <div className={`live-progress meeting-room-transcript${showOffice ? '' : ' office-collapsed'}`}>
        {room.transcript.length === 0 && <p className="muted">{t('meetings.noTranscript')}</p>}
        <div className="live-progress-turns">
          {room.transcript.map((turn, i) => <TurnRow key={i} t={turn} />)}
          <div ref={endRef} />
        </div>
      </div>

      <div className="meeting-room-controls">
        <div className="callon-row">
          <select value={callTarget} onChange={(e) => setCallTarget(e.target.value)} disabled={calling || room.streaming}>
            <option value="">{t('meetings.callOnPlaceholderOption')}</option>
            {participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input
            placeholder={t('meetings.callQuestionPlaceholder')}
            value={callQuestion}
            onChange={(e) => setCallQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') callOn(); }}
            disabled={calling || room.streaming}
          />
          <button className="btn sm" onClick={callOn} disabled={calling || room.streaming || !callTarget}>
            {calling ? t('meetings.callingBtn') : t('meetings.callOnBtn')}
          </button>
        </div>
        {calling && <ProgressBar label={t('meetings.callingProgress')} />}
        <div className="interject-row">
          <input
            placeholder={t('meetings.interjectPlaceholder')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          <button className="btn sm" onClick={send} disabled={sending || !note.trim()}>{t('meetings.interjectBtn')}</button>
        </div>
        {room.streaming ? (
          <ProgressBar label={room.phase || t('meetings.processingProgress')} />
        ) : (
          <div className="row end">
            <button className="btn-ghost" onClick={onContinue} disabled={!room.meetingId}>
              {t('meetings.continueRoundBtn')}
            </button>
            <button
              className="btn-ghost"
              onClick={() => onConverge(3)}
              disabled={!room.meetingId}
              title={t('meetings.convergeTitle')}
            >
              {t('meetings.convergeBtn')}
            </button>
            <button className="btn" onClick={onConclude} disabled={!room.meetingId}>
              {t('meetings.concludeBtn')}
            </button>
          </div>
        )}
        <p className="muted sm">
          {room.streaming
            ? t('meetings.hintWhileStreaming')
            : t('meetings.hintWhilePaused')}
        </p>
      </div>
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

function RuntimeBadge({ runtime }) {
  const { t } = useI18n();
  if (!runtime?.mode) return null;
  const label = runtime.label || runtime.mode;
  const live = runtime.live && !runtime.fallback;
  const isOpenClaw = runtime.engine === 'openclaw-cli';
  const liveTextKey = isOpenClaw ? 'meetings.openClawLiveText' : 'meetings.builtinLiveText';
  const liveText = t(liveTextKey, { live: runtime.liveTurns, total: runtime.totalTurns }) + (runtime.model ? t('meetings.modelSuffix', { model: runtime.model }) : '');
  return (
    <>
      <span className={`runtime-badge ${runtime.fallback ? 'runtime-fallback' : ''}`} title={runtime.note || ''}>
        ⚙ {label}{runtime.fallback ? t('meetings.runtimeFallbackSuffix') : ''}
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
  const { t } = useI18n();
  if (!grounding?.length) {
    return <p className="muted">{t('meetings.noGroundingHint')}</p>;
  }
  return (
    <div className="grounding">
      <p className="muted">{t('meetings.groundingHint')}</p>
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

function MeetingView({ meeting, onClose, onReopen, onChange }) {
  const { t } = useI18n();
  const SUBTAB_LABELS = {
    transcript: t('meetings.subtabTranscript'), minutes: t('meetings.subtabMinutes'),
    report: t('meetings.subtabReport'), knowledge: t('meetings.subtabKnowledge'),
  };
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
      const replaced = goal.replacedPrevious > 0
        ? t('meetings.spinOffReplaced') : '';
      setSpin({ busy: false, msg: t('meetings.spinOffOk', { replaced, title: goal.title, count: goal.tasks.length }), err: '' });
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
            title={t('meetings.reopenTitle')}
          >
            {t('meetings.reopenBtn')}
          </button>
        )}
        {assignable.length > 0 && (
          <button
            className="btn sm"
            onClick={spinOffGoal}
            disabled={spin.busy}
            title={t('meetings.spinOffTitle')}
          >
            {spin.busy ? t('meetings.spinOffCreating') : t('meetings.spinOffBtn', { n: assignable.length })}
          </button>
        )}
      </div>
      {spin.err && <div className="banner-err sm">{spin.err}</div>}
      {spin.msg && <div className="banner-ok sm">{spin.msg}</div>}
      <div className="subtabs">
        {['transcript', 'minutes', 'report', 'knowledge'].map((v) => (
          <button key={v} className={view === v ? 'subtab on' : 'subtab'} onClick={() => setView(v)}>
            {v === 'knowledge' ? t('meetings.subtabKnowledgeCount', { n: meeting.grounding?.length || 0 }) : SUBTAB_LABELS[v]}
          </button>
        ))}
      </div>

      {view === 'transcript' && (
        <div className="transcript">
          {rounds.map((r) => {
            const turns = meeting.transcript.filter((tr) => tr.round === r);
            return (
              <div key={r} className="round">
                <div className="round-title">{t('meetings.roundHeading', { round: r, title: turns[0]?.roundTitle })}</div>
                {turns.map((turn, i) => <TurnRow key={i} t={turn} />)}
              </div>
            );
          })}
        </div>
      )}

      {view === 'minutes' && (
        <div className="minutes">
          <h4>{t('meetings.attendeesHeading')}</h4>
          <ul>{meeting.minutes.attendees.map((a) => <li key={a}>{a}</li>)}</ul>
          <h4>{t('meetings.agendaHeading')}</h4>
          <ul>{meeting.minutes.agenda.map((a) => <li key={a}>{a}</li>)}</ul>
          <h4>{t('meetings.keyPointsHeading')}</h4>
          <ul>{meeting.minutes.keyPoints.map((a, i) => <li key={i}>{a.replace(/^- /, '')}</li>)}</ul>
          <h4>{t('meetings.decisionsHeading')}</h4>
          <ul>{meeting.minutes.decisions.map((a, i) => <li key={i}>{a.replace(/^- /, '')}</li>)}</ul>
          <h4>{t('meetings.actionItemsHeading')}</h4>
          <ul>{meeting.minutes.actionItems.map((a, i) => <li key={i}><strong>{a.owner}</strong> — {a.action} <span className="muted">{t('meetings.dueLabel', { due: a.due })}</span></li>)}</ul>
          {assignable.length > 0 && (
            <p className="muted sm">{t('meetings.spinOffHint')}</p>
          )}
        </div>
      )}

      {view === 'report' && <div className="report"><Markdown text={meeting.report} /></div>}

      {view === 'knowledge' && <Grounding grounding={meeting.grounding} />}
    </Modal>
  );
}
