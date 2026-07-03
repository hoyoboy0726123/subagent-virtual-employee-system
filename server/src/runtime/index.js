// Runtime adapter registry + factory.
//
// The active runtime mode is a persisted setting (see settings.service). This
// module maps a mode string → a singleton adapter instance so services can do
// `getRuntime()` without knowing which implementation is active.
import { SimulatedRuntimeAdapter } from './SimulatedRuntimeAdapter.js';
import { OpenClawRuntimeAdapter } from './OpenClawRuntimeAdapter.js';

const ADAPTERS = {
  simulated: new SimulatedRuntimeAdapter(),
  openclaw: new OpenClawRuntimeAdapter(),
};

export const RUNTIME_MODES = Object.keys(ADAPTERS);

export function getRuntimeAdapter(mode) {
  return ADAPTERS[mode] || ADAPTERS.simulated;
}

export { AgentRuntimeAdapter } from './AgentRuntimeAdapter.js';
