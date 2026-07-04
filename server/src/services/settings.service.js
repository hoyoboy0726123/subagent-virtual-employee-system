// Service: settings. Currently just the active runtime mode, but the store is
// generic key/value so more switches can be added without schema changes.
import { getSetting, setSetting } from '../storage/settings.repo.js';
import { config } from '../config.js';
import { RUNTIME_MODES, getRuntimeAdapter, normalizeMode } from '../runtime/index.js';
import { badRequest } from '../util/http.js';

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

export function getSettings() {
  const mode = getRuntimeMode();
  return {
    runtimeMode: mode,
    availableModes: RUNTIME_MODES,
    runtimeLabel: getRuntimeAdapter(mode).label,
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
