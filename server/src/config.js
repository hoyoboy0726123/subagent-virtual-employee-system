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

  // Agent-execution runtime. The built-in standalone multi-agent orchestration
  // is the only runtime (the optional OpenClaw integration was removed in
  // Phase 17); legacy stored values normalize back to 'standalone'.
  defaultRuntime: 'standalone',

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

  // Agentic tool use (Phase 13). When the live LLM is active, each employee
  // agent may CALL TOOLS during its turn instead of only answering from the
  // pre-injected grounding: it can re-query its own knowledge base mid-turn
  // (always available) and, when a web-search provider is configured, search
  // the web on its own initiative. Both are enhancements — the offline engine
  // and the zero-config path are unaffected (standalone-first, like the LLM
  // and MarkItDown).
  tools: {
    // Hard ceiling on tool calls per agent turn (loop guard).
    maxCallsPerTurn: Number(process.env.AGENT_MAX_TOOL_CALLS) || 3,
    // Optional web search. Usable only when an API key is present AND the
    // in-app toggle (settings key 'webSearchEnabled') is on; the default
    // endpoint speaks the Tavily search API shape but is overridable.
    webSearch: {
      apiKey: process.env.TAVILY_API_KEY || process.env.WEB_SEARCH_API_KEY || '',
      endpoint: process.env.WEB_SEARCH_ENDPOINT || 'https://api.tavily.com/search',
      maxResults: Number(process.env.WEB_SEARCH_MAX_RESULTS) || 5,
      timeoutSec: Number(process.env.WEB_SEARCH_TIMEOUT_SEC) || 20,
      // Tavily search depth: 'advanced' returns multiple semantically relevant
      // snippets per source (chunks_per_source, advanced-only) for far richer
      // grounding, at 2 credits/query vs basic's 1. Overridable for cost control.
      depth: process.env.WEB_SEARCH_DEPTH || 'advanced',
      chunksPerSource: Number(process.env.WEB_SEARCH_CHUNKS_PER_SOURCE) || 3,
    },
    // The autonomous-research agent (web research → pending report → manager
    // approval → knowledge base) gets a bigger tool budget than a meeting turn.
    researchMaxCalls: Number(process.env.RESEARCH_MAX_TOOL_CALLS) || 6,
  },

  // Optional live LLM via Google Gen AI (@google/genai). Absent by default →
  // deterministic engine. Auth is by API key: prefer GEMINI_API_KEY, fall back
  // to GOOGLE_API_KEY. The model id is fixed to gemma-4-31b-it but overridable.
  llm: {
    provider: 'google',
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemma-4-31b-it',
    // Gemma 4 is a thinking model; its reasoning tokens count against
    // maxOutputTokens and add latency, which short conversational agent turns
    // don't need. 'MINIMAL' is the ONLY level the Gemini API accepts for Gemma 4
    // (NONE/LOW are rejected) and empirically suppresses thought parts entirely.
    // Set LLM_THINKING_LEVEL='' to restore the model's default (full thinking).
    thinkingLevel: process.env.LLM_THINKING_LEVEL ?? 'MINIMAL',
  },

};

export function llmEnabled() {
  return Boolean(config.llm.apiKey);
}
