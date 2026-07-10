import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown, ExportButtons, Citations, ProgressBar } from '../components/ui.jsx';
import { fileToImagePart, imagesFromPaste, imagesFromDrop } from '../lib/image.js';

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
          <h2>你的團隊</h2>
          <p className="muted">共 {employees.length} 位員工。點擊卡片可開啟個人檔案與知識庫。</p>
        </div>
        <div className="actions">
          <button className="btn-ghost" onClick={() => setIdeating(true)}>✨ 發想角色</button>
          <button className="btn" onClick={openNew}>+ 新增員工</button>
        </div>
      </div>

      {employees.length === 0 ? (
        <Empty>尚無員工。請新增一位，或使用「發想角色」由一段描述草擬。</Empty>
      ) : (
        <div className="grid">
          {employees.map((e) => (
            <button key={e.id} className="card" onClick={() => openDetail(e)}>
              <div className="card-avatar">{e.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
              <div className="card-main">
                <h3>{e.name}</h3>
                <p className="role">{e.roleTitle}</p>
                <p className="muted clamp">{e.personality || '尚未設定個性。'}</p>
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
    if (!form.name || !form.roleTitle) { setErr('姓名與職稱為必填。'); return; }
    setBusy(true);
    try {
      if (form.id) await api.put(`/employees/${form.id}`, payload());
      else await api.post('/employees', payload());
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={form.id ? '編輯員工' : '新增員工'} onClose={onClose} wide>
      {err && <div className="banner-err">{err}</div>}
      <div className="form-grid">
        <label>姓名*<input value={form.name} onChange={set('name')} placeholder="王小明" /></label>
        <label>職稱*<input value={form.roleTitle} onChange={set('roleTitle')} placeholder="產品經理" /></label>
        <label>個性／背景<input value={form.personality} onChange={set('personality')} placeholder="果斷且重視成效" /></label>
        <label>溝通風格<input value={form.communicationStyle} onChange={set('communicationStyle')} placeholder="簡潔且具敘事性" /></label>
        <label className="col-2">專長（以逗號分隔）<input value={form.expertise} onChange={set('expertise')} placeholder="產品策略, 路線圖規劃, 使用者研究" /></label>
        <label className="col-2">目標<input value={form.objectives} onChange={set('objectives')} placeholder="交付讓顧客喜愛的產品。" /></label>
      </div>

      <details className="agent-config">
        <summary>⚙️ 代理設定（進階，留空即用系統預設）</summary>
        <div className="form-grid">
          <label>模型
            <input
              value={form.agentModel}
              onChange={set('agentModel')}
              placeholder="預設（gemma-4-31b-it）"
            />
          </label>
          <label>溫度（0–2）
            <input
              type="number" min="0" max="2" step="0.05"
              value={form.agentTemperature}
              onChange={set('agentTemperature')}
              placeholder="自動（依員工微調）"
            />
          </label>
          <label>每回合工具上限（1–10）
            <input
              type="number" min="1" max="10" step="1"
              value={form.agentMaxToolCalls}
              onChange={set('agentMaxToolCalls')}
              placeholder="預設 3"
            />
          </label>
          <label className="agent-config-check">
            <input
              type="checkbox"
              checked={form.agentWebSearch !== false}
              onChange={(ev) => setForm({ ...form, agentWebSearch: ev.target.checked })}
            />
            允許此員工使用網路搜尋（仍受全域開關控制）
          </label>
        </div>
      </details>

      <div className="profile-head">
        <label className="profile-label">自動產生的背景／個人檔案</label>
        <button className="btn-ghost sm" onClick={genProfile} disabled={busy}>↻ 由欄位產生</button>
      </div>
      <textarea
        className="profile-area"
        rows={8}
        value={form.profile}
        onChange={set('profile')}
        placeholder="點擊「由欄位產生」，之後可自由編輯。"
      />

      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? '儲存中…' : '儲存員工'}</button>
      </div>
    </Modal>
  );
}

function IdeateModal({ onClose, onDraft }) {
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
    <Modal title="✨ 發想角色" onClose={onClose}>
      <p className="muted">描述你需要的員工類型，我們會草擬一份完整檔案，儲存前可自由編輯。</p>
      <textarea
        rows={4}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="例如：負責我們後端 API 與資料庫可靠性的人選"
      />
      {busy && <ProgressBar label="正在草擬角色檔案…" />}
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button className="btn" onClick={draft} disabled={busy || !desc.trim()}>{busy ? '草擬中…' : '草擬檔案 →'}</button>
      </div>
    </Modal>
  );
}

function EmployeeDetail({ employee, onClose, onChange, onEdit, onDeleted }) {
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
      const via = doc.metadata?.parser === 'markitdown' ? 'MarkItDown' : '內建擷取';
      setUpload({ busy: false, err: '', ok: `已匯入「${doc.title}」（${via}，${doc.chunkCount} 個片段）` });
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
        const why = res.skipped === 'disabled' ? '整併功能已停用'
          : res.skipped === 'nothing-to-merge' ? '目前沒有可整併的記憶'
          : '記憶量尚未達整併門檻';
        setConsolidating({ busy: false, msg: why, err: '' });
      } else {
        const via = res.method === 'live' ? 'AI 整併' : '離線去重';
        setConsolidating({ busy: false, msg: `已把 ${res.mergedCount} 則記憶整併為 1 則（${via}）`, err: '' });
        onChange();
      }
    } catch (e) {
      setConsolidating({ busy: false, msg: '', err: e.message });
    }
  };

  const remove = async () => {
    if (!confirm(`確定要刪除 ${employee.name}？此操作會一併移除其知識庫。`)) return;
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
          {employee.objectives && <p><strong>目標：</strong> {employee.objectives}</p>}
          <div className="tags">
            {(employee.expertise || []).map((t) => <span key={t} className="tag tag-blue">{t}</span>)}
          </div>
          <h4>背景</h4>
          <div className="profile-box"><Markdown text={employee.profile} /></div>
        </section>

        <section>
          <h4>📚 個人知識庫 <span className="count">{employee.knowledge?.length || 0}</span></h4>

          <div className="upload-box">
            <div className="upload-row">
              <button
                className="btn-ghost sm"
                onClick={() => fileRef.current?.click()}
                disabled={upload.busy}
              >
                {upload.busy ? '解析中…' : '⬆ 上傳文件'}
              </button>
              <span className="muted upload-hint">支援 PDF、DOCX、PPTX、XLSX、CSV、TXT、Markdown、HTML；一律經 MarkItDown 轉為 Markdown 後匯入。</span>
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
                  {consolidating.busy ? '整併中…' : `🧠 整併記憶（${memoryCount} 則）`}
                </button>
                <span className="muted upload-hint">
                  把累積的會議／自主記憶合併成一則精簡、去重、以較新為準的記憶；原始記憶會封存（移出檢索但可還原）。
                </span>
              </div>
              {consolidating.busy && <ProgressBar label="正在整併記憶，請稍候…" />}
              {consolidating.err && <div className="banner-err sm">{consolidating.err}</div>}
              {consolidating.msg && <div className="banner-ok sm">{consolidating.msg}</div>}
            </div>
          )}

          <div className="note-form">
            <input
              placeholder="筆記標題"
              value={note.title}
              onChange={(e) => setNote({ ...note, title: e.target.value })}
            />
            <textarea
              rows={2}
              placeholder="或手動新增一則此員工應知道的事實、文件摘錄或背景…"
              value={note.content}
              onChange={(e) => setNote({ ...note, content: e.target.value })}
            />
            <button className="btn sm" onClick={addNote} disabled={busy || !note.content.trim()}>+ 新增筆記</button>
          </div>
          <ul className="notes">
            {(employee.knowledge || []).map((k) => (
              <li key={k.id} className="note">
                <div
                  className="note-open"
                  role="button"
                  tabIndex={0}
                  title="點擊查看完整內容與檢索片段"
                  onClick={() => openDoc(k.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openDoc(k.id); }}
                >
                  <strong>{k.title}</strong>
                  {k.source === 'file' && (
                    <span className="tag tag-blue" title={k.metadata?.originalFilename || ''}>
                      📄 {TYPE_LABELS[k.metadata?.sourceType] || '檔案'}
                    </span>
                  )}
                  {k.source === 'memory' && (
                    k.metadata?.consolidated ? (
                      <span className="tag tag-blue" title={`由 ${k.metadata.mergedCount || '多'} 則記憶整併而成`}>
                        🧠 整併記憶
                      </span>
                    ) : (
                      <span className="tag" title={k.metadata?.topic ? `來自會議：${k.metadata.topic}` : '代理自主記憶'}>
                        🧠 記憶
                      </span>
                    )
                  )}
                  {k.source === 'research' && (
                    <span className="tag tag-blue" title="經你核准的自主研究報告">🔍 研究</span>
                  )}
                  {k.source === 'dialogue' && (
                    <span className="tag" title="1 on 1 面談紀錄">💬 1on1</span>
                  )}
                  {k.metadata?.parseStatus === 'fallback' && (
                    <span className="tag" title={k.metadata?.parseError || ''}>內建擷取</span>
                  )}
                  {typeof k.chunkCount === 'number' && (
                    <span className="count" title="可檢索片段">{k.chunkCount} 個片段</span>
                  )}
                  {k.source === 'file' && k.metadata?.originalFilename && (
                    <p className="muted upload-file">來源：{k.metadata.originalFilename}</p>
                  )}
                  <p className="muted clamp">{k.content}</p>
                  {(k.tags || []).length > 0 && (
                    <div className="tags">{k.tags.map((t) => <span key={t} className="tag">{TYPE_LABELS[t] || t}</span>)}</div>
                  )}
                </div>
                <button className="icon-btn" onClick={() => delNote(k.id)} aria-label="刪除文件">🗑</button>
              </li>
            ))}
            {(!employee.knowledge || employee.knowledge.length === 0) && (
              <li className="muted">尚無文件。上傳檔案或手動新增筆記皆可。</li>
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
        <button className="btn-danger" onClick={remove}>刪除員工</button>
        <div className="actions">
          <button className="btn-ghost" onClick={() => setOneOnOne(true)}>💬 1 on 1 面談</button>
          <button className="btn" onClick={onEdit}>編輯檔案</button>
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

  const send = async () => {
    const text = draft.trim();
    const images = pendingImages;
    if ((!text && !images.length) || busy || !dialogue) return;
    setErr('');
    setBusy(true);
    setDraft('');
    setPendingImages([]);
    // Optimistic echo of the manager's message (with any images) while thinking.
    setDialogue((d) => ({ ...d, transcript: [...d.transcript, { who: 'manager', text, images }] }));
    try {
      setDialogue(await api.post(`/dialogues/${dialogue.id}/messages`, {
        text,
        images: images.map((im) => ({ mimeType: im.mimeType, data: im.data })),
      }));
    } catch (e) {
      // Roll the optimistic echo back and give the manager their words + images
      // back — otherwise they silently vanish on the next successful send.
      setErr(e.message);
      setDialogue((d) => ({ ...d, transcript: d.transcript.slice(0, -1) }));
      setDraft(text);
      setPendingImages(images);
    } finally { setBusy(false); }
  };

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
    <Modal title={`💬 與 ${employee.name} 的 1 on 1`} onClose={() => { if (!ending) onClose(); }} wide>
      <p className="muted sm">
        沒有輪數限制——談到你滿意為止。要他查資料就直接說（例如「幫我查一下…的最新現況」）。
      </p>
      {err && <div className="banner-err sm">{err}</div>}

      {!dialogue && (
        <div className="chat-box">
          {history === null && !err && <p className="muted">載入面談紀錄中…</p>}
          {history?.length > 0 && (
            <>
              <p className="muted sm">📜 過往面談——點「▶ 繼續」就接回同一場對話，不用重新開始：</p>
              <ul className="notes">
                {history.map((d) => {
                  const first = d.transcript.find((t) => t.who === 'manager')?.text || '（沒有內容）';
                  return (
                    <li key={d.id} className="note">
                      <div className="note-open">
                        <strong>{first.slice(0, 36)}{first.length > 36 ? '…' : ''}</strong>
                        {d.savedDocId && <span className="tag" title="結束時已整理存入知識庫；續談後再儲存會更新同一份紀錄">💾 已入庫</span>}
                        <span className="muted sm"> {new Date(d.createdAt).toLocaleDateString('zh-Hant')} · {d.transcript.length} 則訊息</span>
                      </div>
                      <span className="actions">
                        <ExportButtons path={`/dialogues/${d.id}`} compact />
                        <button className="btn-ghost sm" onClick={() => continueOld(d.id)}>▶ 繼續</button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {history !== null && (
            <div className="row end">
              <button className="btn sm" onClick={startNew}>🆕 開始新的面談</button>
            </div>
          )}
        </div>
      )}

      {dialogue && (
      <div className="chat-box">
        {dialogue.transcript.length === 0 && (
          <p className="muted">（面談開始——說點什麼吧。）</p>
        )}
        {(dialogue?.transcript || []).map((t, i) => (
          t.who === 'manager' ? (
            <div key={i} className="chat-row chat-manager">
              <div className="chat-bubble chat-bubble-manager">
                {(t.images || []).length > 0 && (
                  <div className="chat-images">
                    {t.images.map((im, j) => (
                      <img key={j} src={im.dataUrl || `data:${im.mimeType};base64,${im.data}`} alt="附圖" />
                    ))}
                  </div>
                )}
                {t.text}
              </div>
            </div>
          ) : (
            <div key={i} className="chat-row">
              <div className="turn-av">{employee.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
              <div className="chat-bubble">
                {t.toolCalls > 0 && <div className="muted sm">🛠 查證了 {t.toolCalls} 次</div>}
                <Markdown text={t.text} />
                <Citations items={t.citations} />
              </div>
            </div>
          )
        ))}
        {busy && <ProgressBar label={`${employee.name} 思考中（需要查資料時會久一點）…`} />}
        <div ref={endRef} />
      </div>
      )}

      {dialogue && (!closing ? (
        <div className="chat-controls" onPaste={onPasteImg} onDrop={onDropImg} onDragOver={(e) => e.preventDefault()}>
          {pendingImages.length > 0 && (
            <div className="pending-images">
              {pendingImages.map((im, j) => (
                <div key={j} className="pending-image">
                  <img src={im.dataUrl} alt="待送出" />
                  <button className="pending-image-x" onClick={() => setPendingImages((cur) => cur.filter((_, k) => k !== j))} title="移除">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="interject-row">
            <input
              placeholder={`對 ${employee.name} 說…（可貼上/拖入圖片，Enter 送出）`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
              disabled={busy || !dialogue}
            />
            <button className="btn sm" onClick={send} disabled={busy || (!draft.trim() && !pendingImages.length) || !dialogue}>送出</button>
          </div>
          <div className="row end">
            <ExportButtons path={`/dialogues/${dialogue.id}`} compact />
            <button className="btn-ghost sm" onClick={() => setClosing(true)} disabled={busy || !dialogue}>
              ⏹ 結束面談…
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-controls">
          <p className="muted">要把這場面談的紀錄整理後存進 {employee.name} 的知識庫嗎？（存下來，他之後開會就記得這些結論。）</p>
          {ending === 'save' && <ProgressBar label="正在把面談整理成知識文件並建立索引（AI 整理約需 10–30 秒）…" />}
          {ending === 'discard' && <ProgressBar label="正在結束面談…" />}
          <div className="row end">
            <button className="btn-ghost sm" onClick={() => setClosing(false)} disabled={Boolean(ending)}>取消</button>
            <button className="btn-ghost sm" onClick={() => end(false)} disabled={Boolean(ending)}>
              {ending === 'discard' ? '結束中…' : '不儲存，直接結束'}
            </button>
            <button className="btn sm" onClick={() => end(true)} disabled={Boolean(ending)}>
              {ending === 'save' ? '⏳ 整理紀錄中…' : '💾 儲存到知識庫並結束'}
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
  const [view, setView] = useState('content');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: doc.title, content: doc.content });
  const [save, setSave] = useState({ busy: false, err: '' });
  const SOURCE_LABELS = { note: '手動筆記', file: '上傳文件', memory: '會議／自主記憶', research: '核准的研究報告', dialogue: '1 on 1 面談紀錄' };

  const startEdit = () => {
    setDraft({ title: doc.title, content: doc.content });
    setSave({ busy: false, err: '' });
    setView('content');
    setEditing(true);
  };

  const commit = async () => {
    if (!draft.content.trim()) { setSave({ busy: false, err: '內容不可為空' }); return; }
    setSave({ busy: true, err: '' });
    try {
      const updated = await api.put(`/knowledge/${doc.id}`, {
        title: draft.title.trim() || doc.title,
        content: draft.content,
      });
      setEditing(false);
      onSaved?.(updated); // refreshes the modal's doc + the card's chunk count
    } catch (e) {
      setSave({ busy: false, err: e.message || '儲存失敗' });
    }
  };

  return (
    <Modal title={editing ? `✏️ 編輯：${doc.title}` : `📄 ${doc.title}`} onClose={onClose} wide>
      <div className="detail-meta">
        <span className="tag">{SOURCE_LABELS[doc.source] || doc.source}</span>
        {(doc.tags || []).map((t) => <span key={t} className="tag">{TYPE_LABELS[t] || t}</span>)}
        <span className="muted sm">建立於 {new Date(doc.createdAt).toLocaleString('zh-Hant')}</span>
        {!editing && (
          <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={startEdit}>✏️ 編輯</button>
        )}
      </div>

      {editing ? (
        <div className="doc-viewer-body">
          <label className="field">
            <span className="field-label">標題</span>
            <input
              className="input"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </label>
          <label className="field">
            <span className="field-label">內容（支援 Markdown）</span>
            <textarea
              className="input"
              style={{ minHeight: '46vh', fontFamily: 'var(--mono, monospace)', lineHeight: 1.6 }}
              value={draft.content}
              onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            />
          </label>
          <p className="muted sm">儲存後會依新內容重新切割檢索片段，員工立即依更新後的知識發言。</p>
          {save.err && <p className="err sm">{save.err}</p>}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setEditing(false)} disabled={save.busy}>取消</button>
            <button className="btn btn-primary" onClick={commit} disabled={save.busy}>
              {save.busy ? '儲存中…' : '💾 儲存'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="subtabs">
            <button className={view === 'content' ? 'subtab on' : 'subtab'} onClick={() => setView('content')}>完整內容</button>
            <button className={view === 'chunks' ? 'subtab on' : 'subtab'} onClick={() => setView('chunks')}>
              檢索片段（{doc.chunks?.length || 0}）
            </button>
          </div>

          {view === 'content' && (
            <div className="profile-box doc-viewer-body"><Markdown text={doc.content} /></div>
          )}

          {view === 'chunks' && (
            <div className="doc-viewer-body">
              <p className="muted sm">
                這些是文件切割後的檢索片段——員工代理在會議、目標與自主研究中，
                透過知識檢索實際「讀到」的就是這些原文。要修改請按上方「✏️ 編輯」改內容，
                片段會自動重新切割。
              </p>
              <ul className="notes">
                {(doc.chunks || []).map((c) => (
                  <li key={c.id} className="note">
                    <div>
                      <strong className="muted">片段 #{c.chunkIndex + 1}</strong>
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

const RESEARCH_STATUS = {
  pending: { label: '⏳ 待審核', cls: 'tag' },
  approved: { label: '✅ 已入庫', cls: 'tag tag-blue' },
  rejected: { label: '🚫 已駁回', cls: 'tag' },
};

// Phase 14 — 讓 agent 自己上網做功課：主管出題 → 員工代理用 web_search 深度搜索
// 寫出附出處的調查報告 → 主管在這裡審核，核准才會進入該員工的知識庫。
function ResearchSection({ employee, onChange }) {
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
        🔍 AI 自主研究 <span className="count">{reports.length}</span>
      </h4>
      <p className="muted sm">
        指定主題，讓 {employee.name} 自己上網深度搜索並寫出附出處的調查報告；經你核准後才會加入知識庫。
      </p>
      {!enabled && (
        <div className="banner-err sm">
          {webSearch?.keyConfigured
            ? '網路搜尋開關未開啟——請在頁面上方打開「🌐 網路搜尋」。'
            : '尚未設定 TAVILY_API_KEY，無法進行網路研究。'}
        </div>
      )}
      <div className="note-form">
        <input
          placeholder="調查主題，例如：2026 台灣電商物流的最新趨勢"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={!enabled || busy}
        />
        <button className="btn sm" onClick={run} disabled={!enabled || busy || !topic.trim()}>
          {busy ? '研究中…' : '🔍 開始研究'}
        </button>
      </div>
      {busy && <ProgressBar label="agent 正在多次上網搜尋並撰寫調查報告，約需 1–2 分鐘…" />}
      {err && <div className="banner-err sm">{err}</div>}

      <ul className="notes">
        {reports.map((r) => {
          const st = RESEARCH_STATUS[r.status] || RESEARCH_STATUS.pending;
          return (
            <li key={r.id} className="note research-report">
              <div>
                <strong>{r.topic}</strong>
                <span className={st.cls}>{st.label}</span>
                <span className="muted sm"> · 搜尋 {r.queries.length} 次 · 來源 {r.sources.length} 個</span>
                <div>
                  <button className="btn-ghost sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? '收合報告 ▲' : '閱讀報告 ▼'}
                  </button>
                  {r.status === 'pending' && (
                    <>
                      <button className="btn sm" onClick={() => review(r.id, 'approve')}>✅ 核准入庫</button>
                      <button className="btn-ghost sm" onClick={() => review(r.id, 'reject')}>🚫 駁回</button>
                    </>
                  )}
                </div>
                {open === r.id && (
                  <div className="profile-box research-report-body">
                    <Markdown text={r.report} />
                    {r.sources.length > 0 && (
                      <div className="muted sm">
                        引用來源：
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
        {reports.length === 0 && <li className="muted">尚無研究報告。</li>}
      </ul>
    </div>
  );
}
