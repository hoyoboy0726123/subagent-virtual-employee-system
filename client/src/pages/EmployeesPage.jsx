import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, ExportButtons, Citations, ProgressBar } from '../components/ui.jsx';
import { fileToImagePart, imagesFromPaste, imagesFromDrop } from '../lib/image.js';
import { speak, stopSpeaking, createRecognizer, ttsSupported, sttSupported } from '../lib/voice.js';
import { useI18n } from '../i18n.jsx';

// The upload types the server accepts. Kept in sync with SUPPORTED_TYPES —
// everything is canonicalized to Markdown by MarkItDown on ingestion.
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.markdown,.html,.htm';
const TYPE_LABELS = { pdf: 'PDF', docx: 'DOCX', pptx: 'PPTX', xlsx: 'XLSX', csv: 'CSV', txt: 'TXT', md: 'Markdown', html: 'HTML' };

const BLANK = {
  name: '', roleTitle: '', personality: '', expertise: '',
  objectives: '', communicationStyle: '', profile: '',
  agentModel: '', agentTemperature: '', agentWebSearch: true, agentMaxToolCalls: '',
};

export default function EmployeesPage({ refreshKey, onChange }) {
  const { t } = useI18n();
  const [employees, setEmployees] = useState([]);
  const [selected, setSelected] = useState(null); // employee detail
  const [editing, setEditing] = useState(null); // form state or null
  const [ideating, setIdeating] = useState(false);

  const reload = () => api.get('/employees').then(setEmployees);
  useEffect(() => { reload(); }, [refreshKey]);

  const openNew = () => setEditing({ ...BLANK });
  const openDetail = (e) => api.get(`/employees/${e.id}`).then(setSelected);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2>{t('employees.title')}</h2>
          <p className="muted">{t('employees.countLine', { n: employees.length })}</p>
        </div>
        <div className="actions">
          <button className="btn-ghost" onClick={() => setIdeating(true)}>{t('employees.ideateBtn')}</button>
          <button className="btn" onClick={openNew}>{t('employees.newBtn')}</button>
        </div>
      </div>

      {employees.length === 0 ? (
        <Empty>{t('employees.emptyList')}</Empty>
      ) : (
        <div className="grid">
          {employees.map((e) => (
            <button key={e.id} className="card" onClick={() => openDetail(e)}>
              <div className="card-avatar">{e.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
              <div className="card-main">
                <h3>{e.name}</h3>
                <p className="role">{e.roleTitle}</p>
                <p className="muted clamp">{e.personality || t('employees.noPersonality')}</p>
                <div className="tags">
                  {(Array.isArray(e.expertise) ? e.expertise : String(e.expertise).split(','))
                    .filter(Boolean).slice(0, 3)
                    .map((t) => <span key={t} className="tag">{String(t).trim()}</span>)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <EmployeeForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); }}
        />
      )}

      {ideating && (
        <IdeateModal
          onClose={() => setIdeating(false)}
          onDraft={(draft) => { setIdeating(false); setEditing(draft); }}
        />
      )}

      {selected && (
        <EmployeeDetail
          employee={selected}
          onClose={() => setSelected(null)}
          onChange={() => { openDetail(selected); onChange(); }}
          onEdit={() => { setEditing(toForm(selected)); setSelected(null); }}
          onDeleted={() => { setSelected(null); onChange(); }}
        />
      )}
    </div>
  );
}

const toForm = (e) => ({
  ...e,
  expertise: Array.isArray(e.expertise) ? e.expertise.join(', ') : e.expertise || '',
  agentModel: e.agentConfig?.model || '',
  agentTemperature: e.agentConfig?.temperature ?? '',
  agentWebSearch: e.agentConfig?.webSearch !== false,
  agentMaxToolCalls: e.agentConfig?.maxToolCalls ?? '',
});

function EmployeeForm({ initial, onClose, onSaved }) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (ev) => setForm({ ...form, [k]: ev.target.value });

  const payload = () => ({
    ...form,
    expertise: String(form.expertise).split(',').map((s) => s.trim()).filter(Boolean),
    agentConfig: {
      model: form.agentModel?.trim() || undefined,
      temperature: form.agentTemperature === '' ? undefined : Number(form.agentTemperature),
      webSearch: form.agentWebSearch === false ? false : undefined,
      maxToolCalls: form.agentMaxToolCalls === '' ? undefined : Number(form.agentMaxToolCalls),
    },
  });

  const genProfile = async () => {
    setBusy(true);
    try {
      const { profile } = await api.post('/employees/generate-profile', payload());
      setForm((f) => ({ ...f, profile }));
    } finally { setBusy(false); }
  };

  const save = async () => {
    setErr('');
    if (!form.name || !form.roleTitle) { setErr(t('employees.nameRequired')); return; }
    setBusy(true);
    try {
      if (form.id) await api.put(`/employees/${form.id}`, payload());
      else await api.post('/employees', payload());
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={form.id ? t('employees.editTitle') : t('employees.newTitle')} onClose={onClose} wide>
      {err && <div className="banner-err">{err}</div>}
      <div className="form-grid">
        <label>{t('employees.nameLabel')}<input value={form.name} onChange={set('name')} placeholder={t('employees.namePlaceholder')} /></label>
        <label>{t('employees.roleLabel')}<input value={form.roleTitle} onChange={set('roleTitle')} placeholder={t('employees.rolePlaceholder')} /></label>
        <label>{t('employees.personalityLabel')}<input value={form.personality} onChange={set('personality')} placeholder={t('employees.personalityPlaceholder')} /></label>
        <label>{t('employees.commStyleLabel')}<input value={form.communicationStyle} onChange={set('communicationStyle')} placeholder={t('employees.commStylePlaceholder')} /></label>
        <label className="col-2">{t('employees.expertiseLabel')}<input value={form.expertise} onChange={set('expertise')} placeholder={t('employees.expertisePlaceholder')} /></label>
        <label className="col-2">{t('employees.objectivesLabel')}<input value={form.objectives} onChange={set('objectives')} placeholder={t('employees.objectivesPlaceholder')} /></label>
      </div>

      <details className="agent-config">
        <summary>{t('employees.agentConfigSummary')}</summary>
        <div className="form-grid">
          <label>{t('employees.modelLabel')}
            <input
              value={form.agentModel}
              onChange={set('agentModel')}
              placeholder={t('employees.modelPlaceholder')}
            />
          </label>
          <label>{t('employees.temperatureLabel')}
            <input
              type="number" min="0" max="2" step="0.05"
              value={form.agentTemperature}
              onChange={set('agentTemperature')}
              placeholder={t('employees.temperaturePlaceholder')}
            />
          </label>
          <label>{t('employees.maxToolCallsLabel')}
            <input
              type="number" min="1" max="10" step="1"
              value={form.agentMaxToolCalls}
              onChange={set('agentMaxToolCalls')}
              placeholder={t('employees.maxToolCallsPlaceholder')}
            />
          </label>
          <label className="agent-config-check">
            <input
              type="checkbox"
              checked={form.agentWebSearch !== false}
              onChange={(ev) => setForm({ ...form, agentWebSearch: ev.target.checked })}
            />
            {t('employees.webSearchCheck')}
          </label>
        </div>
      </details>

      <div className="profile-head">
        <label className="profile-label">{t('employees.profileLabel')}</label>
        <button className="btn-ghost sm" onClick={genProfile} disabled={busy}>{t('employees.genProfileBtn')}</button>
      </div>
      <textarea
        className="profile-area"
        rows={8}
        value={form.profile}
        onChange={set('profile')}
        placeholder={t('employees.profilePlaceholder')}
      />

      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? t('employees.savingBtn') : t('employees.saveEmployeeBtn')}</button>
      </div>
    </Modal>
  );
}

