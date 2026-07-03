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
//   • Gemma models on the Gemini API don't accept a separate system role, so a
//     system instruction is folded into the prompt for them (and passed as a
//     real `systemInstruction` for non-Gemma models).
import { GoogleGenAI, Type } from '@google/genai';
import { config, llmEnabled } from '../config.js';

// Re-exported so callers can build function-declaration schemas without importing
// the SDK directly (keeps the coupling in one place).
export { llmEnabled, Type };

let client = null;
function getClient() {
  if (!config.llm.apiKey) return null;
  if (!client) client = new GoogleGenAI({ apiKey: config.llm.apiKey });
  return client;
}

const isGemma = () => /^gemma/i.test(config.llm.model);

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
} = {}) {
  const ai = getClient();
  if (!ai) return null;

  const cfg = { maxOutputTokens: maxTokens, temperature };
  let body = contents ?? user ?? '';
  if (system) {
    if (isGemma()) body = `${system}\n\n${body}`;
    else cfg.systemInstruction = system;
  }
  if (tools) cfg.tools = tools;
  if (toolConfig) cfg.toolConfig = toolConfig;

  try {
    const res = await ai.models.generateContent({
      model: config.llm.model,
      contents: body,
      config: cfg,
    });
    return {
      text: res.text ?? null,
      functionCalls: res.functionCalls ?? [],
      raw: res,
    };
  } catch (err) {
    console.warn(`[llm] Google Gen AI request failed, falling back to deterministic engine: ${err.message}`);
    return null;
  }
}

/**
 * Convenience plain-text completion — the path meetings/goals use today.
 * Returns the trimmed text, or null to signal "fall back to the engine".
 */
export async function complete(system, user, maxTokens = 1500) {
  const result = await generate({ system, user, maxTokens });
  return result?.text ? result.text.trim() : null;
}
