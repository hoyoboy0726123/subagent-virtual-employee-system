// Seed the SQLite store with example employees, knowledge documents (which get
// chunked + FTS-indexed), and one grounded demo meeting so the app is instantly
// explorable. Run: `npm run seed` (this RESETS the database).
import { resetDb } from './connection.js';
import { insertEmployee } from '../storage/employees.repo.js';
import { insertDocument } from '../storage/knowledge.repo.js';
import { insertMeeting } from '../storage/meetings.repo.js';
import { generateProfile } from '../reasoning/engine.js';
import { SimulatedRuntimeAdapter } from '../runtime/SimulatedRuntimeAdapter.js';

export async function seed() {
  resetDb();

  const make = (data) => insertEmployee({ ...data, profile: generateProfile(data) });

  const aria = make({
    name: 'Aria Chen',
    roleTitle: 'Product Manager',
    personality: 'decisive and outcome-focused',
    expertise: ['product strategy', 'roadmapping', 'user research', 'prioritization'],
    objectives: 'Ship a product customers love while keeping scope realistic.',
    communicationStyle: 'crisp and narrative',
  });
  const marcus = make({
    name: 'Marcus Reid',
    roleTitle: 'Backend Engineer',
    personality: 'systematic and risk-aware',
    expertise: ['APIs', 'databases', 'scalability', 'reliability'],
    objectives: 'Build a robust, maintainable backend that scales.',
    communicationStyle: 'precise and structured',
  });
  const lena = make({
    name: 'Lena Ortiz',
    roleTitle: 'Frontend Engineer',
    personality: 'detail-oriented and user-empathetic',
    expertise: ['React', 'UI/UX', 'accessibility', 'design systems'],
    objectives: 'Deliver a delightful, accessible interface.',
    communicationStyle: 'visual and example-driven',
  });
  const sam = make({
    name: 'Sam Patel',
    roleTitle: 'Data Scientist',
    personality: 'curious and rigorous',
    expertise: ['statistics', 'machine learning', 'experimentation', 'data storytelling'],
    objectives: 'Turn data into decisions the team can trust.',
    communicationStyle: 'evidence-first and quantified',
  });

  const employees = [aria, marcus, lena, sam];

  // Knowledge documents — richer than the old one-line notes so chunking/retrieval
  // have something to work with.
  const docs = [
    [aria, 'North-star metric', 'Our north-star metric is weekly active teams that run at least one meeting. Everything ladders up to activation. Secondary guardrail metrics are week-4 retention and time-to-first-meeting. We do not optimize vanity metrics like signups.', ['strategy']],
    [aria, 'Launch constraints', 'The MVP must run locally with zero external API keys and no native build steps. Keep scope to the core flows: employees, knowledge base, meetings, goals. Anything requiring cloud infra is out of scope for launch.', ['scope']],
    [marcus, 'Persistence decision', 'We migrated from a JSON-file store to SQLite via the built-in node:sqlite module. This gives us transactions, indexes, and FTS5 full-text search with no native build. WAL mode is enabled for concurrent reads. Foreign keys cascade deletes from employees to their documents and chunks.', ['backend', 'adr']],
    [marcus, 'Retrieval design', 'Knowledge documents are chunked into overlapping ~480-character chunks and indexed in an FTS5 table. Retrieval uses BM25 ranking and can be scoped to one or many employees, which is how meetings and goals stay grounded in the right people\'s knowledge.', ['backend', 'rag']],
    [lena, 'Accessibility baseline', 'All interactive elements need visible focus states and ARIA labels. Target WCAG AA contrast ratios. Modals must trap focus and close on Escape. Never rely on color alone to convey state.', ['a11y']],
    [sam, 'Experiment guardrail', 'Never ship a change on a metric move under 2 standard errors. Always define the primary metric before running the test. Prefer a small measurable slice over a big-bang launch, and pre-register the success threshold.', ['stats']],
  ];
  for (const [emp, title, content, tags] of docs) {
    insertDocument(emp.id, { title, content, tags, source: 'note' });
  }

  // One grounded demo meeting through the default runtime.
  const runtime = new SimulatedRuntimeAdapter();
  const participants = [aria, marcus, lena];
  const topic = 'MVP scope and persistence for the virtual employee system';
  const result = await runtime.runMeeting({ topic, participants, rounds: 3 });
  insertMeeting({
    topic,
    participantIds: participants.map((p) => p.id),
    participants: participants.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
    rounds: 3,
    transcript: result.transcript,
    minutes: result.minutes,
    report: result.report,
    grounding: result.grounding,
    runtime: result.runtime,
  });

  return { employees: employees.length, documents: docs.length, meetings: 1 };
}

// Run when invoked directly.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const counts = await seed();
  console.log(`Seeded ${counts.employees} employees, ${counts.documents} knowledge documents, ${counts.meetings} meeting.`);
}
