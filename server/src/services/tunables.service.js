// Runtime-tunable knobs (⚙️ 系統設定) — the UI face of a handful of env vars.
//
// Precedence: UI-saved override → boot value (env var or built-in default).
// Every consumer already reads `config.*` (or process.env for the distiller
// flag) AT CALL TIME, so applying an override is just mutating those live
// values — zero changes at the read sites, instant effect, no restart.
// Boot values are captured at module load; clearing an override (value: null)
// restores exactly what the process booted with, so env-var deployments keep
// their meaning.
//
// Overrides persist in the settings KV (key 'tunables', JSON of explicitly-set
// ids) and are re-applied on boot, surviving restarts.
import { config } from '../config.js';
import { getSetting, setSetting } from '../storage/settings.repo.js';
import { badRequest } from '../util/http.js';

export const TUNABLES_SETTING_KEY = 'tunables';

// The registry. `get` reads the live value; `set` applies one. Types drive
// sanitization: bool (coerced), int (finite → rounded + clamped), enum.
const DEFS = {
  // ── 記憶 ──────────────────────────────────────────────────────────────────
  // The distiller reads process.env per call (its hermetic tests toggle it
  // mid-run), so this knob writes the env var rather than a config field.
  memoryDistill: {
    type: 'bool',
    get: () => !/^(1|true|yes|on)$/i.test(process.env.MEETING_MEMORY_DISABLE || ''),
    set: (on) => { process.env.MEETING_MEMORY_DISABLE = on ? '' : '1'; },
  },
  memoryConsolidate: {
    type: 'bool',
    get: () => !config.memory.consolidateDisabled,
    set: (on) => { config.memory.consolidateDisabled = !on; },
  },
  consolidateThreshold: {
    type: 'int', min: 2, max: 200,
    get: () => config.memory.consolidateThreshold,
    set: (v) => { config.memory.consolidateThreshold = v; },
  },
  // ── 輸出長度（headroom, not targets）─────────────────────────────────────
  turnTokens: {
    type: 'int', min: 256, max: 32768,
    get: () => config.llm.output.turn,
    set: (v) => { config.llm.output.turn = v; },
  },
  documentTokens: {
    type: 'int', min: 1024, max: 65536,
    get: () => config.llm.output.document,
    set: (v) => { config.llm.output.document = v; },
  },
  summaryTokens: {
    type: 'int', min: 512, max: 32768,
    get: () => config.llm.output.summary,
    set: (v) => { config.llm.output.summary = v; },
  },
  // ── 代理工具 ──────────────────────────────────────────────────────────────
  maxToolCalls: {
    type: 'int', min: 1, max: 10,
    get: () => config.tools.maxCallsPerTurn,
    set: (v) => { config.tools.maxCallsPerTurn = v; },
  },
  researchMaxCalls: {
    type: 'int', min: 2, max: 20,
    get: () => config.tools.researchMaxCalls,
    set: (v) => { config.tools.researchMaxCalls = v; },
  },
  webSearchDepth: {
    type: 'enum', values: ['advanced', 'basic'],
    get: () => config.tools.webSearch.depth,
    set: (v) => { config.tools.webSearch.depth = v; },
  },
};

// What the process booted with (env var or built-in default) — captured before
// any override is applied, so `null` can always restore it.
const BOOT = Object.fromEntries(Object.entries(DEFS).map(([id, d]) => [id, d.get()]));

// Coerce + validate one value for a def; throws badRequest on nonsense.
function sanitize(id, def, value) {
  if (def.type === 'bool') return Boolean(value);
  if (def.type === 'int') {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) throw badRequest(`「${id}」需要數字`);
    return Math.min(def.max, Math.max(def.min, n));
  }
  if (def.type === 'enum') {
    if (!def.values.includes(value)) throw badRequest(`「${id}」僅接受:${def.values.join('、')}`);
    return value;
  }
  throw badRequest(`未知的設定型別:${id}`);
}

const storedOverrides = () => {
  try { return JSON.parse(getSetting(TUNABLES_SETTING_KEY) || '{}') || {}; } catch { return {}; }
};

/** Current values + boot defaults, for the settings API / UI. */
export function getTunables() {
  const values = {};
  const defaults = {};
  for (const [id, d] of Object.entries(DEFS)) {
    values[id] = d.get();
    defaults[id] = BOOT[id];
  }
  return { values, defaults };
}

/**
 * Merge-patch overrides: {id: value} applies (sanitized); {id: null} clears the
 * override and restores the boot value. Unknown ids are rejected. Persists the
 * surviving override set and applies everything immediately.
 */
export function setTunables(patch = {}) {
  const overrides = storedOverrides();
  for (const [id, raw] of Object.entries(patch)) {
    const def = DEFS[id];
    if (!def) throw badRequest(`未知的設定:${id}`);
    if (raw === null) {
      delete overrides[id];
      def.set(BOOT[id]);
    } else {
      const v = sanitize(id, def, raw);
      overrides[id] = v;
      def.set(v);
    }
  }
  setSetting(TUNABLES_SETTING_KEY, JSON.stringify(overrides));
  return getTunables();
}

// Re-apply persisted overrides at boot (import time — before the first
// request). A fresh/empty DB is a no-op; a bad blob must never block startup.
try {
  const stored = storedOverrides();
  for (const [id, v] of Object.entries(stored)) {
    const def = DEFS[id];
    if (!def) continue; // an old override for a knob that no longer exists
    try { def.set(sanitize(id, def, v)); } catch { /* skip invalid stored value */ }
  }
} catch { /* DB unavailable in exotic contexts → boot defaults */ }
