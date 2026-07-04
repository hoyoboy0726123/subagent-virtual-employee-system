// Central configuration. Everything is env-overridable so the app stays
// friction-free locally (sensible defaults) while remaining deployable.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 3001,

  // SQLite database file. Overridable with DB_FILE (the smoke test points this
  // at a throwaway path so it never touches real data). ':memory:' is allowed.
  dbFile:
    process.env.DB_FILE
      ? (process.env.DB_FILE === ':memory:'
          ? ':memory:'
          : path.resolve(process.env.DB_FILE))
      : path.join(__dirname, '..', 'data', 'app.db'),

  // Default agent-execution runtime. 'standalone' is the built-in multi-agent
  // orchestration and requires no external services; 'openclaw' is the optional
  // external-subagent adapter. This is only the default — it can be changed at
  // runtime via the settings API and is persisted in the DB. (The legacy value
  // 'simulated' is transparently normalized to 'standalone'.)
  defaultRuntime: process.env.RUNTIME_MODE || 'standalone',

  // Retrieval defaults.
  retrieval: {
    chunkSize: Number(process.env.CHUNK_SIZE) || 480, // ~chars per chunk
    chunkOverlap: Number(process.env.CHUNK_OVERLAP) || 60,
    topK: Number(process.env.RETRIEVAL_TOP_K) || 4,
  },

  // Document ingestion (Phase 7). Uploaded knowledge files are converted to
  // canonical Markdown by Microsoft MarkItDown (https://github.com/microsoft/
  // markitdown) when a Python interpreter with the package is reachable, and
  // otherwise fall back to a pure-JS extractor for text-like types — MarkItDown
  // is an enhancement, exactly like the live LLM, so the app stays
  // standalone-first. Everything here is env-overridable.
  ingest: {
    // Python interpreter used to run server/src/ingest/markitdown_helper.py.
    // Prefer MARKITDOWN_PYTHON; otherwise the wrapper auto-probes a project-local
    // `.venv` and then a bare `python3` (see ingest/markitdown.js).
    python: process.env.MARKITDOWN_PYTHON || '',
    // Per-file upload ceiling (bytes). Guards the ingestion surface.
    maxBytes: Number(process.env.UPLOAD_MAX_BYTES) || 15 * 1024 * 1024, // 15 MiB
    // Per-conversion timeout (seconds) for the MarkItDown subprocess.
    timeoutSec: Number(process.env.MARKITDOWN_TIMEOUT_SEC) || 120,
    // Hard kill-switch: MARKITDOWN_DISABLE=1 forces the built-in JS fallback even
    // when MarkItDown is installed. Lets the hermetic smoke test exercise the
    // fallback path regardless of the local machine's Python setup.
    disabled: /^(1|true|yes|on)$/i.test(process.env.MARKITDOWN_DISABLE || ''),
  },

  // Optional live LLM via Google Gen AI (@google/genai). Absent by default →
  // deterministic engine. Auth is by API key: prefer GEMINI_API_KEY, fall back
  // to GOOGLE_API_KEY. The model id is fixed to gemma-4-31b-it but overridable.
  llm: {
    provider: 'google',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemma-4-31b-it',
  },

  // Real OpenClaw runtime wiring. Employees are executed as real OpenClaw
  // subagents/sessions driven through the `openclaw` CLI, which talks to the
  // local OpenClaw Gateway. Nothing here needs to be set for it to work as long
  // as the `openclaw` binary is on PATH and a Gateway is running — the defaults
  // are sensible. Every value is env-overridable for deployment/testing.
  openclaw: {
    // CLI binary used to drive subagent turns (`openclaw agent ... --json`).
    cli: process.env.OPENCLAW_CLI || 'openclaw',
    // Optional explicit agent id to route turns to (`--agent`). Empty → the
    // Gateway's default agent/routing. Employees are still isolated per-session.
    agentId: process.env.OPENCLAW_AGENT || '',
    // Agent id used for the manager synthesis pass. Falls back to `agentId`.
    managerAgentId: process.env.OPENCLAW_MANAGER_AGENT || process.env.OPENCLAW_AGENT || '',
    // Per-turn timeout (seconds) passed to the CLI and enforced locally.
    timeoutSec: Number(process.env.OPENCLAW_TIMEOUT_SEC) || 300,
    // Thinking level for subagent turns: off|minimal|low|medium|high.
    thinking: process.env.OPENCLAW_THINKING || 'low',
    // Namespacing prefix for the session ids we create (keeps them scannable in
    // the Gateway session store, e.g. veemp-emp-…, veemp-mgr-…).
    sessionPrefix: process.env.OPENCLAW_SESSION_PREFIX || 'veemp',
    // Hard kill-switch: set OPENCLAW_DISABLE=1 to force the OpenClaw adapter into
    // simulated-fallback even when the CLI is present (used by the hermetic
    // smoke test so it never spends real subagent turns).
    disabled: /^(1|true|yes|on)$/i.test(process.env.OPENCLAW_DISABLE || ''),
    // Legacy HTTP wiring, retained for reference/compatibility. Not required by
    // the CLI path and no longer what gates "configured".
    endpoint: process.env.OPENCLAW_ENDPOINT || '',
    apiKey: process.env.OPENCLAW_API_KEY || '',
  },
};

export function llmEnabled() {
  return Boolean(config.llm.apiKey);
}
