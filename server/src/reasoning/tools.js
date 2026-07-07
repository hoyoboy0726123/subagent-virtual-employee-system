// Agent toolbox (Phase 13/14) — the tools an employee agent may call DURING a turn.
//
// Until now agents were push-fed: the orchestrator pre-retrieved knowledge by
// topic keywords and injected it into the prompt, and the agent could never ask
// for more. This module makes tool use *pull-based and agent-initiated*:
//
//   • `search_knowledge` — the agent re-queries ITS OWN knowledge base with a
//     query it formulates itself (e.g. a term a colleague just raised). Always
//     available; it wraps the existing FTS retrieval layer, scoped to the
//     employee, so grounding honesty is preserved.
//   • `web_search` — offered only when a provider key is configured AND the
//     in-app web-search toggle is ON (Phase 14). Uses Tavily's `advanced`
//     search depth for multiple semantically relevant snippets per source.
//     Anything an agent takes from the web MUST be attributed — the tool
//     instructions demand it, and every consulted source is tracked in
//     `webSources()` so turns can surface honest external citations.
//
// The toolbox is a plain declarative registry: JSON-schema declarations (for
// native function calling on models that support it), a Traditional Chinese
// instruction block (for the prompt-protocol path used with legacy Gemma), and
// one `execute(name, args)` dispatcher. It also keeps a `trace` of every call
// and collects knowledge hits so turns can cite what the agent looked up.
import { Type } from '@google/genai';
import { config } from '../config.js';
import { search as searchKnowledgeBase } from '../storage/retrieval.js';
import { insertDocument } from '../storage/knowledge.repo.js';
import { getSetting } from '../storage/settings.repo.js';
import { normalizeTraditional } from '../orchestration/output.js';

export const WEB_SEARCH_SETTING_KEY = 'webSearchEnabled';

/** Is a web-search provider key configured at all? (capability) */
export function webSearchConfigured() {
  return Boolean(config.tools.webSearch.apiKey);
}

/** Is the in-app toggle on? Only meaningful when a key is configured. */
export function webSearchToggledOn() {
  if (!webSearchConfigured()) return false; // short-circuit: no key → never on (and no DB touch)
  try {
    return getSetting(WEB_SEARCH_SETTING_KEY) === '1';
  } catch {
    return false; // no DB in exotic contexts → behave as off
  }
}

/** Effective availability: key present AND toggle on. This gates the toolbox. */
export function webSearchEnabled() {
  return webSearchConfigured() && webSearchToggledOn();
}

const snippet = (text = '', n = 200) => {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/**
 * Try to read an agent-initiated tool request out of a model reply (the
 * prompt-protocol path for models without native function calling, i.e. legacy
 * Gemma). Accepts the JSON alone, on the first line, or inside a code fence.
 * @param {string} text
 * @returns {{tool: string, args: object}|null}
 */
export function parseToolRequest(text = '') {
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  // Find the first balanced {...} that begins near the start of the reply.
  // Conversational models (esp. CLI providers, whose ONLY tool channel is this
  // protocol) often wrap the JSON in a lead-in ("好的，我先查：{...}") or a
  // trailing sentence — the old "whole string / no nested braces" rule silently
  // lost those calls AND leaked the raw JSON into the transcript. We still
  // require the JSON to LEAD the reply (short preamble only) so a JSON example
  // quoted mid-speech isn't mistaken for a tool call.
  const start = cleaned.indexOf('{');
  if (start < 0 || start > 40) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        const obj = JSON.parse(cleaned.slice(start, i + 1));
        if (obj && typeof obj.tool === 'string' && obj.tool) {
          return { tool: obj.tool, args: (obj.args && typeof obj.args === 'object') ? obj.args : {} };
        }
      } catch { /* not valid JSON → treat as speech */ }
      return null;
    }
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
    return [
      '（網路搜尋結果。凡引用下列任何內容，務必在發言中說明出處，格式如「根據 <來源名稱>」）',
      ...results.map((r) => `- ${r.title}（${r.url}）：${r.snippet}`),
    ].join('\n');
  }
  if (name === 'remember') {
    return `（已寫入你的知識庫：《${result?.title || ''}》。請繼續你的發言。）`;
  }
  return JSON.stringify(result);
}

/**
 * Build the toolbox for ONE employee agent's turn.
 *
 * @param {object} opts
 * @param {object} opts.employee            the employee this turn runs as (scopes search_knowledge)
 * @param {boolean} [opts.research]         research mode: bigger result sets + richer content per query
 * @param {Function} [opts.searchKnowledge] injectable retrieval fn (hermetic tests)
 * @param {Function} [opts.saveMemory]      injectable persistence fn for `remember` (hermetic tests)
 * @param {Function} [opts.fetchImpl]       injectable fetch (hermetic tests)
 * @param {boolean} [opts._webEnabled]      injectable web gate (hermetic tests)
 * @returns {{
 *   declarations: Array, instructions: string,
 *   execute(name: string, args: object): Promise<object>,
 *   trace: Array<{tool: string, args: object, ok: boolean}>,
 *   knowledgeHits(): Array<{documentTitle: string, snippet: string}>,
 *   webSources(): Array<{title: string, url: string}>,
 * }}
 */
