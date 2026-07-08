// Service: settings. The web-search toggle + the reasoning-brain (LLM
// provider) selector; the store is generic key/value. Runtime selection was
// removed in Phase 17 — the built-in standalone multi-agent orchestration is
// the only runtime.
import { setSetting } from '../storage/settings.repo.js';
import { getRuntimeAdapter, DEFAULT_RUNTIME_MODE } from '../runtime/index.js';
import { badRequest } from '../util/http.js';
import { WEB_SEARCH_SETTING_KEY, webSearchConfigured, webSearchEnabled } from '../reasoning/tools.js';
import { LLM_PROVIDER_SETTING_KEY, PROVIDER_IDS, listProviders, currentProviderName } from '../reasoning/providers/index.js';
import { activeModelInfo, llmEnabled } from '../reasoning/llm.js';
import { keyStatus, saveKeys, testGeminiKey, testTavilyKey } from '../reasoning/apiKeys.js';

export function getActiveRuntime() {
  return getRuntimeAdapter(DEFAULT_RUNTIME_MODE);
}

/**
 * Switch the reasoning brain (Phase 18): google | claude-cli | codex-cli.
 * CLI subscription brains must be installed AND logged in before they can be
 * selected; google is always selectable (without a key it honestly runs the
 * offline deterministic engine).
 */
export function setLlmProvider(id) {
  if (!PROVIDER_IDS.includes(id)) {
    throw badRequest(`未知的大腦「${id}」——可選：${PROVIDER_IDS.join('、')}`);
  }
  const status = listProviders().find((p) => p.id === id);
  if (!status.selectable) {
    throw badRequest(`無法切換到「${status.label}」：${status.detail}`);
  }
  setSetting(LLM_PROVIDER_SETTING_KEY, id);
  return getSettings();
}

/**
 * Toggle agent web search (Phase 14). Turning it ON requires a provider key —
 * the toggle is an authorization switch, not a substitute for configuration.
 */
export function setWebSearchEnabled(enabled) {
  if (enabled && !webSearchConfigured()) {
    throw badRequest('尚未設定網路搜尋金鑰。請點頂欄的「🔑 API 金鑰」輸入 Tavily 金鑰（或在伺服器環境設定 TAVILY_API_KEY）後再開啟。');
  }
  setSetting(WEB_SEARCH_SETTING_KEY, enabled ? '1' : '0');
  return getSettings();
}

/**
 * Save UI-managed API keys (Gemini / Tavily); '' clears a key back to the env
 * fallback. Returns full settings so the topbar refreshes in one round-trip.
 */
export function setApiKeys(patch = {}) {
  saveKeys({ gemini: patch.gemini, tavily: patch.tavily });
  return getSettings();
}

/** Test-connect one provider ('gemini' | 'tavily') with `key` (or the stored one). */
export async function testApiKey(provider, key) {
  if (provider === 'gemini') return testGeminiKey(key);
  if (provider === 'tavily') return testTavilyKey(key);
  throw badRequest('未知的供應商——可選:gemini、tavily');
}

export function getSettings() {
  return {
    runtimeLabel: getActiveRuntime().label,
    // Masked key status only — the stored keys themselves never leave the server.
    apiKeys: keyStatus(),
    webSearch: {
      keyConfigured: webSearchConfigured(),
      enabled: webSearchEnabled(),
    },
    llm: {
      provider: currentProviderName(),
      live: llmEnabled(),
      active: activeModelInfo(),
      providers: listProviders(),
    },
  };
}