function IdeateModal({ onClose, onDraft }) {
  const { t } = useI18n();
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const draft = async () => {
    setBusy(true);
    try {
      const d = await api.post('/employees/ideate', { description: desc });
      onDraft({
        ...BLANK,
        name: d.name,
        roleTitle: d.roleTitle,
        personality: d.personality,
        communicationStyle: d.communicationStyle,
        expertise: (d.expertise || []).join(', '),
        objectives: d.objectives,
        profile: d.profile,
      });
    } finally { setBusy(false); }
  };

  return (
    <Modal title={t('employees.ideateModalTitle')} onClose={onClose}>
      <p className="muted">{t('employees.ideateDesc')}</p>
      <textarea
        rows={4}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder={t('employees.ideatePlaceholder')}
      />
      {busy && <ProgressBar label={t('employees.ideateProgress')} />}
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button className="btn" onClick={draft} disabled={busy || !desc.trim()}>{busy ? t('employees.draftingBtn') : t('employees.draftBtn')}</button>
      </div>
    </Modal>
  );
}

function EmployeeDetail({ employee, onClose, onChange, onEdit, onDeleted }) {
  const { t } = useI18n();
  const [note, setNote] = useState({ title: '', content: '' });
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState({ busy: false, err: '', ok: '' });
  const [viewDoc, setViewDoc] = useState(null); // knowledge viewer (doc + chunks)
  const [oneOnOne, setOneOnOne] = useState(false); // 1-on-1 chat modal (Phase 19)
  const [consolidating, setConsolidating] = useState({ busy: false, msg: '', err: '' }); // D3
  const fileRef = useRef(null);

  // How many accumulated memory docs this employee has (drives the consolidate CTA).
  const memoryCount = (employee.knowledge || []).filter((k) => k.source === 'memory').length;

  const openDoc = async (docId) => {
    try { setViewDoc(await api.get(`/knowledge/${docId}`)); } catch { /* ignore */ }
  };

  const addNote = async () => {
    if (!note.content.trim()) return;
    setBusy(true);
    try {
      await api.post(`/employees/${employee.id}/knowledge`, note);
      setNote({ title: '', content: '' });
      onChange();
    } finally { setBusy(false); }
  };

  const onPickFile = async (ev) => {
    const file = ev.target.files?.[0];
    if (fileRef.current) fileRef.current.value = ''; // allow re-selecting the same file
    if (!file) return;
    setUpload({ busy: true, err: '', ok: '' });
    try {
      const doc = await api.upload(`/employees/${employee.id}/knowledge/upload`, file);
      const via = doc.metadata?.parser === 'markitdown' ? 'MarkItDown' : t('employees.viaBuiltIn');
      setUpload({ busy: false, err: '', ok: t('employees.uploadedOk', { title: doc.title, via, count: doc.chunkCount }) });
      onChange();
    } catch (e) {
      setUpload({ busy: false, err: e.message, ok: '' });
    }
  };

  const delNote = async (kid) => { await api.del(`/knowledge/${kid}`); onChange(); };

  // Merge this employee's accumulated memories into one de-duplicated memory
  // (D3). Non-destructive on the server — originals are archived, not deleted.
  const consolidate = async () => {
    setConsolidating({ busy: true, msg: '', err: '' });
    try {
      const res = await api.post(`/employees/${employee.id}/memory/consolidate`);
      if (res.skipped) {
        const why = res.skipped === 'disabled' ? t('employees.consolidateDisabled')
          : res.skipped === 'nothing-to-merge' ? t('employees.consolidateNothing')
          : t('employees.consolidateBelowThreshold');
        setConsolidating({ busy: false, msg: why, err: '' });
      } else {
        const via = res.method === 'live' ? t('employees.viaAi') : t('employees.viaOfflineDedup');
        setConsolidating({ busy: false, msg: t('employees.consolidatedOk', { count: res.mergedCount, via }), err: '' });
        onChange();
      }
    } catch (e) {
      setConsolidating({ busy: false, msg: '', err: e.message });
    }
  };

  const remove = async () => {
    if (!confirm(t('employees.deleteConfirm', { name: employee.name }))) return;
    await api.del(`/employees/${employee.id}`);
    onDeleted();
  };

  return (
    <Modal title={`${employee.name} — ${employee.roleTitle}`} onClose={onClose} wide>
      <div className="detail">
        <section>
          <div className="detail-meta">
            {employee.personality && <span className="tag">🧠 {employee.personality}</span>}
            {employee.communicationStyle && <span className="tag">💬 {employee.communicationStyle}</span>}
          </div>
          {employee.objectives && <p><strong>{t('employees.objectivesPrefix')}</strong> {employee.objectives}</p>}
          <div className="tags">
            {(employee.expertise || []).map((ex) => <span key={ex} className="tag tag-blue">{ex}</span>)}
          </div>
          <h4>{t('employees.backgroundHeading')}</h4>
          <div className="profile-box"><Markdown text={employee.profile} /></div>
        </section>

        <section>
          <h4>{t('employees.knowledgeHeading')} <span className="count">{employee.knowledge?.length || 0}</span></h4>

          <div className="upload-box">
            <div className="upload-row">
              <button
                className="btn-ghost sm"
                onClick={() => fileRef.current?.click()}
                disabled={upload.busy}
              >
                {upload.busy ? t('employees.uploadingBtn') : t('employees.uploadBtn')}
              </button>
              <span className="muted upload-hint">{t('employees.uploadHint')}</span>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPT}
                onChange={onPickFile}
                style={{ display: 'none' }}
              />
            </div>
            {upload.err && <div className="banner-err sm">{upload.err}</div>}
            {upload.ok && <div className="banner-ok sm">{upload.ok}</div>}
          </div>

          {memoryCount >= 2 && (
            <div className="upload-box">
              <div className="upload-row">
                <button className="btn-ghost sm" onClick={consolidate} disabled={consolidating.busy}>
                  {consolidating.busy ? t('employees.consolidatingBtn') : t('employees.consolidateBtn', { count: memoryCount })}
                </button>
                <span className="muted upload-hint">
                  {t('employees.consolidateHint')}
                </span>
              </div>
              {consolidating.busy && <ProgressBar label={t('employees.consolidateProgress')} />}
              {consolidating.err && <div className="banner-err sm">{consolidating.err}</div>}
              {consolidating.msg && <div className="banner-ok sm">{consolidating.msg}</div>}
            </div>
          )}

          <div className="note-form">
            <input
              placeholder={t('employees.noteTitlePlaceholder')}
              value={note.title}
              onChange={(e) => setNote({ ...note, title: e.target.value })}
            />
            <textarea
              rows={2}
              placeholder={t('employees.noteContentPlaceholder')}
              value={note.content}
              onChange={(e) => setNote({ ...note, content: e.target.value })}
            />
            <button className="btn sm" onClick={addNote} disabled={busy || !note.content.trim()}>{t('employees.addNoteBtn')}</button>
          </div>
          <ul className="notes">
            {(employee.knowledge || []).map((k) => (
              <li key={k.id} className="note">
                <div
                  className="note-open"
                  role="button"
                  tabIndex={0}
                  title={t('employees.noteOpenTitle')}
                  onClick={() => openDoc(k.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openDoc(k.id); }}
                >
                  <strong>{k.title}</strong>
                  {k.source === 'file' && (
                    <span className="tag tag-blue" title={k.metadata?.originalFilename || ''}>
                      📄 {TYPE_LABELS[k.metadata?.sourceType] || t('employees.fileTag')}
                    </span>
                  )}
                  {k.source === 'memory' && (
                    k.metadata?.consolidated ? (
                      <span className="tag tag-blue" title={t('employees.consolidatedFromTitle', { count: k.metadata.mergedCount || t('employees.manyFallback') })}>
                        {t('employees.consolidatedTag')}
                      </span>
                    ) : (
                      <span className="tag" title={k.metadata?.topic ? t('employees.fromMeetingTitle', { topic: k.metadata.topic }) : t('employees.agentMemoryTitle')}>
                        {t('employees.memoryTag')}
                      </span>
                    )
                  )}
                  {k.source === 'research' && (
                    <span className="tag tag-blue" title={t('employees.researchApprovedTitle')}>{t('employees.researchTag')}</span>
                  )}
                  {k.source === 'dialogue' && (
                    <span className="tag" title={t('employees.oneOnOneTitle')}>{t('employees.oneOnOneTag')}</span>
                  )}
                  {k.metadata?.parseStatus === 'fallback' && (
                    <span className="tag" title={k.metadata?.parseError || ''}>{t('employees.builtInExtractTag')}</span>
                  )}
                  {typeof k.chunkCount === 'number' && (
                    <span className="count" title={t('employees.chunksTitle')}>{t('employees.chunksCount', { count: k.chunkCount })}</span>
                  )}
                  {k.source === 'file' && k.metadata?.originalFilename && (
                    <p className="muted upload-file">{t('employees.sourcePrefix')}{k.metadata.originalFilename}</p>
                  )}
                  <p className="muted clamp">{k.content}</p>
                  {(k.tags || []).length > 0 && (
                    <div className="tags">{k.tags.map((tg) => <span key={tg} className="tag">{TYPE_LABELS[tg] || tg}</span>)}</div>
                  )}
                </div>
                <button className="icon-btn" onClick={() => delNote(k.id)} aria-label={t('employees.deleteDocAria')}>🗑</button>
              </li>
            ))}
            {(!employee.knowledge || employee.knowledge.length === 0) && (
              <li className="muted">{t('employees.noDocs')}</li>
            )}
          </ul>

          <ResearchSection employee={employee} onChange={onChange} />
        </section>
      </div>

      {viewDoc && (
        <DocViewer
          doc={viewDoc}
          onClose={() => setViewDoc(null)}
          onSaved={(updated) => { setViewDoc(updated); onChange(); }}
        />
      )}

      <div className="modal-actions between">
        <button className="btn-danger" onClick={remove}>{t('employees.deleteEmployeeBtn')}</button>
        <div className="actions">
          <button className="btn-ghost" onClick={() => setOneOnOne(true)}>{t('employees.oneOnOneBtn')}</button>
          <button className="btn" onClick={onEdit}>{t('employees.editProfileBtn')}</button>
        </div>
      </div>

      {oneOnOne && (
        <OneOnOneModal
          employee={employee}
          onClose={() => setOneOnOne(false)}
          onSaved={() => { setOneOnOne(false); onChange(); }}
        />
      )}
    </Modal>
  );
}

