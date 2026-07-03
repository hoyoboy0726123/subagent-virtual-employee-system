// Default runtime: fully offline, deterministic, retrieval-grounded.
//
// Employees "reason" via the deterministic engine, grounded with knowledge
// chunks pulled from the retrieval layer (simple RAG). If a live LLM is
// configured (Google Gen AI — GEMINI_API_KEY), the meeting report / goal plan
// are enriched by the Gemma model — but the transcript, minutes, grounding and
// every fallback remain the deterministic engine's, so the app never depends on
// the network.
import { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
import * as engine from '../reasoning/engine.js';
import { groundingFor } from '../storage/retrieval.js';
import { complete, llmEnabled } from '../reasoning/llm.js';

export class SimulatedRuntimeAdapter extends AgentRuntimeAdapter {
  get mode() { return 'simulated'; }
  get label() { return llmEnabled() ? '模擬 ＋ Gemma' : '模擬'; }

  async health() {
    return { mode: this.mode, label: this.label, ready: true, llm: llmEnabled() };
  }

  async runMeeting({ topic, participants, rounds }) {
    const { byEmployee, flat } = groundingFor({ query: topic, employees: participants });

    const result = engine.runMeeting({ topic, participants, rounds, groundingByEmployee: byEmployee });

    if (llmEnabled()) {
      const knowledgeBlock = flat.length
        ? `\n\n相關團隊知識（適當引用）：\n${flat.map((h) => `- （${h.employeeName}）${h.documentTitle}：${h.content}`).join('\n')}`
        : '';
      const text = await complete(
        '你是一位會議主持人，根據提供的團隊知識產出一份精煉的主管級會議報告。請務必以繁體中文撰寫。',
        `主題：${topic}\n與會者：${participants.map((p) => `${p.name}（${p.roleTitle}）`).join('、')}\n逐字紀錄：\n${result.transcript.map((t) => `${t.speaker}：${t.text}`).join('\n')}${knowledgeBlock}\n\n請以繁體中文撰寫一份精煉的 Markdown 報告，包含「摘要」、「決議」、「行動項目」、「建議」四個章節。`,
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
        ? `\n\n相關團隊知識：\n${flat.map((h) => `- （${h.employeeName}）${h.documentTitle}：${h.content}`).join('\n')}`
        : '';
      const text = await complete(
        '你是一位專案經理，根據提供的團隊知識撰寫一份協作計畫。請務必以繁體中文撰寫。',
        `目標：${title}\n${description || ''}\n負責人：${assignees.map((p) => `${p.name}（${p.roleTitle}）`).join('、')}${knowledgeBlock}\n\n請以繁體中文撰寫一份精煉的 Markdown 協作產出，包含「計畫」、「各負責人子任務」、「整合」、「後續步驟」。`,
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
