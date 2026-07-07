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
    throw badRequest('尚未設定網路搜尋金鑰。請在伺服器環境設定 TAVILY_API_KEY（或 WEB_SEARCH_API_KEY）後再開啟。');
  }
  setSetting(WEB_SEARCH_SETTING_KEY, enabled ? '1' : '0');
  return getSettings();
}

export function getSettings() {
  return {
    runtimeLabel: getActiveRuntime().label,
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
