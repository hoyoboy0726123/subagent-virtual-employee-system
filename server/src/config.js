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

  // Default agent-execution runtime. 'simulated' works fully offline; 'openclaw'
  // is the (currently stubbed) real-subagent runtime. This is only the default —
  // it can be changed at runtime via the settings API and is persisted in the DB.
  defaultRuntime: process.env.RUNTIME_MODE || 'simulated',

  // Retrieval defaults.
  retrieval: {
    chunkSize: Number(process.env.CHUNK_SIZE) || 480, // ~chars per chunk
    chunkOverlap: Number(process.env.CHUNK_OVERLAP) || 60,
    topK: Number(process.env.RETRIEVAL_TOP_K) || 4,
  },

  // Optional live LLM via Google Gen AI (@google/genai). Absent by default →
  // deterministic engine. Auth is by API key: prefer GEMINI_API_KEY, fall back
  // to GOOGLE_API_KEY. The model id is fixed to gemma-4-31b-it but overridable.
  llm: {
    provider: 'google',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemma-4-31b-it',
  },

  // Optional OpenClaw runtime wiring. When unset the OpenClaw adapter runs in
  // simulated-fallback mode so flows never break offline.
  openclaw: {
    endpoint: process.env.OPENCLAW_ENDPOINT || '',
    apiKey: process.env.OPENCLAW_API_KEY || '',
  },
};

export function llmEnabled() {
  return Boolean(config.llm.apiKey);
}

export function openclawConfigured() {
  return Boolean(config.openclaw.endpoint);
}