// Phase 19 — the manager's 1-on-1. No turn limit: the conversation continues
// until the MANAGER ends it, and only then do they choose whether the record
// is distilled into this employee's knowledge base.
function OneOnOneModal({ employee, onClose, onSaved }) {
  const { t } = useI18n();
  const [dialogue, setDialogue] = useState(null);
  const [history, setHistory] = useState(null); // null = loading; [] = none
  const [draft, setDraft] = useState('');
  const [pendingImages, setPendingImages] = useState([]); // [{mimeType, data, dataUrl}]
  const [busy, setBusy] = useState(false);

  // Paste / drop an image into the chat — downscaled client-side, attached to
  // the next message. Recognition runs on Gemini (forced) regardless of brain.
  const addImageFiles = async (files) => {
    const parts = await Promise.all(files.map((f) => fileToImagePart(f).catch(() => null)));
    setPendingImages((cur) => [...cur, ...parts.filter(Boolean)].slice(0, 4));
  };
  const onPasteImg = (e) => { const f = imagesFromPaste(e); if (f.length) { e.preventDefault(); addImageFiles(f); } };
  const onDropImg = (e) => { const f = imagesFromDrop(e); if (f.length) { e.preventDefault(); addImageFiles(f); } };
  const [closing, setClosing] = useState(false); // showing the save/discard choice
  const [err, setErr] = useState('');
  const endRef = useRef(null);

  // Entry: DON'T auto-create a dialogue (that littered empty records). Resume
  // the open one when it exists; otherwise show the start screen — new dialogue
  // or CONTINUE a past (closed) one right where it left off.
  useEffect(() => {
    api.get(`/employees/${employee.id}/dialogues`)
      .then((list) => {
        setHistory(list.filter((d) => d.status === 'closed'));
        const open = list.find((d) => d.status === 'open');
        if (open) setDialogue(open);
      })
      .catch((e) => setErr(e.message));
  }, [employee.id]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [dialogue?.transcript?.length, busy]);

  const startNew = async () => {
    try { setDialogue(await api.post(`/employees/${employee.id}/dialogue`)); } catch (e) { setErr(e.message); }
  };
  const continueOld = async (id) => {
    setErr('');
    try { setDialogue(await api.post(`/dialogues/${id}/reopen`)); } catch (e) { setErr(e.message); }
  };

  // send() takes an optional overrideText (used by Live 對談's speech result)
  // and RETURNS the employee's reply string so the caller can speak it aloud.
  const send = async (overrideText) => {
    const text = (overrideText ?? draft).trim();
    const images = overrideText != null ? [] : pendingImages;
    if ((!text && !images.length) || busy || !dialogue) return null;
    setErr('');
    setBusy(true);
    if (overrideText == null) { setDraft(''); setPendingImages([]); }
    // Optimistic echo of the manager's message (with any images) while thinking.
    setDialogue((d) => ({ ...d, transcript: [...d.transcript, { who: 'manager', text, images }] }));
    try {
      const updated = await api.post(`/dialogues/${dialogue.id}/messages`, {
        text,
        images: images.map((im) => ({ mimeType: im.mimeType, data: im.data })),
      });
      setDialogue(updated);
      const last = updated.transcript?.[updated.transcript.length - 1];
      return last && last.who !== 'manager' ? last.text : null; // the employee's reply
    } catch (e) {
      // Roll the optimistic echo back and give the manager their words + images
      // back — otherwise they silently vanish on the next successful send.
      setErr(e.message);
      setDialogue((d) => ({ ...d, transcript: d.transcript.slice(0, -1) }));
      if (overrideText == null) { setDraft(text); setPendingImages(images); }
      return null;
    } finally { setBusy(false); }
  };

  // --- Live 對談 (half-duplex voice): press to talk → STT → send → TTS reply ---
  const [liveMode, setLiveMode] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [liveInterim, setLiveInterim] = useState('');
  const recRef = useRef(null);

  const toggleLive = () => {
    if (liveMode) { recRef.current?.abort(); stopSpeaking(); setListening(false); setSpeaking(false); }
    setLiveMode((v) => !v);
  };

  const startListening = () => {
    if (busy || speaking || listening) return;
    stopSpeaking();
    setLiveInterim('');
    const rec = createRecognizer({
      lang: 'zh-TW',
      onInterim: (txt) => setLiveInterim(txt),
      onError: (code) => {
        setListening(false);
        if (code === 'not-allowed' || code === 'service-not-allowed') setErr(t('employees.micBlocked'));
        else if (code !== 'no-speech' && code !== 'aborted') setErr(t('employees.sttError', { code }));
      },
      onEnd: () => { setListening(false); setLiveInterim(''); },
      onFinal: async (finalText) => {
        const reply = await send(finalText); // send the recognized speech
        if (reply && ttsSupported) { setSpeaking(true); speak(reply, { onend: () => setSpeaking(false) }); }
      },
    });
    if (!rec) { setErr(t('employees.sttUnsupported')); return; }
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  const stopListening = () => recRef.current?.stop();
  // Stop everything when the modal unmounts.
  useEffect(() => () => { recRef.current?.abort(); stopSpeaking(); }, []);

  // Which close action is in flight: null | 'save' | 'discard'. Saving runs an
  // LLM distillation server-side (10–30s) — the UI must show honest progress or
  // the manager will assume the app hung.
  const [ending, setEnding] = useState(null);
  const end = async (save) => {
    if (ending) return; // double-click guard
    setEnding(save ? 'save' : 'discard');
    setErr('');
    try {
      const res = await api.post(`/dialogues/${dialogue.id}/close`, { save });
      if (res.saved) onSaved();
      else onClose();
    } catch (e) { setErr(e.message); setEnding(null); }
  };

  return (
    // While a close action runs, the modal must not be dismissable — the manager
    // would lose the progress feedback and assume the save silently died.
    <Modal title={t('employees.oneOnOneModalTitle', { name: employee.name })} onClose={() => { if (!ending) onClose(); }} wide>
      <p className="muted sm">
        {t('employees.oneOnOneDesc')}
      </p>
      {err && <div className="banner-err sm">{err}</div>}

      {!dialogue && (
        <div className="chat-box">
          {history === null && !err && <p className="muted">{t('employees.loadingHistory')}</p>}
          {history?.length > 0 && (
            <>
              <p className="muted sm">{t('employees.pastDialoguesHint')}</p>
              <ul className="notes">
                {history.map((d) => {
                  const first = d.transcript.find((tn) => tn.who === 'manager')?.text || t('employees.noContentFallback');
                  return (
                    <li key={d.id} className="note">
                      <div className="note-open">
                        <strong>{first.slice(0, 36)}{first.length > 36 ? '…' : ''}</strong>
                        {d.savedDocId && <span className="tag" title={t('employees.savedToKbTitle')}>{t('employees.savedToKbTag')}</span>}
                        <span className="muted sm"> {new Date(d.createdAt).toLocaleDateString('zh-Hant')} · {t('employees.messagesCount', { count: d.transcript.length })}</span>
                      </div>
                      <span className="actions">
                        <ExportButtons path={`/dialogues/${d.id}`} compact />
                        <button className="btn-ghost sm" onClick={() => continueOld(d.id)}>{t('employees.continueBtn')}</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {history !== null && (
            <div className="row end">
              <button className="btn sm" onClick={startNew}>{t('employees.startNewBtn')}</button>
            </div>
          )}
        </div>
      )}

      {dialogue && (
      <div className="chat-box">
        {dialogue.transcript.length === 0 && (
          <p className="muted">{t('employees.dialogueStartHint')}</p>
        )}
        {(dialogue?.transcript || []).map((tn, i) => (
          tn.who === 'manager' ? (
            <div key={i} className="chat-row chat-manager">
              <div className="chat-bubble chat-bubble-manager">
                {(tn.images || []).length > 0 && (
                  <div className="chat-images">
                    {tn.images.map((im, j) => (
                      <img key={j} src={im.dataUrl || `data:${im.mimeType};base64,${im.data}`} alt={t('employees.imageAlt')} />
                    ))}
                  </div>
                )}
                {tn.text}
              </div>
            </div>
          ) : (
            <div key={i} className="chat-row">
              <div className="turn-av">{employee.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
              <div className="chat-bubble">
                {tn.toolCalls > 0 && <div className="muted sm">{t('employees.toolCallsUsed', { count: tn.toolCalls })}</div>}
                <Markdown text={tn.text} />
                <Citations items={tn.citations} />
              </div>
            </div>
          )
        ))}
        {busy && <ProgressBar label={t('employees.thinkingProgress', { name: employee.name })} />}
        <div ref={endRef} />
      </div>
      )}

      {dialogue && (!closing ? (
        <div className="chat-controls" onPaste={onPasteImg} onDrop={onDropImg} onDragOver={(e) => e.preventDefault()}>
          {pendingImages.length > 0 && (
            <div className="pending-images">
              {pendingImages.map((im, j) => (
                <div key={j} className="pending-image">
                  <img src={im.dataUrl} alt={t('employees.pendingImageAlt')} />
                  <button className="pending-image-x" onClick={() => setPendingImages((cur) => cur.filter((_, k) => k !== j))} title={t('employees.removeImageTitle')}>✕</button>
                </div>
              ))}
            </div>
          )}
          {liveMode && (
            <button
              type="button"
              className={`live-mic${listening ? ' live' : ''}${speaking ? ' speaking' : ''}`}
              onClick={listening ? stopListening : startListening}
              disabled={busy || speaking}
              title={t('employees.liveMicTitle')}
            >
              <span className="live-mic-dot" />
              {speaking ? t('employees.liveSpeaking')
                : listening ? (liveInterim || t('employees.liveListening'))
                  : busy ? t('employees.liveThinking') : t('employees.liveTapToTalk')}
            </button>
          )}
          <div className="interject-row">
            <input
              placeholder={t('employees.chatInputPlaceholder', { name: employee.name })}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              disabled={busy || !dialogue}
            />
            <button className="btn sm" onClick={() => send()} disabled={busy || (!draft.trim() && !pendingImages.length) || !dialogue}>{t('employees.sendBtn')}</button>
          </div>
          <div className="row end">
            <ExportButtons path={`/dialogues/${dialogue.id}`} compact />
            {(ttsSupported || sttSupported) && (
              <button
                className={`btn-ghost sm${liveMode ? ' live-on' : ''}`}
                onClick={toggleLive}
                disabled={busy}
                title={sttSupported ? t('employees.liveToggleTitle') : t('employees.liveTtsOnlyTitle')}
              >
                {liveMode ? t('employees.liveOn') : t('employees.liveOff')}
              </button>
            )}
            <button className="btn-ghost sm" onClick={() => setClosing(true)} disabled={busy || !dialogue}>
              {t('employees.endDialogueBtn')}
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-controls">
          <p className="muted">{t('employees.closeConfirm', { name: employee.name })}</p>
          {ending === 'save' && <ProgressBar label={t('employees.savingDistillProgress')} />}
          {ending === 'discard' && <ProgressBar label={t('employees.endingProgress')} />}
          <div className="row end">
            <button className="btn-ghost sm" onClick={() => setClosing(false)} disabled={Boolean(ending)}>{t('common.cancel')}</button>
            <button className="btn-ghost sm" onClick={() => end(false)} disabled={Boolean(ending)}>
              {ending === 'discard' ? t('employees.endingBtn') : t('employees.discardEndBtn')}
            </button>
            <button className="btn sm" onClick={() => end(true)} disabled={Boolean(ending)}>
              {ending === 'save' ? t('employees.savingEndBtn') : t('employees.saveAndEndBtn')}
            </button>
          </div>
        </div>
      ))}
    </Modal>
  );
}

// Knowledge viewer: the FULL document plus its retrievable chunks — the exact
// slices the FTS index serves to agents during grounding and search_knowledge.
function DocViewer({ doc, onClose, onSaved }) {
  const { t } = useI18n();
  const [view, setView] = useState('content');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: doc.title, content: doc.content });
  const [save, setSave] = useState({ busy: false, err: '' });
  const SOURCE_LABELS = {
    note: t('employees.sourceNote'), file: t('employees.sourceFile'), memory: t('employees.sourceMemory'),
    research: t('employees.sourceResearch'), dialogue: t('employees.sourceDialogue'),
  };

  const startEdit = () => {
    setDraft({ title: doc.title, content: doc.content });
    setSave({ busy: false, err: '' });
    setView('content');
    setEditing(true);
  };

  const commit = async () => {
    if (!draft.content.trim()) { setSave({ busy: false, err: t('employees.contentEmptyErr') }); return; }
    setSave({ busy: true, err: '' });
    try {
      const updated = await api.put(`/knowledge/${doc.id}`, {
        title: draft.title.trim() || doc.title,
        content: draft.content,
      });
      setEditing(false);
      onSaved?.(updated); // refreshes the modal's doc + the card's chunk count
    } catch (e) {
      setSave({ busy: false, err: e.message || t('employees.saveFailedErr') });
    }
  };

  return (
    <Modal title={editing ? t('employees.editDocTitle', { title: doc.title }) : `📄 ${doc.title}`} onClose={onClose} wide>
      <div className="detail-meta">
        <span className="tag">{SOURCE_LABELS[doc.source] || doc.source}</span>
        {(doc.tags || []).map((tg) => <span key={tg} className="tag">{TYPE_LABELS[tg] || tg}</span>)}
        <span className="muted sm">{t('employees.createdAtPrefix')}{new Date(doc.createdAt).toLocaleString('zh-Hant')}</span>
        {!editing && (
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={startEdit}>{t('employees.editBtn')}</button>
        )}
      </div>

      {editing ? (
        <div className="doc-viewer-body">
          <label className="field">
            <span className="field-label">{t('employees.titleFieldLabel')}</span>
            <input
              className="input"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="field-label">{t('employees.contentFieldLabel')}</span>
            <textarea
              className="input"
              style={{ minHeight: '46vh', fontFamily: 'var(--mono, monospace)', lineHeight: 1.6 }}
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            />
          </label>
          <p className="muted sm">{t('employees.resplitHint')}</p>
          {save.err && <p className="err sm">{save.err}</p>}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setEditing(false)} disabled={save.busy}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={commit} disabled={save.busy}>
              {save.busy ? t('employees.savingBtn') : `💾 ${t('common.save')}`}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="subtabs">
            <button className={view === 'content' ? 'subtab on' : 'subtab'} onClick={() => setView('content')}>{t('employees.fullContentTab')}</button>
            <button className={view === 'chunks' ? 'subtab on' : 'subtab'} onClick={() => setView('chunks')}>
              {t('employees.chunksTab', { count: doc.chunks?.length || 0 })}
            </button>
          </div>

          {view === 'content' && (
            <div className="profile-box doc-viewer-body"><Markdown text={doc.content} /></div>
          )}

          {view === 'chunks' && (
            <div className="doc-viewer-body">
              <p className="muted sm">
                {t('employees.chunksDesc')}
              </p>
              <ul className="notes">
                {(doc.chunks || []).map((c) => (
                  <li key={c.id} className="note">
                    <div>
                      <strong className="muted">{t('employees.chunkLabel', { n: c.chunkIndex + 1 })}</strong>
                      <p className="chunk-text">{c.content}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// Phase 14 — 讓 agent 自己上網做功課：主管出題 → 員工代理用 web_search 深度搜索
// 寫出附出處的調查報告 → 主管在這裡審核，核准才會進入該員工的知識庫。
function ResearchSection({ employee, onChange }) {
  const { t } = useI18n();
  const RESEARCH_STATUS = {
    pending: { label: t('employees.statusPending'), cls: 'tag' },
    approved: { label: t('employees.statusApproved'), cls: 'tag tag-blue' },
    rejected: { label: t('employees.statusRejected'), cls: 'tag' },
  };
  const [webSearch, setWebSearch] = useState(null); // {enabled, keyConfigured}
  const [reports, setReports] = useState([]);
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null); // expanded report id

  const reload = () => api.get(`/employees/${employee.id}/research`).then(setReports).catch(() => {});
  useEffect(() => {
    api.get('/settings').then((s) => setWebSearch(s.webSearch)).catch(() => setWebSearch(null));
    reload();
  }, [employee.id]);

  const run = async () => {
    setErr('');
    setBusy(true);
    try {
      await api.post(`/employees/${employee.id}/research`, { topic });
      setTopic('');
      await reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const review = async (id, action) => {
    setErr('');
    try {
      await api.post(`/research/${id}/${action}`);
      await reload();
      if (action === 'approve') onChange(); // knowledge list changed
    } catch (e) { setErr(e.message); }
  };

  const enabled = Boolean(webSearch?.enabled);

  return (
    <div className="research-box">
      <h4>
        {t('employees.researchHeading')} <span className="count">{reports.length}</span>
      </h4>
      <p className="muted sm">
        {t('employees.researchDesc', { name: employee.name })}
      </p>
      {!enabled && (
        <div className="banner-err sm">
          {webSearch?.keyConfigured
            ? t('employees.webSearchToggleOff')
            : t('employees.noTavilyKey')}
        </div>
      )}
      <div className="note-form">
        <input
          placeholder={t('employees.researchTopicPlaceholder')}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={!enabled || busy}
        />
        <button className="btn sm" onClick={run} disabled={!enabled || busy || !topic.trim()}>
          {busy ? t('employees.researchingBtn') : t('employees.startResearchBtn')}
        </button>
      </div>
      {busy && <ProgressBar label={t('employees.researchProgress')} />}
      {err && <div className="banner-err sm">{err}</div>}

      <ul className="notes">
        {reports.map((r) => {
          const st = RESEARCH_STATUS[r.status] || RESEARCH_STATUS.pending;
          return (
            <li key={r.id} className="note research-report">
              <div>
                <strong>{r.topic}</strong>
                <span className={st.cls}>{st.label}</span>
                <span className="muted sm">{t('employees.researchMeta', { queries: r.queries.length, sources: r.sources.length })}</span>
                <div>
                  <button className="btn-ghost sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? t('employees.collapseReportBtn') : t('employees.expandReportBtn')}
                  </button>
                  {r.status === 'pending' && (
                    <>
                      <button className="btn sm" onClick={() => review(r.id, 'approve')}>{t('employees.approveBtn')}</button>
                      <button className="btn-ghost sm" onClick={() => review(r.id, 'reject')}>{t('employees.rejectBtn')}</button>
                    </>
                  )}
                </div>
                {open === r.id && (
                  <div className="profile-box research-report-body">
                    <Markdown text={r.report} />
                    {r.sources.length > 0 && (
                      <div className="muted sm">
                        {t('employees.citedSources')}
                        {r.sources.filter((s) => /^https?:\/\//i.test(s.url || '')).map((s) => (
                          <div key={s.url}>
                            <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title || s.url}</a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {reports.length === 0 && <li className="muted">{t('employees.noReports')}</li>}
      </ul>
    </div>
  );
}
