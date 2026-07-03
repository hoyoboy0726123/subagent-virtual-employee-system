// The "subagent" reasoning engine.
//
// This MVP simulates each virtual employee's contribution deterministically
// from their persona (role, expertise, personality, communication style) plus
// their personal knowledge base. No external LLM is required — every function
// here is pure and runs offline.
//
// An optional live-LLM path lives in llm.js; routes prefer it when a key is
// present and fall back to these deterministic generators otherwise.

const asList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

function firstName(name = '') {
  return name.trim().split(/\s+/)[0] || 'Employee';
}

// ---------------------------------------------------------------------------
// 1. Profile / background generation
// ---------------------------------------------------------------------------
export function generateProfile(input) {
  const name = input.name || 'New Employee';
  const role = input.roleTitle || 'Team Member';
  const expertise = asList(input.expertise);
  const personality = input.personality || 'pragmatic and collaborative';
  const style = input.communicationStyle || 'clear and concise';
  const objectives = input.objectives || 'help the team ship high-quality work';

  const expertiseLine = expertise.length
    ? expertise.join(', ')
    : 'general problem solving';

  return [
    `${name} is a ${role} on the team.`,
    ``,
    `Background: ${name} brings deep experience in ${expertiseLine}. They are known for being ${personality}, and approach problems by grounding decisions in evidence and the team's goals.`,
    ``,
    `Working style: ${name} communicates in a ${style} manner. In discussions they focus on ${expertise[0] || 'the core problem'}, surface trade-offs early, and push for concrete next steps.`,
    ``,
    `Objectives: ${objectives}.`,
    ``,
    `Operating principles:`,
    `- Anchor every recommendation to the stated goal and known constraints.`,
    `- Reference relevant knowledge before opinion.`,
    `- Prefer small, verifiable steps over big-bang plans.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 2. Role ideation — manager describes what they want, we draft a full role
// ---------------------------------------------------------------------------
const ROLE_LIBRARY = [
  { match: /(front|ui|ux|design|react|css)/i, roleTitle: 'Frontend Engineer', expertise: ['React', 'UI/UX', 'accessibility', 'design systems'], personality: 'detail-oriented and user-empathetic', style: 'visual and example-driven' },
  { match: /(back|api|server|database|infra|devops|cloud)/i, roleTitle: 'Backend Engineer', expertise: ['APIs', 'databases', 'scalability', 'reliability'], personality: 'systematic and risk-aware', style: 'precise and structured' },
  { match: /(\bdata\b|analytics|\bml\b|\bai\b|machine learning|\bmodel\b|scien)/i, roleTitle: 'Data Scientist', expertise: ['statistics', 'machine learning', 'experimentation', 'data storytelling'], personality: 'curious and rigorous', style: 'evidence-first and quantified' },
  { match: /(product|pm|road|strategy|market fit)/i, roleTitle: 'Product Manager', expertise: ['product strategy', 'roadmapping', 'user research', 'prioritization'], personality: 'decisive and outcome-focused', style: 'crisp and narrative' },
  { match: /(market|growth|brand|content|seo|campaign)/i, roleTitle: 'Marketing Lead', expertise: ['positioning', 'content', 'growth loops', 'analytics'], personality: 'creative and data-informed', style: 'persuasive and punchy' },
  { match: /(sales|revenue|account|customer success|deal)/i, roleTitle: 'Sales Lead', expertise: ['pipeline management', 'negotiation', 'discovery', 'relationship building'], personality: 'energetic and persistent', style: 'warm and outcome-driven' },
  { match: /(finance|budget|account|cfo|cost)/i, roleTitle: 'Finance Analyst', expertise: ['financial modeling', 'budgeting', 'forecasting', 'unit economics'], personality: 'careful and skeptical', style: 'numbers-first and conservative' },
  { match: /(legal|compliance|risk|policy|privacy)/i, roleTitle: 'Legal & Compliance Advisor', expertise: ['contracts', 'compliance', 'risk assessment', 'privacy'], personality: 'meticulous and cautious', style: 'formal and qualified' },
  { match: /(ops|operation|project|program|coordinat)/i, roleTitle: 'Operations Manager', expertise: ['process design', 'coordination', 'logistics', 'execution'], personality: 'organized and reliable', style: 'checklist-driven and clear' },
  { match: /(research|analyst|insight|explore)/i, roleTitle: 'Research Analyst', expertise: ['research', 'synthesis', 'competitive analysis', 'reporting'], personality: 'thorough and objective', style: 'balanced and cited' },
];

export function ideateRole(description = '') {
  const desc = String(description);
  const hit = ROLE_LIBRARY.find((r) => r.match.test(desc)) || {
    roleTitle: 'Generalist Team Member',
    expertise: ['problem solving', 'communication', 'collaboration'],
    personality: 'adaptable and pragmatic',
    style: 'clear and concise',
  };

  // Try to lift a proper-noun-ish name out of the description; otherwise coin one.
  const nameGuess = (desc.match(/named?\s+([A-Z][a-z]+)/) || [])[1];
  const roleWord = hit.roleTitle.split(' ')[0];
  const name = nameGuess || `${roleWord} Persona`;

  const draft = {
    name,
    roleTitle: hit.roleTitle,
    expertise: hit.expertise,
    personality: hit.personality,
    communicationStyle: hit.style,
    objectives: `Own the ${hit.roleTitle.toLowerCase()} responsibilities and help the team reach its goals through ${hit.expertise[0]}.`,
  };
  draft.profile = generateProfile(draft);
  draft.rationale = `Drafted from your description "${desc.slice(0, 120)}${desc.length > 120 ? '…' : ''}" — matched to a ${hit.roleTitle} archetype. Edit any field before saving.`;
  return draft;
}

// ---------------------------------------------------------------------------
// 3. Meeting orchestration
// ---------------------------------------------------------------------------
function knowledgeFor(emp, knowledge) {
  return knowledge.filter((k) => k.employeeId === emp.id);
}

// One persona-flavored contribution given the topic, round and prior remarks.
function speak(emp, topic, round, priorSpeakers, notes) {
  const expertise = asList(emp.expertise);
  const focus = expertise[Math.min(round, expertise.length - 1)] || expertise[0] || 'the problem';
  const noteRef = notes.length
    ? ` Drawing on my notes ("${notes[round % notes.length].title}"), `
    : ' ';

  if (round === 0) {
    return `From a ${emp.roleTitle} perspective, the key question on "${topic}" is how it affects ${focus}.${noteRef}I'd start by clarifying our success criteria and constraints.`;
  }
  if (round === 1) {
    const react = priorSpeakers.length
      ? `Building on ${firstName(priorSpeakers[0])}'s point, `
      : '';
    return `${react}I see the main risk around ${focus}.${noteRef}my recommendation is to prototype the smallest viable slice and measure it before committing.`;
  }
  // Final round: converge on an action.
  return `To wrap up my part on "${topic}": I'll own the ${focus} workstream, define clear acceptance criteria, and report back with results. Let's align on owners and a check-in date.`;
}

