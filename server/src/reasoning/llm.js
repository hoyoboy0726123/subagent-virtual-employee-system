// Live LLM integration via Google Gen AI (`@google/genai`).
//
// The app is fully functional WITHOUT any API key — every feature falls back to
// the deterministic engine. When a Google API key is present (GEMINI_API_KEY,
// or GOOGLE_API_KEY as a fallback) the Simulated runtime uses Google's Gemma
// model (gemma-4-31b-it) to enrich reports/plans, grounded with retrieved
// knowledge. Any error (missing key, network, quota) transparently degrades to
// the deterministic engine so flows never break offline.
//
// Design notes:
//   • `GoogleGenAI` is the single client; `ai.models.generateContent(...)` is the
//     one call every path goes through (`generate()` below).
//   • `generate()` returns a normalized { text, functionCalls } shape so future
//     tool/function-calling can be layered in without touching call sites — pass
//     `tools` (see `toolset()` / `Type`) and read `.functionCalls`.
//   • Gemma 4+ handles system instructions and function calling natively at the
//     model level (same google-genai SDK surface as Gemini — see
//     https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api). Only LEGACY
//     Gemma (1–3) lacked a separate system role, so the fold-into-prompt shim
//     now applies to those models alone.
import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../config.js';
import { cliProvider, isCliProvider } from './providers/index.js';

// Re-exported so callers can build function-declaration schemas without importing
// the SDK directly (keeps the coupling in one place).
export { Type };

/**
 * Is a live reasoning brain available? Provider-aware (Phase 18):
 *   google     → a Gemini/Google API key is configured
 *   claude-cli — the official `claude` CLI answers a version probe
 *   codex-cli  — the official `codex` CLI answers a version probe
 * Everything that gates live-vs-deterministic behaviour flows through here.
 */
export function llmEnabled() {
  if (isCliProvider()) return cliProvider().availableSync();
  return Boolean(config.llm.apiKey);
}

/** Honest identity of the active brain (runtime metadata / health / UI). */
export function activeModelInfo() {
  if (isCliProvider()) {
    const p = cliProvider();
    return { provider: p.name, model: p.modelId(), label: p.label() };
  }
  return {
    provider: 'google',
    model: config.llm.model,
    label: `Google Gen AI · ${config.llm.model}`,
  };
}

/** Native function calling is a google-API capability (Gemma 4+/Gemini). CLI
 *  providers always speak the legacy prompt tool protocol instead. */
export function nativeToolsSupported(model) {
  return !isCliProvider() && !isLegacyGemma(model || config.llm.model);
}

let client = null;
function getClient() {
  if (!config.llm.apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey: config.llm.apiKey });
  return client;
}

// Gemma 1–3 needed prompt-folding for system instructions and a prompt protocol
// for tools; Gemma 4+ supports both natively, exactly like Gemini models.
// Model-sensitive checks take the EFFECTIVE model (per-agent override or the
// global default) so a per-employee model choice gets the right transport.
const isLegacyGemma = (model = config.llm.model) => /^gemma-[1-3]\b/i.test(model);

/**
 * Light abstraction point for (future) function calling: wrap plain function
 * declarations in the SDK's tool envelope so call sites stay declarative.
 * @param {Array<object>} functionDeclarations  each: {name, description, parameters}
 * @returns {Array<{functionDeclarations: Array}>}
 */
export function toolset(functionDeclarations = []) {
  return [{ functionDeclarations }];
}

/**
 * The single generation primitive. Returns a normalized result, or null on any
 * failure (missing key, network, API error) so callers fall back cleanly.
 * @param {object}   opts
 * @param {string}   [opts.system]       system instruction / persona
 * @param {string}   [opts.user]         user prompt (ignored if `contents` given)
 * @param {*}        [opts.contents]     raw contents (overrides `user`)
 * @param {Array}    [opts.tools]        tool declarations (see toolset())
 * @param {object}   [opts.toolConfig]   e.g. { functionCallingConfig: { mode } }
 * @param {number}   [opts.maxTokens]
 * @param {number}   [opts.temperature]
 * @param {string}   [opts.model]        per-call model override (per-agent config)
 * @returns {Promise<{text: string|null, functionCalls: Array, raw: object}|null>}
 */
