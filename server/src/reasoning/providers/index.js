// Provider registry (Phase 18). `google` stays first-class inside llm.js (its
// retry/thinking logic is tightly coupled to the Gen AI SDK); this registry
// serves the CLI subscription providers, lazily instantiated so a hermetic
// test run never probes binaries it isn't using.
//
// The ACTIVE provider is a runtime choice: the manager picks the brain in the
// UI (persisted settings key 'llmProvider'), with the LLM_PROVIDER env var as
// the boot-time default.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { getSetting } from '../../storage/settings.repo.js';
import { effectiveGeminiKey } from '../apiKeys.js';
import { createClaudeCliProvider } from './claudeCli.js';
import { createCodexCliProvider } from './codexCli.js';

export const LLM_PROVIDER_SETTING_KEY = 'llmProvider';
export const PROVIDER_IDS = ['google', 'claude-cli', 'codex-cli'];

const FACTORIES = {
  'claude-cli': createClaudeCliProvider,
  'codex-cli': createCodexCliProvider,
};

const instances = new Map();

/** The active provider id: UI-persisted setting first, env default second. */
export function currentProviderName() {
  try {
    const stored = getSetting(LLM_PROVIDER_SETTING_KEY);
    if (stored && PROVIDER_IDS.includes(stored)) return stored;
  } catch { /* no DB in exotic contexts → env default */ }
  return PROVIDER_IDS.includes(config.llm.provider) ? config.llm.provider : 'google';
}

function instance(name) {
  if (!FACTORIES[name]) return null;
  if (!instances.has(name)) instances.set(name, FACTORIES[name]());
  return instances.get(name);
}

/** The active CLI provider, or null when the active provider is `google`. */
export function cliProvider() {
  return instance(currentProviderName());
}

export function isCliProvider() {
  return Boolean(FACTORIES[currentProviderName()]);
}

// --- login detection (the CLI owns auth; we only check that credentials
// exist so the UI can say 未安裝 vs 未登入 vs 可用) -------------------------
function claudeLoggedIn() {
  if (config.llm.claudeCli.oauthToken) return true;
  return fs.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'));
}

function codexLoggedIn() {
  return fs.existsSync(path.join(os.homedir(), '.codex', 'auth.json'));
}

/**
 * Status of every selectable brain, for the settings API / UI selector.
 * `available` — selecting it yields a LIVE brain right now.
 * `selectable` — the UI may switch to it (google is always selectable: without
 * a key it honestly runs the offline deterministic engine).
 */
export function listProviders() {
  const active = currentProviderName();
  // Effective key = UI-saved (settings) || env var — must match llmEnabled(),
  // otherwise the dropdown says「離線」while the status pill honestly says live.
  const googleKey = effectiveGeminiKey();
  const google = {
    id: 'google',
    label: 'Google Gemini API',
    model: config.llm.model,
    available: Boolean(googleKey),
    selectable: true,
    detail: googleKey
      ? `可用（${config.llm.model}）`
      : '未設定金鑰——點頂欄 🔑 輸入 Gemini 金鑰（或設定 GEMINI_API_KEY）；未設定時以離線推理引擎執行',
  };
  const cli = ['claude-cli', 'codex-cli'].map((id) => {
    const p = instance(id);
    const installed = p.availableSync();
    const loggedIn = installed && (id === 'claude-cli' ? claudeLoggedIn() : codexLoggedIn());
    const available = installed && loggedIn;
    return {
      id,
      label: id === 'claude-cli' ? 'Claude 訂閱（claude CLI）' : 'Codex 訂閱（codex CLI）',
      model: p.modelId(),
      version: installed ? p.version() : null,
      available,
      selectable: available,
      detail: !installed
        ? `未安裝 ${id === 'claude-cli' ? 'claude' : 'codex'} CLI`
        : (!loggedIn
          ? `已安裝但未登入——請在終端機執行 ${id === 'claude-cli' ? 'claude（登入你的 Pro/Max 帳號）' : 'codex login'}`
          : `可用（${p.version() || ''} · ${p.modelId()}）`),
    };
  });
  return [google, ...cli].map((p) => ({ ...p, active: p.id === active }));
}
