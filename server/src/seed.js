// Seed the store with a few example employees, knowledge notes and one
// example meeting so the app is immediately explorable. Run: `npm run seed`.
import { replaceAll, id } from './db.js';
import { generateProfile, runMeeting } from './engine.js';

const now = () => new Date().toISOString();

function emp(data) {
  const e = { id: id('emp'), createdAt: now(), ...data };
  e.profile = e.profile || generateProfile(e);
  return e;
}

const aria = emp({
  name: 'Aria Chen',
  roleTitle: 'Product Manager',
  personality: 'decisive and outcome-focused',
  expertise: ['product strategy', 'roadmapping', 'user research', 'prioritization'],
  objectives: 'Ship a product customers love while keeping scope realistic.',
  communicationStyle: 'crisp and narrative',
});

const dev = emp({
  name: 'Marcus Reid',
  roleTitle: 'Backend Engineer',
  personality: 'systematic and risk-aware',
  expertise: ['APIs', 'databases', 'scalability', 'reliability'],
  objectives: 'Build a robust, maintainable backend that scales.',
  communicationStyle: 'precise and structured',
});

const design = emp({
  name: 'Lena Ortiz',
  roleTitle: 'Frontend Engineer',
  personality: 'detail-oriented and user-empathetic',
  expertise: ['React', 'UI/UX', 'accessibility', 'design systems'],
  objectives: 'Deliver a delightful, accessible interface.',
  communicationStyle: 'visual and example-driven',
});

const data = emp({
  name: 'Sam Patel',
  roleTitle: 'Data Scientist',
  personality: 'curious and rigorous',
  expertise: ['statistics', 'machine learning', 'experimentation', 'data storytelling'],
  objectives: 'Turn data into decisions the team can trust.',
  communicationStyle: 'evidence-first and quantified',
});

const employees = [aria, dev, design, data];

const knowledge = [
  { id: id('kn'), employeeId: aria.id, title: 'North-star metric', content: 'Our north-star is weekly active teams that run at least one meeting. Everything ladders up to activation.', tags: ['strategy'], createdAt: now() },
  { id: id('kn'), employeeId: aria.id, title: 'Launch constraints', content: 'MVP must run locally with zero external keys. Keep scope to the 6 core flows.', tags: ['scope'], createdAt: now() },
  { id: id('kn'), employeeId: dev.id, title: 'Persistence decision', content: 'Chose a JSON-file store over SQLite to avoid native builds. Atomic writes via temp-file rename.', tags: ['backend', 'adr'], createdAt: now() },
  { id: id('kn'), employeeId: design.id, title: 'Accessibility baseline', content: 'All interactive elements need visible focus states and ARIA labels. Target WCAG AA contrast.', tags: ['a11y'], createdAt: now() },
  { id: id('kn'), employeeId: data.id, title: 'Experiment guardrail', content: 'Never ship a change on a metric move under 2 standard errors. Always define the metric before the test.', tags: ['stats'], createdAt: now() },
];

// Pre-generate one example meeting so the Meetings tab is populated.
const participants = [aria, dev, design];
const mtgResult = runMeeting({
  topic: 'MVP scope for the virtual employee system',
  participants,
  knowledge,
  rounds: 3,
});
const meeting = {
  id: id('mtg'),
  topic: 'MVP scope for the virtual employee system',
  participantIds: participants.map((p) => p.id),
  participants: participants.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle })),
  rounds: 3,
  ...mtgResult,
  createdAt: now(),
};

replaceAll({ employees, knowledge, meetings: [meeting], goals: [] });

console.log(`Seeded ${employees.length} employees, ${knowledge.length} knowledge notes, 1 meeting.`);
