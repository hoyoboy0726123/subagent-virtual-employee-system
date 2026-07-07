// Service: settings. The web-search toggle (and room for future switches); the
// store is generic key/value. Runtime selection was removed in Phase 17 — the
// built-in standalone multi-agent orchestration is the only runtime.
import { setSetting } from '../storage/settings.repo.js';
import { getRuntimeAdapter, DEFAULT_RUNTIME_MODE } from '../runtime/index.js';
import { badRequest } from '../util/http.js';
import { WEB_SEARCH_SETTING_KEY, webSearchConfigured, webSearchEnabled } from '../reasoning/tools.js';

export function getActiveRuntime() {
  return getRuntimeAdapter(DEFAULT_RUNTIME_MODE);
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
  };
}