export async function generate({
  system,
  user,
  contents,
  tools,
  toolConfig,
  maxTokens = 1500,
  temperature = 0.6,
  model,
} = {}) {
  // Phase 18: CLI subscription providers take the whole call. They are plain
  // text generators (no contents arrays / native tools — the agentic layer
  // already routes those cases to the prompt protocol).
  if (isCliProvider()) {
    if (contents !== undefined && typeof contents !== 'string') return null;
    return cliProvider().generate({ system, user: contents ?? user, maxTokens, model });
  }

  const ai = getClient();
  if (!ai) return null;
  const effModel = model || config.llm.model;

  const cfg = { maxOutputTokens: maxTokens, temperature };
  // Suppress Gemma 4's always-on thinking (see config.llm.thinkingLevel): turns
  // come back faster, and small output budgets are spent on the answer instead
  // of thought parts. Applied only to gemma-4* — other models keep their default.
  if (config.llm.thinkingLevel && /^gemma-4/i.test(effModel)) {
    cfg.thinkingConfig = { thinkingLevel: config.llm.thinkingLevel };
  }
  let body = contents ?? user ?? '';
  if (system) {
    if (isLegacyGemma(effModel)) body = `${system}\n\n${body}`;
    else cfg.systemInstruction = system;
  }
  if (tools) cfg.tools = tools;
  if (toolConfig) cfg.toolConfig = toolConfig;

  // Resilience, learned against the real API:
  //   • the Gemini API intermittently returns 500/503 on newer models (measured
  //     ~40% of calls on gemma-4-31b-it at launch, independent of parameters)
  //     and 429 under quota pressure — transient, so retry up to 5 attempts
  //     with a short backoff (drives per-call failure odds to ~1%);
  //   • gemma-4-31b-it is a THINKING model whose reasoning tokens count against
  //     maxOutputTokens (and thinkingConfig is not supported on it) — a tight
  //     budget can be consumed entirely by thought parts, yielding
  //     finishReason=MAX_TOKENS with NO text. Detect that and retry with a
  //     tripled budget instead of failing the turn.
  // Non-transient errors (bad key, bad request) fail immediately; callers fall
  // back to the deterministic engine on null.
  const TRANSIENT = /"code":\s*(429|500|503)|INTERNAL|UNAVAILABLE|RESOURCE_EXHAUSTED/;
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: effModel,
        contents: body,
        config: cfg,
      });
      const finish = res.candidates?.[0]?.finishReason;
      const starved = !res.text && !(res.functionCalls?.length) && finish === 'MAX_TOKENS';
      if (starved && cfg.maxOutputTokens && attempt < MAX_ATTEMPTS - 1) {
        cfg.maxOutputTokens *= 3; // thinking ate the whole budget — give it room
        continue;
      }
      return {
        text: res.text ?? null,
        functionCalls: res.functionCalls ?? [],
        raw: res,
      };
    } catch (err) {
      const transient = TRANSIENT.test(err.message || '');
      if (transient && attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1) ** 2)); // 0.4s → 6.4s
        continue;
      }
      console.warn(`[llm] Google Gen AI request failed, falling back to deterministic engine: ${err.message}`);
      return null;
    }
  }
  return null;
}

/**
 * Convenience plain-text completion — the path meetings/goals use today.
 * Returns the trimmed text, or null to signal "fall back to the engine".
 */
export async function complete(system, user, maxTokens = 1500) {
  const result = await generate({ system, user, maxTokens });
  return result?.text ? result.text.trim() : null;
}

// ---------------------------------------------------------------------------
// Agentic generation (Phase 13): a bounded perceive → act → observe loop that
// lets one agent turn CALL TOOLS before speaking. Two transports, one behaviour:
//   • Gemma 4+ (the default) and Gemini → NATIVE function calling (`tools` +
//     `.functionCalls`, answered with `functionResponse` parts on the contents
//     array) — Gemma 4 supports this at the model level;
//   • legacy Gemma (1–3) → a prompt protocol: the model asks for a tool by
//     replying with a single JSON line, we execute it and re-prompt with the
//     result (see tools.js parseToolRequest/formatToolResult).
// The loop is guarded by config.tools.maxCallsPerTurn and repeated-call
// detection; on any failure it returns null so callers fall back cleanly.
// ---------------------------------------------------------------------------
import { parseToolRequest, formatToolResult } from './tools.js';

/**
 * @param {object}   opts
 * @param {string}   opts.system        persona system instruction
 * @param {string}   opts.user          the turn prompt
 * @param {object}   opts.toolbox       from buildToolbox() — declarations/instructions/execute/trace
 * @param {number}   [opts.maxTokens]
 * @param {number}   [opts.temperature]
 * @param {number}   [opts.maxSteps]        tool-call budget (default config.tools.maxCallsPerTurn)
 * @param {string}   [opts.model]           per-call model override (per-agent config)
 * @param {Function} [opts._generate]       injectable generate fn (hermetic tests)
 * @param {boolean}  [opts._legacyProtocol] force the prompt-protocol transport (hermetic tests)
 * @returns {Promise<{text: string, toolCalls: number}|null>}
 */
