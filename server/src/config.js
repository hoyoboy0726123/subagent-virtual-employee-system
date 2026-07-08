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
    // Hard ceiling on chunks per document (C4). A 15 MiB upload could otherwise
    // produce ~36k chunks = ~72k synchronous INSERTs, freezing the event loop
    // (and every in-flight SSE meeting) for seconds. 2000 chunks ≈ ~1 MB of
    // indexed text — ample for a knowledge doc; excess is dropped and noted.
    maxChunksPerDoc: Number(process.env.MAX_CHUNKS_PER_DOC) || 2000,

    // Hybrid semantic retrieval (D2). OFF by default → the app stays pure
    // BM25/FTS with zero extra dependencies (standalone-first). Turn on with
    // EMBEDDINGS_ENABLED=1 AND install the optional embedding model
    // (`npm run setup:embeddings`). When on, retrieval fuses BM25 (exact terms)
    // with local vector cosine (paraphrase/near-synonym) via Reciprocal Rank
    // Fusion; if the model or its dependency can't load, or nothing is embedded
    // yet, it silently falls back to pure BM25 — the same results as today.
    embedding: {
      enabled: /^(1|true|yes|on)$/i.test(process.env.EMBEDDINGS_ENABLED || ''),
      // A small MULTILINGUAL model so Traditional Chinese embeds well; runs
      // locally via transformers.js (@huggingface/transformers, optional dep).
      model: process.env.EMBEDDINGS_MODEL || 'Xenova/multilingual-e5-small',
      // e5 models are trained with these instruction prefixes; set empty via env
      // for models that don't want them.
      queryPrefix: process.env.EMBEDDINGS_QUERY_PREFIX ?? 'query: ',
      passagePrefix: process.env.EMBEDDINGS_PASSAGE_PREFIX ?? 'passage: ',
      // RRF constant. Larger = flatter fusion (a big rank gap matters less).
      rrfK: Number(process.env.EMBEDDINGS_RRF_K) || 60,
      // Candidates each retriever (BM25 / vector) contributes to the fusion pool.
      candidates: Number(process.env.EMBEDDINGS_CANDIDATES) || 40,
      // Texts embedded per model call during (back)indexing.
      batchSize: Number(process.env.EMBEDDINGS_BATCH_SIZE) || 32,
    },
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

  // Live LLM reasoning brain (Phase 18: pluggable providers).
  //   google      — Google Gen AI API (@google/genai), keyed by GEMINI_API_KEY.
  //   claude-cli  — your Claude Pro/Max SUBSCRIPTION via the official `claude`
  //                 CLI in headless mode (`claude -p`); usage draws from the
  //                 subscription's limits. Single-user, local machine only —
  //                 routing your subscription for other users violates
  //                 Anthropic's terms.
  //   codex-cli   — your ChatGPT Plus/Pro subscription via the official
  //                 `codex` CLI (`codex exec`); same single-user caveat.
  // CLI providers have no native function calling — agents automatically use
  // the built-in prompt tool protocol, so tool autonomy still works.
  llm: {
    provider: (process.env.LLM_PROVIDER || 'google').toLowerCase(),
    // Output-token ceilings per surface. These are HEADROOM, not targets — the
    // model stops when it is done, and tokens only cost when actually
    // generated — so they are set generously and are env-overridable:
    //   turn     — meeting speeches / goal task turns (conversational)
    //   document — real deliverables: meeting reports, goal plans, research
    //              reports, 1on1 replies (which legitimately include documents)
    //   summary  — distillations: memory, 1on1 records, consolidation
    output: {
      turn: Number(process.env.LLM_TURN_MAX_TOKENS) || 2048,
      document: Number(process.env.LLM_DOC_MAX_TOKENS) || 8192,
      summary: Number(process.env.LLM_SUMMARY_MAX_TOKENS) || 4096,
    },
    // --- google ---
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemma-4-31b-it',
    // Gemma 4 is a thinking model; its reasoning tokens count against
    // maxOutputTokens and add latency, which short conversational agent turns
    // don't need. 'MINIMAL' is the ONLY level the Gemini API accepts for Gemma 4
    // (NONE/LOW are rejected) and empirically suppresses thought parts entirely.
    // Set LLM_THINKING_LEVEL='' to restore the model's default (full thinking).
    thinkingLevel: process.env.LLM_THINKING_LEVEL ?? 'MINIMAL',
    // --- claude-cli (subscription) ---
    claudeCli: {
      cli: process.env.CLAUDE_CLI || 'claude',
      model: process.env.CLAUDE_MODEL || 'sonnet', // sonnet | opus | haiku | full id
      timeoutSec: Number(process.env.CLAUDE_CLI_TIMEOUT_SEC) || 300,
      maxConcurrent: Number(process.env.CLAUDE_CLI_MAX_CONCURRENT) || 2,
      // Long-lived headless token from `claude setup-token` (optional — the
      // interactive `claude` login credentials work too).
      oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
    },
    // --- codex-cli (subscription) ---
    codexCli: {
      cli: process.env.CODEX_CLI || 'codex',
      // '' = let the CLI use the ACCOUNT's default model. Pinning an id here is
      // fragile: ChatGPT-subscription auth rejects ids it doesn't offer (e.g.
      // 'gpt-5.5-codex' → 400 invalid_request_error, observed live), and
      // OpenAI renames the lineup often. Set CODEX_MODEL only to override.
      model: process.env.CODEX_MODEL || '',
      timeoutSec: Number(process.env.CODEX_CLI_TIMEOUT_SEC) || 300,
      maxConcurrent: Number(process.env.CODEX_CLI_MAX_CONCURRENT) || 2,
    },
  },

  // Organizational memory (Phase 15 distillation + D3 consolidation). An employee
  // accumulates a `source:'memory'` document after every meeting (plus anything it
  // chooses to `remember`), so those pile up, overlap, and eventually contradict.
  // Consolidation periodically MERGES them into one compact, de-duplicated,
  // contradiction-reconciled memory — archiving (not deleting) the originals.
  memory: {
    // Consolidate once an employee has at least this many ACTIVE memory docs.
    consolidateThreshold: Number(process.env.MEMORY_CONSOLIDATE_THRESHOLD) || 12,
    // Kill switch for the whole consolidation feature (auto + manual).
    consolidateDisabled: /^(1|true|yes|on)$/i.test(process.env.MEMORY_CONSOLIDATE_DISABLE || ''),
  },

};
