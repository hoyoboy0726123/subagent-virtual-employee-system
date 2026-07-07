import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown } from '../components/ui.jsx';

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
  const fileRef = useRef(null);

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
                <div>
                  <strong>{k.title}</strong>
                  {k.source === 'file' && (
                    <span className="tag tag-blue" title={k.metadata?.originalFilename || ''}>
                      📄 {TYPE_LABELS[k.metadata?.sourceType] || '檔案'}
                    </span>
                  )}
                  {k.source === 'memory' && (
                    <span className="tag" title={k.metadata?.topic ? `來自會議：${k.metadata.topic}` : '代理自主記憶'}>
                      🧠 記憶
                    </span>
                  )}
                  {k.source === 'research' && (
                    <span className="tag tag-blue" title="經你核准的自主研究報告">🔍 研究</span>
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

      <div className="modal-actions between">
        <button className="btn-danger" onClick={remove}>刪除員工</button>
        <button className="btn" onClick={onEdit}>編輯檔案</button>
      </div>
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
          {busy ? '研究中…（agent 正在多次搜尋與撰寫，約需 1–2 分鐘）' : '🔍 開始研究'}
        </button>
      </div>
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
                        {r.sources.map((s) => (
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
