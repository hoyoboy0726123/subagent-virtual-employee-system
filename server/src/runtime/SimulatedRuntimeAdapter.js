// Default runtime: fully offline, deterministic, retrieval-grounded.
//
// Employees "reason" via the deterministic engine, grounded with knowledge
// chunks pulled from the retrieval layer (simple RAG). If a live LLM is
// configured (ANTHROPIC_API_KEY), the meeting report / goal plan are enriched by
// Claude — but the transcript, minutes, grounding and every fallback remain the
// deterministic engine's, so the app never depends on the network.
import { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
import * as engine from '../reasoning/engine.js';
import { groundingFor } from '../storage/retrieval.js';
import { complete, llmEnabled } from '../reasoning/llm.js';

export class SimulatedRuntimeAdapter extends AgentRuntimeAdapter {
  get mode() { return 'simulated'; }
  get label() { return llmEnabled() ? 'Simulated + LLM' : 'Simulated'; }

  async health() {
    return { mode: this.mode, label: this.label, ready: true, llm: llmEnabled() };
  }

  async runMeeting({ topic, participants, rounds }) {
    const { byEmployee, flat } = groundingFor({ query: topic, employees: participants });

    const result = engine.runMeeting({ topic, participants, rounds, groundingByEmployee: byEmployee });

    if (llmEnabled()) {
      const knowledgeBlock = flat.length
        ? `\n\nRelevant team knowledge (cite where useful):\n${flat.map((h) => `- (${h.employeeName}) ${h.documentTitle}: ${h.content}`).join('\n')}`
        : '';
      const text = await complete(
        'You are a meeting facilitator producing a concise executive report grounded in the team knowledge provided.',
        `Topic: ${topic}\nParticipants: ${participants.map((p) => `${p.name} (${p.roleTitle})`).join(', ')}\nTranscript:\n${result.transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n')}${knowledgeBlock}\n\nWrite a concise markdown report with Summary, Decisions, Action Items, Recommendation.`,
      );
      if (text) result.report = text.trim();
    }

    return {
      ...result,
      grounding: flat,
      runtime: { mode: this.mode, label: this.label, grounded: flat.length, fallback: false },
    };
  }

  async executeGoal({ title, description, assignees }) {
    const query = `${title} ${description || ''}`.trim();
    const { byEmployee, flat } = groundingFor({ query, employees: assignees });

    const result = engine.executeGoal({ title, description, assignees, groundingByEmployee: byEmployee });

    if (llmEnabled()) {
      const knowledgeBlock = flat.length
        ? `\n\nRelevant team knowledge:\n${flat.map((h) => `- (${h.employeeName}) ${h.documentTitle}: ${h.content}`).join('\n')}`
        : '';
      const text = await complete(
        'You are a program manager writing a collaboration plan grounded in the team knowledge provided.',
        `Goal: ${title}\n${description || ''}\nAssignees: ${assignees.map((p) => `${p.name} (${p.roleTitle})`).join(', ')}${knowledgeBlock}\n\nWrite a concise markdown collaboration output: Plan, per-owner subtasks, Integration, Next Steps.`,
      );
      if (text) result.output = text.trim();
    }

    return {
      ...result,
      grounding: flat,
      runtime: { mode: this.mode, label: this.label, grounded: flat.length, fallback: false },
    };
  }
}
