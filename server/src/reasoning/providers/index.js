// Provider registry (Phase 18). `google` stays first-class inside llm.js (its
// retry/thinking logic is tightly coupled to the Gen AI SDK); this registry
// serves the CLI subscription providers, lazily instantiated so a hermetic
// test run never probes binaries it isn't using.
import { config } from '../../config.js';
import { createClaudeCliProvider } from './claudeCli.js';
import { createCodexCliProvider } from './codexCli.js';

const FACTORIES = {
  'claude-cli': createClaudeCliProvider,
  'codex-cli': createCodexCliProvider,
};

const instances = new Map();

/** The active CLI provider, or null when the provider is `google`/unknown. */
export function cliProvider() {
  const name = config.llm.provider;
  if (!FACTORIES[name]) return null;
  if (!instances.has(name)) instances.set(name, FACTORIES[name]());
  return instances.get(name);
}

export function isCliProvider() {
  return Boolean(FACTORIES[config.llm.provider]);
}
