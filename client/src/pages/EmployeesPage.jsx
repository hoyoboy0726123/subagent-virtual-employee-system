import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal, Empty, Markdown } from '../components/ui.jsx';

const BLANK = {
  name: '', roleTitle: '', personality: '', expertise: '',
  objectives: '', communicationStyle: '', profile: '',
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
});

function EmployeeForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (ev) => setForm({ ...form, [k]: ev.target.value });

  const payload = () => ({
    ...form,
    expertise: String(form.expertise).split(',').map((s) => s.trim()).filter(Boolean),
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

  const addNote = async () => {
    if (!note.content.trim()) return;
    setBusy(true);
    try {
      await api.post(`/employees/${employee.id}/knowledge`, note);
      setNote({ title: '', content: '' });
      onChange();
    } finally { setBusy(false); }
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
          <div className="note-form">
            <input
              placeholder="筆記標題"
              value={note.title}
              onChange={(e) => setNote({ ...note, title: e.target.value })}
            />
            <textarea
              rows={2}
              placeholder="新增一則此員工應知道的事實、文件摘錄或背景…"
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
                  {typeof k.chunkCount === 'number' && (
                    <span className="count" title="可檢索片段">{k.chunkCount} 個片段</span>
                  )}
                  <p className="muted">{k.content}</p>
                  {(k.tags || []).length > 0 && (
                    <div className="tags">{k.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
                  )}
                </div>
                <button className="icon-btn" onClick={() => delNote(k.id)} aria-label="刪除筆記">🗑</button>
              </li>
            ))}
            {(!employee.knowledge || employee.knowledge.length === 0) && (
              <li className="muted">尚無筆記。</li>
            )}
          </ul>
        </section>
      </div>

      <div className="modal-actions between">
        <button className="btn-danger" onClick={remove}>刪除員工</button>
        <button className="btn" onClick={onEdit}>編輯檔案</button>
      </div>
    </Modal>
  );
}
