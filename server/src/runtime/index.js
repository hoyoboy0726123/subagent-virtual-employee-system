// Runtime adapter registry + factory.
//
// The product runs on ONE runtime: the built-in standalone multi-agent
// orchestration (no external services). The adapter seam is kept so another
// execution backend could be slotted in later, but the OpenClaw integration
// has been removed (Phase 17) — legacy DB settings that still say 'openclaw'
// or 'simulated' normalize back to 'standalone'.
import { StandaloneRuntimeAdapter } from './StandaloneRuntimeAdapter.js';

const ADAPTERS = {
  standalone: new StandaloneRuntimeAdapter(),
};

// Legacy mode names → current ones (keeps existing DB settings working).
const ALIASES = { simulated: 'standalone', openclaw: 'standalone' };

export const RUNTIME_MODES = Object.keys(ADAPTERS);
export const DEFAULT_RUNTIME_MODE = 'standalone';

export function normalizeMode(mode) {
  return ALIASES[mode] || mode;
}

export function getRuntimeAdapter(mode) {
  return ADAPTERS[normalizeMode(mode)] || ADAPTERS[DEFAULT_RUNTIME_MODE];
}

export { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
