import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { load, persist, id } from './db.js';
import { generateProfile, ideateRole, runMeeting, executeGoal } from './engine.js';
import { llmEnabled, complete } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const db = load();
const now = () => new Date().toISOString();
const findEmp = (eid) => db.employees.find((e) => e.id === eid);
const empsByIds = (ids = []) => ids.map(findEmp).filter(Boolean);

// --- health / meta -----------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, llm: llmEnabled(), counts: {
    employees: db.employees.length,
    knowledge: db.knowledge.length,
    meetings: db.meetings.length,
    goals: db.goals.length,
  } });
});

// --- employees ---------------------------------------------------------------
app.get('/api/employees', (_req, res) => res.json(db.employees));

app.get('/api/employees/:id', (req, res) => {
  const emp = findEmp(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  const knowledge = db.knowledge.filter((k) => k.employeeId === emp.id);
  res.json({ ...emp, knowledge });
});

app.post('/api/employees', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.roleTitle) {
    return res.status(400).json({ error: 'name and roleTitle are required' });
  }
  const emp = {
    id: id('emp'),
    name: b.name,
    roleTitle: b.roleTitle,
    personality: b.personality || '',
    expertise: b.expertise || [],
    objectives: b.objectives || '',
    communicationStyle: b.communicationStyle || '',
    profile: b.profile || generateProfile(b),
    createdAt: now(),
  };
  db.employees.push(emp);
  persist();
  res.status(201).json(emp);
});

app.put('/api/employees/:id', (req, res) => {
  const emp = findEmp(req.params.id);
  if (!emp) return res.status(404).json({ error: 'not found' });
  Object.assign(emp, req.body, { id: emp.id, createdAt: emp.createdAt });
  persist();
  res.json(emp);
});

app.delete('/api/employees/:id', (req, res) => {
  const idx = db.employees.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.employees.splice(idx, 1);
  db.knowledge = db.knowledge.filter((k) => k.employeeId !== req.params.id);
  persist();
  res.json({ ok: true });
});

// Generate a background from the current form fields (no save).
app.post('/api/employees/generate-profile', (req, res) => {
  res.json({ profile: generateProfile(req.body || {}) });
});

// Ideate a whole role from a free-text description.
app.post('/api/employees/ideate', async (req, res) => {
  const description = (req.body || {}).description || '';
  const draft = ideateRole(description);
  if (llmEnabled()) {
    const text = await complete(
      'You are an HR assistant that drafts a virtual employee profile. Reply with a vivid 2-paragraph background only.',
      `Draft a background for an employee described as: ${description}. Role: ${draft.roleTitle}. Expertise: ${draft.expertise.join(', ')}.`
    );
    if (text) draft.profile = text.trim();
  }
  res.json(draft);
});

// --- knowledge base ----------------------------------------------------------
app.get('/api/employees/:id/knowledge', (req, res) => {
  res.json(db.knowledge.filter((k) => k.employeeId === req.params.id));
});

app.post('/api/employees/:id/knowledge', (req, res) => {
  const emp = findEmp(req.params.id);
  if (!emp) return res.status(404).json({ error: 'employee not found' });
  const b = req.body || {};
  if (!b.content) return res.status(400).json({ error: 'content is required' });
  const entry = {
    id: id('kn'),
    employeeId: emp.id,
    title: b.title || 'Untitled note',
    content: b.content,
    tags: b.tags || [],
    createdAt: now(),
  };
  db.knowledge.push(entry);
  persist();
  res.status(201).json(entry);
});

app.delete('/api/knowledge/:id', (req, res) => {
  const idx = db.knowledge.findIndex((k) => k.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.knowledge.splice(idx, 1);
  persist();
  res.json({ ok: true });
});

// --- meetings ----------------------------------------------------------------
app.get('/api/meetings', (_req, res) =>
  res.json([...db.meetings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
);

app.get('/api/meetings/:id', (req, res) => {
  const m = db.meetings.find((x) => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  res.json(m);
});

app.post('/api/meetings', async (req, res) => {
  const b = req.body || {};
  const participants = empsByIds(b.participantIds);
  if (!b.topic || participants.length === 0) {
    return res.status(400).json({ error: 'topic and at least one participant are required' });
  }
  const rounds = Math.min(Math.max(Number(b.rounds) || 3, 1), 5);
  const result = runMeeting({ topic: b.topic, participants, knowledge: db.knowledge, rounds });

  // Optional LLM enrichment of the summary report.
  if (llmEnabled()) {
    const text = await complete(
      'You are a meeting facilitator producing a concise executive report.',
      `Topic: ${b.topic}\nParticipants: ${participants.map((p) => `${p.name} (${p.roleTitle})`).join(', ')}\nTranscript:\n${result.transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n')}\n\nWrite a concise markdown report with Summary, Decisions, Action Items, Recommendation.`
    );
    if (text) result.report = text.trim();
  }

  const meeting = {
    id: id('mtg'),
    topic: b.topic,
    participantIds: participants.map((p) => p.id),
    participants: participants.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    rounds,
    ...result,
    createdAt: now(),
  };
  db.meetings.push(meeting);
  persist();
  res.status(201).json(meeting);
});

app.delete('/api/meetings/:id', (req, res) => {
  const idx = db.meetings.findIndex((m) => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.meetings.splice(idx, 1);
  persist();
  res.json({ ok: true });
});

// --- goals -------------------------------------------------------------------
app.get('/api/goals', (_req, res) =>
  res.json([...db.goals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
);

app.post('/api/goals', async (req, res) => {
  const b = req.body || {};
  const assignees = empsByIds(b.assigneeIds);
  if (!b.title || assignees.length === 0) {
    return res.status(400).json({ error: 'title and at least one assignee are required' });
  }
  const result = executeGoal({ title: b.title, description: b.description || '', assignees, knowledge: db.knowledge });

  if (llmEnabled()) {
    const text = await complete(
      'You are a program manager writing a collaboration plan.',
      `Goal: ${b.title}\n${b.description || ''}\nAssignees: ${assignees.map((p) => `${p.name} (${p.roleTitle})`).join(', ')}\n\nWrite a concise markdown collaboration output: Plan, per-owner subtasks, Integration, Next Steps.`
    );
    if (text) result.output = text.trim();
  }

  const goal = {
    id: id('goal'),
    title: b.title,
    description: b.description || '',
    assigneeIds: assignees.map((p) => p.id),
    assignees: assignees.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    status: 'in-progress',
    ...result,
    createdAt: now(),
  };
  db.goals.push(goal);
  persist();
  res.status(201).json(goal);
});

app.put('/api/goals/:id', (req, res) => {
  const goal = db.goals.find((g) => g.id === req.params.id);
  if (!goal) return res.status(404).json({ error: 'not found' });
  if (req.body.status) goal.status = req.body.status;
  if (Array.isArray(req.body.tasks)) goal.tasks = req.body.tasks;
  persist();
  res.json(goal);
});

app.delete('/api/goals/:id', (req, res) => {
  const idx = db.goals.findIndex((g) => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  db.goals.splice(idx, 1);
  persist();
  res.json({ ok: true });
});

// --- serve built client in production ---------------------------------------
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Export the app for tests; only listen when run directly.
export { app };

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  app.listen(PORT, () => {
    console.log(`\n  🧑‍💼 Virtual Employee System API running on http://localhost:${PORT}`);
    console.log(`  LLM mode: ${llmEnabled() ? 'ON (Anthropic)' : 'OFF (deterministic engine)'}\n`);
  });
}
