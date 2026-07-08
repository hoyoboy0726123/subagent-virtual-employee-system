// In-app API key management (Gemini + Tavily web search).
//
// Keys entered in the UI are stored in the LOCAL SQLite settings table — the
// database file is gitignored, single-user, on the user's own machine, so this
// is the same trust boundary as a .env file but friendlier. Environment
// variables still work: the EFFECTIVE key is「UI 儲存的金鑰 → 環境變數」in that
// order, so a UI-entered key wins and clearing it falls back to the env.
//
// Safety rules enforced here:
//   • a stored key is NEVER returned to the client in full — status responses
//     carry only `configured` / `source` / a 4-char tail for recognition;
//   • test-connection errors are sanitized so the key can't echo back through
//     an upstream error message;
//   • both testers are dependency-injectable (fetchImpl / clientFactory) so the
//     hermetic test suite never touches the network.
import { getSetting, setSetting } from '../storage/settings.repo.js';
import { config } from '../config.js';

export const GEMINI_KEY_SETTING = 'apiKeyGemini';
export const TAVILY_KEY_SETTING = 'apiKeyTavily';

// Settings live in SQLite; in exotic no-DB contexts behave as "not stored".
const stored = (key) => {
  try { return (getSetting(key) || '').trim(); } catch { return ''; }
};

/** Effective Google/Gemini key: UI-saved value first, then the environment. */
export function effectiveGeminiKey() {
  return stored(GEMINI_KEY_SETTING) || config.llm.apiKey;
}

/** Effective Tavily/web-search key: UI-saved value first, then the environment. */
export function effectiveTavilyKey() {
  return stored(TAVILY_KEY_SETTING) || config.tools.webSearch.apiKey;
}

const describe = (uiKey, envKey) => ({
  configured: Boolean(uiKey || envKey),
  // Where the effective key comes from — the UI shows「UI 設定」/「環境變數」.
  source: uiKey ? 'ui' : (envKey ? 'env' : null),
  // Recognition only, never the key itself.
  tail: (uiKey || envKey) ? `…${(uiKey || envKey).slice(-4)}` : null,
});

/** Masked status of both keys (safe to send to the client). */
export function keyStatus() {
  return {
    gemini: describe(stored(GEMINI_KEY_SETTING), config.llm.apiKey),
    tavily: describe(stored(TAVILY_KEY_SETTING), config.tools.webSearch.apiKey),
  };
}

/**
 * Save (or clear, with '') the UI-managed keys. Only fields present in the
 * patch are touched. Returns the masked status — never the keys.
 */
export function saveKeys({ gemini, tavily } = {}) {
  if (gemini !== undefined) setSetting(GEMINI_KEY_SETTING, String(gemini).trim());
  if (tavily !== undefined) setSetting(TAVILY_KEY_SETTING, String(tavily).trim());
  return keyStatus();
}

// A failed upstream call must not echo the key back to the browser.
const sanitize = (message, key) => String(message || '連線失敗').split(key).join('［金鑰］');

/**
 * Test a Gemini key with one minimal real generation call.
 * @param {string} [key]  key to test; falls back to the effective key
 * @param {{clientFactory?: (key: string) => object}} [opts] injectable client (tests)
 * @returns {Promise<{ok: boolean, model?: string, error?: string}>}
 */
export async function testGeminiKey(key, { clientFactory } = {}) {
  const k = String(key || '').trim() || effectiveGeminiKey();
  if (!k) return { ok: false, error: '未提供金鑰' };
  try {
    let client;
    if (clientFactory) {
      client = clientFactory(k);
    } else {
      const { GoogleGenAI } = await import('@google/genai');
      client = new GoogleGenAI({ apiKey: k });
    }
    // Smallest honest probe: one real (tiny) generation against the configured
    // model — success means key + model access + quota all check out.
    await Promise.race([
      client.models.generateContent({
        model: config.llm.model,
        contents: 'ping',
        config: { maxOutputTokens: 20 },
      }),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(new Error('連線逾時（15 秒）')), 15_000);
        t.unref?.();
      }),
    ]);
    return { ok: true, model: config.llm.model };
  } catch (err) {
    return { ok: false, error: sanitize(err.message, k) };
  }
}

/**
 * Test a Tavily/web-search key with one minimal search call.
 * @param {string} [key]  key to test; falls back to the effective key
 * @param {{fetchImpl?: Function}} [opts] injectable fetch (tests)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function testTavilyKey(key, { fetchImpl = fetch } = {}) {
  const k = String(key || '').trim() || effectiveTavilyKey();
  if (!k) return { ok: false, error: '未提供金鑰' };
  try {
    const res = await fetchImpl(config.tools.webSearch.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` },
      body: JSON.stringify({ query: 'connectivity test', max_results: 1 }),
      redirect: 'error', // same safety stance as the web_search tool
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) return { ok: true };
    const hint = res.status === 401 || res.status === 403 ? '（金鑰無效或權限不足）' : '';
    return { ok: false, error: `搜尋服務回應 ${res.status}${hint}` };
  } catch (err) {
    return { ok: false, error: sanitize(err.message, k) };
  }
}
