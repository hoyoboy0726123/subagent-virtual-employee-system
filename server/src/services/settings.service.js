// Service: settings. The active runtime mode plus the web-search toggle; the
// store is generic key/value so more switches can be added without schema
// changes.
import { getSetting, setSetting } from '../storage/settings.repo.js';
import { config } from '../config.js';
import { RUNTIME_MODES, getRuntimeAdapter, normalizeMode } from '../runtime/index.js';
import { badRequest } from '../util/http.js';
import { WEB_SEARCH_SETTING_KEY, webSearchConfigured, webSearchEnabled } from '../reasoning/tools.js';

const RUNTIME_KEY = 'runtimeMode';

export function getRuntimeMode() {
  // normalizeMode maps legacy stored values (e.g. 'simulated') to current ones
  // so existing databases keep working after the Phase 5 standalone refactor.
  return normalizeMode(getSetting(RUNTIME_KEY) || config.defaultRuntime);
}

export function getActiveRuntime() {
  return getRuntimeAdapter(getRuntimeMode());
}

export function setRuntimeMode(mode) {
  const normalized = normalizeMode(mode);
  if (!RUNTIME_MODES.includes(normalized)) {
    throw badRequest(`未知的執行環境模式「${mode}」——預期為下列其中之一：${RUNTIME_MODES.join('、')}`);
  }
  setSetting(RUNTIME_KEY, normalized);
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
  const mode = getRuntimeMode();
  return {
    runtimeMode: mode,
    availableModes: RUNTIME_MODES,
    runtimeLabel: getRuntimeAdapter(mode).label,
    webSearch: {
      keyConfigured: webSearchConfigured(),
      enabled: webSearchEnabled(),
    },
  };
}

export async function getSettingsWithHealth() {
  const settings = getSettings();
  const runtimes = {};
  for (const mode of RUNTIME_MODES) {
    runtimes[mode] = await getRuntimeAdapter(mode).health();
  }
  return { ...settings, runtimes };
}