export function buildToolbox({
  employee,
  research = false,
  searchKnowledge = searchKnowledgeBase,
  saveMemory = (employeeId, data) => insertDocument(employeeId, data),
  fetchImpl = fetch,
  _webEnabled = undefined,
} = {}) {
  // Effective web access = global gate (key + toggle) AND this agent's own
  // permission (agentConfig.webSearch === false forbids it per-employee).
  const globallyOn = _webEnabled !== undefined ? _webEnabled : webSearchEnabled();
  const webOn = globallyOn && employee?.agentConfig?.webSearch !== false;
  const trace = [];
  const collectedHits = [];
  const collectedSources = [];

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
  if (webOn) {
    declarations.push({
      name: 'web_search',
      description: '深度搜尋網際網路上的最新資訊。當議題涉及你知識庫沒有、且需要外部事實（市場、法規、技術現況、新聞）時使用。引用結果時必須說明出處。',
      parameters: {
        type: Type.OBJECT,
        properties: { query: { type: Type.STRING, description: '搜尋關鍵字（英文查詢通常涵蓋較廣）' } },
        required: ['query'],
      },
    });
  }
  declarations.push({
    name: 'remember',
    description: '把一個值得長期記住的具體事實或決議寫進你自己的知識庫（例如你查證到的關鍵數據、你做出的承諾）。只記真正重要、日後會用到的事，不要記閒聊。',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: '簡短標題' },
        fact: { type: Type.STRING, description: '要記住的內容（1–3 句，具體）' },
      },
      required: ['title', 'fact'],
    },
  });

  const toolMenu = declarations.map((d) => `- ${d.name}：${d.description}`).join('\n');
  // Policy that applies on BOTH transports (native function calling folds it
  // into the system instruction; the legacy protocol embeds it in instructions).
  const policy = webOn
    ? ['【主動查證】當主題涉及「最新」資訊、市場/競品現況、法規或任何你記憶可能過時的外部事實時，你應「主動」先呼叫 web_search 查證，再發言；',
       '未經查證就引用外部數字或動態，是嚴重錯誤。',
       '【外部資料出處】只要你的論述使用了網路搜尋（web_search）取得的資料，必須自然地說明出處（來源名稱或網站），不可假裝是自己原本就知道的。'].join('\n')
    : '';
  const instructions = [
    '【工具使用】發言前若需要更多資訊，你可以先呼叫工具。做法：整則回覆「只」輸出一行 JSON，不加任何其他文字，例如：',
    '{"tool":"search_knowledge","args":{"query":"客服 SLA 標準"}}',
    '可用工具：',
    toolMenu,
    `系統會把查詢結果回傳給你，之後你再輸出正式發言。每回合最多查 ${research ? config.tools.researchMaxCalls : config.tools.maxCallsPerTurn} 次；`,
    '不需要查詢就直接發言。正式發言中絕不可出現 JSON 或工具語法。',
    ...(policy ? [policy] : []),
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
        if (!webOn) return { error: '網路搜尋未啟用（缺少 API 金鑰或開關未開）' };
        const { apiKey, endpoint, timeoutSec, depth, chunksPerSource, maxResults } = config.tools.webSearch;
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query: String(args.query || ''),
            search_depth: depth,                       // 'advanced' → multiple relevant snippets/source
            chunks_per_source: chunksPerSource,        // advanced-only, up to 3
            max_results: research ? Math.max(maxResults, 8) : maxResults,
            ...(research ? { include_raw_content: false, include_answer: 'basic' } : {}),
          }),
          // Don't follow redirects — a compromised/misconfigured upstream must
          // not bounce this authenticated request at an internal host.
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutSec * 1000),
        });
        if (!res.ok) return { error: `搜尋服務回應 ${res.status}` };
        const data = await res.json();
        const results = (data.results || []).map((r) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: snippet(r.content || r.snippet || '', research ? 600 : 260),
        }));
        for (const r of results) collectedSources.push({ title: r.title, url: r.url });
        entry.ok = true;
        return { results, ...(data.answer ? { answer: snippet(data.answer, 400) } : {}) };
      }
      if (name === 'remember') {
        const title = String(args.title || '').trim();
        const fact = String(args.fact || '').trim();
        if (!title || !fact) return { error: 'remember 需要 title 與 fact' };
        const doc = saveMemory(employee.id, {
          title: `記憶：${normalizeTraditional(title)}`,
          content: normalizeTraditional(fact), // enforce TC before it enters the KB
          source: 'memory',
          tags: ['memory', 'self'],
          metadata: { rememberedBy: employee.name },
        });
        entry.ok = true;
        return { saved: true, title: doc?.title || title };
      }
      return { error: `未知的工具：${name}` };
    } catch (err) {
      return { error: err.message };
    }
  }

  return {
    declarations,
    instructions,
    policy,
    execute,
    trace,
    knowledgeHits: () => dedupe(collectedHits, (h) => `${h.documentTitle}|${h.snippet}`),
    webSources: () => dedupe(collectedSources, (s) => s.url),
  };
}

function dedupe(list, keyOf) {
  const seen = new Set();
  return list.filter((x) => {
    const k = keyOf(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
