// Agent toolbox (Phase 13) — the tools an employee agent may call DURING a turn.
//
// Until now agents were push-fed: the orchestrator pre-retrieved knowledge by
// topic keywords and injected it into the prompt, and the agent could never ask
// for more. This module makes tool use *pull-based and agent-initiated*:
//
//   • `search_knowledge` — the agent re-queries ITS OWN knowledge base with a
//     query it formulates itself (e.g. a term a colleague just raised). Always
//     available; it wraps the existing FTS retrieval layer, scoped to the
//     employee, so grounding honesty is preserved.
//   • `web_search` — OPTIONAL, only offered when a provider key is configured
//     (config.tools.webSearch). Standalone-first is preserved: without a key the
//     tool simply isn't in the toolbox, exactly like the live LLM/MarkItDown.
//
// The toolbox is a plain declarative registry: JSON-schema declarations (for
// native function calling on models that support it), a Traditional Chinese
// instruction block (for the prompt-protocol path used with Gemma), and one
// `execute(name, args)` dispatcher. It also keeps a `trace` of every call and
// collects knowledge hits so turns can surface HONEST citations for what the
// agent looked up on its own.
import { Type } from '@google/genai';
import { config } from '../config.js';
import { search as searchKnowledgeBase } from '../storage/retrieval.js';

export function webSearchEnabled() {
  return Boolean(config.tools.webSearch.apiKey);
}

const snippet = (text = '', n = 200) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/**
 * Try to read an agent-initiated tool request out of a model reply (the
 * prompt-protocol path for models without native function calling, i.e. Gemma).
 * Accepts the JSON alone, on the first line, or inside a code fence.
 * @param {string} text
 * @returns {{tool: string, args: object}|null}
 */
export function parseToolRequest(text = '') {
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  // A tool request must lead the reply — JSON quoted mid-sentence is speech.
  if (!cleaned.startsWith('{')) return null;
  const end = cleaned.indexOf('}', cleaned.indexOf('"tool"'));
  const candidates = [cleaned];
  const m = cleaned.match(/\{[^{}]*"tool"[^{}]*\}/s);
  if (m) candidates.push(m[0]);
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj.tool === 'string' && obj.tool) {
        return { tool: obj.tool, args: (obj.args && typeof obj.args === 'object') ? obj.args : {} };
      }
    } catch { /* keep trying */ }
  }
  return null;
}

/** Render a tool result as a prompt block (the protocol path's "functionResponse"). */
export function formatToolResult(name, result) {
  if (result?.error) return `（工具 ${name} 執行失敗：${result.error}）`;
  if (name === 'search_knowledge') {
    const hits = result?.hits || [];
    if (!hits.length) return '（知識庫中沒有與此查詢相關的內容。請依你的專業判斷發言，不要杜撰資料。）';
    return ['（你的知識庫查詢結果）', ...hits.map((h) => `- 《${h.documentTitle}》：${h.snippet}`)].join('\n');
  }
  if (name === 'web_search') {
    const results = result?.results || [];
    if (!results.length) return '（網路搜尋沒有找到相關結果。）';
    return ['（網路搜尋結果，引用時請自然帶出來源）', ...results.map((r) => `- ${r.title}（${r.url}）：${r.snippet}`)].join('\n');
  }
  return JSON.stringify(result);
}

/**
 * Build the toolbox for ONE employee agent's turn.
 *
 * @param {object} opts
 * @param {object} opts.employee            the employee this turn runs as (scopes search_knowledge)
 * @param {Function} [opts.searchKnowledge] injectable retrieval fn (hermetic tests)
 * @param {Function} [opts.fetchImpl]       injectable fetch (hermetic tests)
 * @returns {{
 *   declarations: Array, instructions: string,
 *   execute(name: string, args: object): Promise<object>,
 *   trace: Array<{tool: string, args: object, ok: boolean}>,
 *   knowledgeHits(): Array<{documentTitle: string, snippet: string}>,
 * }}
 */
export function buildToolbox({ employee, searchKnowledge = searchKnowledgeBase, fetchImpl = fetch } = {}) {
  const trace = [];
  const collectedHits = [];

  const declarations = [
    {
      name: 'search_knowledge',
      description: '搜尋你自己的個人知識庫（全文檢索）。當討論中出現你想查證、或你的既有資料可能涵蓋的主題時使用。',
      parameters: {
        type: Type.OBJECT,
        properties: { query: { type: Type.STRING, description: '要搜尋的關鍵字（繁體中文或英文皆可）' } },
        required: ['query'],
      },
    },
  ];
  if (webSearchEnabled()) {
    declarations.push({
      name: 'web_search',
      description: '搜尋網際網路上的最新資訊。當議題涉及你知識庫沒有、且需要外部事實（市場、法規、技術現況）時使用。',
      parameters: {
        type: Type.OBJECT,
        properties: { query: { type: Type.STRING, description: '搜尋關鍵字' } },
        required: ['query'],
      },
    });
  }

  const toolMenu = declarations.map((d) => `- ${d.name}：${d.description}`).join('\n');
  const instructions = [
    '【工具使用】發言前若需要更多資訊，你可以先呼叫工具。做法：整則回覆「只」輸出一行 JSON，不加任何其他文字，例如：',
    '{"tool":"search_knowledge","args":{"query":"客服 SLA 標準"}}',
    '可用工具：',
    toolMenu,
    `系統會把查詢結果回傳給你，之後你再輸出正式發言。每回合最多查 ${config.tools.maxCallsPerTurn} 次；`,
    '不需要查詢就直接發言。正式發言中絕不可出現 JSON 或工具語法。',
  ].join('\n');

  async function execute(name, args = {}) {
    const entry = { tool: name, args, ok: false };
    trace.push(entry);
    try {
      if (name === 'search_knowledge') {
        const hits = searchKnowledge({
          query: String(args.query || ''),
          employeeIds: [employee.id],
          limit: 4,
        }).map((h) => ({ documentTitle: h.documentTitle, snippet: snippet(h.content) }));
        collectedHits.push(...hits);
        entry.ok = true;
        return { hits };
      }
      if (name === 'web_search') {
        if (!webSearchEnabled()) return { error: '網路搜尋未啟用（未設定 API 金鑰）' };
        const { apiKey, endpoint, maxResults, timeoutSec } = config.tools.webSearch;
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey, query: String(args.query || ''), max_results: maxResults }),
          signal: AbortSignal.timeout(timeoutSec * 1000),
        });
        if (!res.ok) return { error: `搜尋服務回應 ${res.status}` };
        const data = await res.json();
        const results = (data.results || []).slice(0, maxResults).map((r) => ({
          title: r.title || '', url: r.url || '', snippet: snippet(r.content || r.snippet || ''),
        }));
        entry.ok = true;
        return { results };
      }
      return { error: `未知的工具：${name}` };
    } catch (err) {
      return { error: err.message };
    }
  }

  return {
    declarations,
    instructions,
    execute,
    trace,
    knowledgeHits: () => {
      const seen = new Set();
      return collectedHits.filter((h) => {
        const k = `${h.documentTitle}|${h.snippet}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
  };
}
