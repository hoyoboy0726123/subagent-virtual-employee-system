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
          <h2>Your Team</h2>
          <p className="muted">{employees.length} employee(s). Click a card to open a profile and knowledge base.</p>
        </div>
        <div className="actions">
          <button className="btn-ghost" onClick={() => setIdeating(true)}>✨ Ideate a role</button>
          <button className="btn" onClick={openNew}>+ New employee</button>
        </div>
      </div>

      {employees.length === 0 ? (
        <Empty>No employees yet. Create one, or use “Ideate a role” to draft one from a description.</Empty>
      ) : (
        <div className="grid">
          {employees.map((e) => (
            <button key={e.id} className="card" onClick={() => openDetail(e)}>
              <div className="card-avatar">{e.name.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
              <div className="card-main">
                <h3>{e.name}</h3>
                <p className="role">{e.roleTitle}</p>
                <p className="muted clamp">{e.personality || 'No personality set.'}</p>
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
    if (!form.name || !form.roleTitle) { setErr('Name and role title are required.'); return; }
    setBusy(true);
    try {
      if (form.id) await api.put(`/employees/${form.id}`, payload());
      else await api.post('/employees', payload());
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={form.id ? 'Edit employee' : 'New employee'} onClose={onClose} wide>
      {err && <div className="banner-err">{err}</div>}
      <div className="form-grid">
        <label>Name*<input value={form.name} onChange={set('name')} placeholder="Aria Chen" /></label>
        <label>Role title*<input value={form.roleTitle} onChange={set('roleTitle')} placeholder="Product Manager" /></label>
        <label>Personality / background<input value={form.personality} onChange={set('personality')} placeholder="decisive and outcome-focused" /></label>
        <label>Communication style<input value={form.communicationStyle} onChange={set('communicationStyle')} placeholder="crisp and narrative" /></label>
        <label className="col-2">Expertise (comma-separated)<input value={form.expertise} onChange={set('expertise')} placeholder="product strategy, roadmapping, user research" /></label>
        <label className="col-2">Objectives<input value={form.objectives} onChange={set('objectives')} placeholder="Ship a product customers love." /></label>
      </div>

      <div className="profile-head">
        <label className="profile-label">Generated background / profile</label>
        <button className="btn-ghost sm" onClick={genProfile} disabled={busy}>↻ Generate from fields</button>
      </div>
      <textarea
        className="profile-area"
        rows={8}
        value={form.profile}
        onChange={set('profile')}
        placeholder="Click “Generate from fields”, then edit freely."
      />

      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save employee'}</button>
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
    <Modal title="✨ Ideate a role" onClose={onClose}>
      <p className="muted">Describe the kind of employee you need. We’ll draft a full profile you can edit before saving.</p>
      <textarea
        rows={4}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="e.g. Someone to own our backend APIs and database reliability"
      />
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={draft} disabled={busy || !desc.trim()}>{busy ? 'Drafting…' : 'Draft profile →'}</button>
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
    if (!confirm(`Delete ${employee.name}? This also removes their knowledge base.`)) return;
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
          {employee.objectives && <p><strong>Objectives:</strong> {employee.objectives}</p>}
          <div className="tags">
            {(employee.expertise || []).map((t) => <span key={t} className="tag tag-blue">{t}</span>)}
          </div>
          <h4>Background</h4>
          <div className="profile-box"><Markdown text={employee.profile} /></div>
        </section>

        <section>
          <h4>📚 Personal knowledge base <span className="count">{employee.knowledge?.length || 0}</span></h4>
          <div className="note-form">
            <input
              placeholder="Note title"
              value={note.title}
              onChange={(e) => setNote({ ...note, title: e.target.value })}
            />
            <textarea
              rows={2}
              placeholder="Add a fact, doc snippet, or context this employee should know…"
              value={note.content}
              onChange={(e) => setNote({ ...note, content: e.target.value })}
            />
            <button className="btn sm" onClick={addNote} disabled={busy || !note.content.trim()}>+ Add note</button>
          </div>
          <ul className="notes">
            {(employee.knowledge || []).map((k) => (
              <li key={k.id} className="note">
                <div>
                  <strong>{k.title}</strong>
                  <p className="muted">{k.content}</p>
                </div>
                <button className="icon-btn" onClick={() => delNote(k.id)} aria-label="Delete note">🗑</button>
              </li>
            ))}
            {(!employee.knowledge || employee.knowledge.length === 0) && (
              <li className="muted">No notes yet.</li>
            )}
          </ul>
        </section>
      </div>

      <div className="modal-actions between">
        <button className="btn-danger" onClick={remove}>Delete employee</button>
        <button className="btn" onClick={onEdit}>Edit profile</button>
      </div>
    </Modal>
  );
}
