// Service: settings. Currently just the active runtime mode, but the store is
// generic key/value so more switches can be added without schema changes.
import { getSetting, setSetting } from '../storage/settings.repo.js';
import { config } from '../config.js';
import { RUNTIME_MODES, getRuntimeAdapter } from '../runtime/index.js';
import { badRequest } from '../util/http.js';

const RUNTIME_KEY = 'runtimeMode';

export function getRuntimeMode() {
  return getSetting(RUNTIME_KEY) || config.defaultRuntime;
}

export function getActiveRuntime() {
  return getRuntimeAdapter(getRuntimeMode());
}

export function setRuntimeMode(mode) {
  if (!RUNTIME_MODES.includes(mode)) {
    throw badRequest(`unknown runtime mode "${mode}" — expected one of: ${RUNTIME_MODES.join(', ')}`);
  }
  setSetting(RUNTIME_KEY, mode);
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
