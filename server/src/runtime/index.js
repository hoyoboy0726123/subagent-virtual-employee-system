// Runtime adapter registry + factory.
//
// The active runtime mode is a persisted setting (see settings.service). This
// module maps a mode string → a singleton adapter instance so services can do
// `getRuntime()` without knowing which implementation is active.
//
//   • standalone (DEFAULT) — the built-in multi-agent orchestration. No external
//     runtime required; drives each employee as an in-app agent via Google Gen AI
//     with a deterministic offline fallback.
//   • openclaw  (OPTIONAL) — an external adapter that instead runs each employee
//     as a real OpenClaw subagent/session via the `openclaw` CLI → Gateway. This
//     is a bolt-on integration, not a dependency of the product.
import { StandaloneRuntimeAdapter } from './StandaloneRuntimeAdapter.js';
import { OpenClawRuntimeAdapter } from './OpenClawRuntimeAdapter.js';

const ADAPTERS = {
  standalone: new StandaloneRuntimeAdapter(),
  openclaw: new OpenClawRuntimeAdapter(),
};

// Legacy mode names → current ones (keeps existing DB settings working after the
// Phase 5 standalone refactor: the old default 'simulated' becomes 'standalone').
const ALIASES = { simulated: 'standalone' };

export const RUNTIME_MODES = Object.keys(ADAPTERS);
export const DEFAULT_RUNTIME_MODE = 'standalone';

export function normalizeMode(mode) {
  return ALIASES[mode] || mode;
}

export function getRuntimeAdapter(mode) {
  return ADAPTERS[normalizeMode(mode)] || ADAPTERS[DEFAULT_RUNTIME_MODE];
}

export { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