export async function generateAgentic({
  system,
  user,
  toolbox,
  maxTokens = 700,
  temperature = 0.7,
  maxSteps = config.tools.maxCallsPerTurn,
  model,
  _generate = generate,
  _legacyProtocol = undefined,
} = {}) {
  // CLI subscription providers and legacy Gemma both lack native function
  // calling → the prompt tool protocol carries agentic tool use for them.
  const legacy = _legacyProtocol !== undefined ? _legacyProtocol : !nativeToolsSupported(model);
  if (!toolbox || !toolbox.declarations?.length) {
    const res = await _generate({ system, user, maxTokens, temperature, model });
    return res?.text ? { text: res.text.trim(), toolCalls: 0 } : null;
  }
  const seenCalls = new Set();

  if (!legacy) {
    // Native function calling: grow a contents array of turns. Toolbox policy
    // (e.g. the external-source attribution rule) rides on the system prompt.
    const sysNative = toolbox.policy ? `${system}\n\n${toolbox.policy}` : system;
    const contents = [{ role: 'user', parts: [{ text: user }] }];
    // Force convergence instead of dropping the turn: one final call with tools
    // disabled so the model MUST speak from what it already looked up.
    const converge = async () => {
      const final = await _generate({
        system: sysNative, contents, tools: toolset(toolbox.declarations),
        toolConfig: { functionCallingConfig: { mode: 'NONE' } },
        maxTokens, temperature, model,
      });
      return final?.text ? { text: final.text.trim(), toolCalls: toolbox.trace.length } : null;
    };
    for (let step = 0; step <= maxSteps; step++) {
      const res = await _generate({
        system: sysNative, contents, tools: toolset(toolbox.declarations), maxTokens, temperature, model,
      });
      if (!res) return null;
      const calls = res.functionCalls || [];
      if (!calls.length) {
        return res.text ? { text: res.text.trim(), toolCalls: toolbox.trace.length } : null;
      }
      // Budget is by ACTUAL tool calls executed (toolbox.trace), not by response
      // rounds — Gemini can emit N parallel functionCalls in a single response,
      // which used to cost only 1 "step" and could burn maxSteps × N real calls.
      if (step === maxSteps || toolbox.trace.length >= maxSteps) return converge();

      contents.push({ role: 'model', parts: calls.map((c) => ({ functionCall: c })) });
      const budget = maxSteps - toolbox.trace.length; // remaining executes this round
      const parts = [];
      let i = 0;
      for (const call of calls) {
        const key = `${call.name}:${JSON.stringify(call.args || {})}`;
        const response = i >= budget
          ? { error: '本回合工具預算已用完，請直接發言。' }
          : seenCalls.has(key)
            ? { error: '你已經用相同參數查過了，請直接發言。' }
            : await toolbox.execute(call.name, call.args || {});
        seenCalls.add(key);
        parts.push({ functionResponse: { name: call.name, response } });
        i++;
      }
      contents.push({ role: 'user', parts });
    }
    return converge();
  }

  // Legacy Gemma (1–3) prompt protocol: the tool contract lives in the
  // instructions block instead of native declarations.
  const sys = `${system}\n\n${toolbox.instructions}`;
  let convo = user;
  for (let step = 0; step <= maxSteps; step++) {
    const res = await _generate({ system: sys, user: convo, maxTokens, temperature, model });
    if (!res?.text) return null;
    const req = parseToolRequest(res.text);
    if (!req) return { text: res.text.trim(), toolCalls: toolbox.trace.length };
    if (step === maxSteps || toolbox.trace.length >= maxSteps) {
      // Force convergence: re-prompt forbidding JSON, take the speech.
      const final = await _generate({
        system: sys,
        user: `${convo}\n\n查詢次數已用完，禁止再輸出任何 JSON 或工具語法，請直接輸出你的正式發言。`,
        maxTokens, temperature, model,
      });
      const t = final?.text?.trim();
      return t && !parseToolRequest(t) ? { text: t, toolCalls: toolbox.trace.length } : null;
    }
    const key = `${req.tool}:${JSON.stringify(req.args)}`;
    const result = seenCalls.has(key)
      ? { error: '你已經用相同參數查過了，請直接發言。' }
      : await toolbox.execute(req.tool, req.args);
    seenCalls.add(key);
    const remaining = maxSteps - step - 1;
    convo = [
      convo,
      '',
      `（你呼叫了工具 ${req.tool}，參數 ${JSON.stringify(req.args)}。）`,
      formatToolResult(req.tool, result),
      '',
      remaining > 0
        ? `請根據以上結果繼續：若仍需查詢可再輸出一行工具 JSON（剩餘 ${remaining} 次），否則直接輸出你的正式發言。`
        : '查詢次數已用完。請直接輸出你的正式發言，不要再輸出 JSON。',
    ].join('\n');
  }
  return null;
}