export function runMeeting({ topic, participants, knowledge, rounds = 3 }) {
  const transcript = [];
  const roundTitles = ['Opening positions', 'Analysis & risks', 'Decisions & next steps'];

  for (let r = 0; r < rounds; r++) {
    const priorSpeakers = [];
    for (const emp of participants) {
      const notes = knowledgeFor(emp, knowledge);
      const text = speak(emp, topic, r, priorSpeakers, notes);
      transcript.push({
        round: r + 1,
        roundTitle: roundTitles[r] || `Round ${r + 1}`,
        speaker: emp.name,
        role: emp.roleTitle,
        speakerId: emp.id,
        text,
      });
      priorSpeakers.push(emp.name);
    }
  }

  const minutes = buildMinutes({ topic, participants, transcript });
  const report = buildReport({ topic, participants, minutes });
  return { transcript, minutes, report };
}

function buildMinutes({ topic, participants, transcript }) {
  const attendees = participants.map((p) => `${p.name} (${p.roleTitle})`);
  const keyPoints = transcript
    .filter((t) => t.round <= 2)
    .map((t) => `- ${t.speaker}: ${t.text}`);
  const decisions = participants.map(
    (p) => `- ${p.name} to own the ${asList(p.expertise)[0] || 'assigned'} workstream with defined acceptance criteria.`
  );
  const actionItems = participants.map((p) => ({
    owner: p.name,
    action: `Define acceptance criteria and deliver first slice for "${topic}"`,
    due: 'next check-in',
  }));

  return {
    topic,
    attendees,
    agenda: [`Discuss "${topic}"`, 'Surface risks and trade-offs', 'Agree on owners and next steps'],
    keyPoints,
    decisions,
    actionItems,
  };
}

function buildReport({ topic, participants, minutes }) {
  const names = participants.map((p) => firstName(p.name)).join(', ');
  return [
    `# Meeting Report: ${topic}`,
    ``,
    `**Attendees:** ${minutes.attendees.join(', ')}`,
    ``,
    `## Summary`,
    `${participants.length} team member(s) — ${names} — met to discuss "${topic}". The group aligned on success criteria, surfaced the main risks from each discipline's perspective, and agreed to proceed with a small, measurable first slice before wider investment.`,
    ``,
    `## Decisions`,
    ...minutes.decisions,
    ``,
    `## Action Items`,
    ...minutes.actionItems.map((a) => `- **${a.owner}** — ${a.action} (due: ${a.due})`),
    ``,
    `## Recommendation`,
    `Proceed to a time-boxed prototype. Reconvene at the next check-in to review measured results before committing further resources.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// 4. Goal assignment & collaborative execution
// ---------------------------------------------------------------------------
export function executeGoal({ title, description, assignees, knowledge }) {
  const tasks = assignees.map((emp, i) => {
    const expertise = asList(emp.expertise);
    const notes = knowledgeFor(emp, knowledge);
    return {
      assignee: emp.name,
      assigneeId: emp.id,
      role: emp.roleTitle,
      subtask: `Lead the ${expertise[0] || 'core'} aspects of "${title}"`,
      approach: `Apply ${expertise.slice(0, 2).join(' & ') || 'domain expertise'}${notes.length ? `, informed by ${notes.length} knowledge note(s)` : ''}. Deliver a reviewable artifact and flag dependencies.`,
      status: 'in-progress',
      order: i + 1,
    };
  });

  const output = buildCollaborationOutput({ title, description, tasks, assignees });
  return { tasks, output };
}

function buildCollaborationOutput({ title, description, tasks, assignees }) {
  return [
    `# Collaboration Output: ${title}`,
    ``,
    description ? `**Goal:** ${description}\n` : '',
    `## Plan`,
    `The goal was decomposed across ${assignees.length} employee(s), each owning the slice matched to their expertise:`,
    ``,
    ...tasks.map((t) => `- **${t.assignee}** (${t.role}) — ${t.subtask}. ${t.approach}`),
    ``,
    `## Integration`,
    `Owners deliver their slices in parallel, then integrate at the interfaces they share. ${assignees.length > 1 ? `${firstName(assignees[0].name)} coordinates hand-offs and resolves conflicts.` : 'The single owner drives end-to-end.'}`,
    ``,
    `## Next Steps`,
    `1. Each owner confirms acceptance criteria for their slice.`,
    `2. Deliver first versions and integrate.`,
    `3. Review against the goal and iterate.`,
  ].filter(Boolean).join('\n');
}
