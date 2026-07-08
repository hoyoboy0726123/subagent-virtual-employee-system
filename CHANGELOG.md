# Changelog

Development is organized into phases. The full phase log and forward-looking
plan live in [`ROADMAP.md`](./ROADMAP.md) and [`docs/FUTURE_PLAN.md`](./docs/FUTURE_PLAN.md);
this file summarizes shipped milestones.

## Shipped

- **Milestone D3 — Memory consolidation.** Accumulated per-employee memories are
  periodically merged into one de-duplicated, contradiction-reconciled memory
  (LLM merge, deterministic offline fallback). Non-destructive: originals are
  archived — removed from retrieval but kept as recoverable rows with a
  `supersededBy` pointer. Auto-triggered after meetings past a threshold, plus a
  manual `POST /employees/:id/memory/consolidate`.
- **Milestone D2 — Hybrid semantic retrieval (optional).** BM25/FTS fused with a
  local vector model (transformers.js, multilingual, no API) via Reciprocal Rank
  Fusion, so paraphrases and near-synonyms surface alongside exact-term hits. Off
  by default (`npm run setup:embeddings` + `EMBEDDINGS_ENABLED=1`); falls back to
  pure BM25 when disabled, unavailable, or unindexed. Pure-JS cosine backend runs
  anywhere (sqlite-vec is the noted scale-up path).
- **Milestone C/D1/E — Performance, retrieval quality, and hardening.** List SQL
  pushdown, SSE heartbeat + abort-on-disconnect, batched meeting-chair ordering,
  event-loop-safe large uploads, memoized transcript rendering (C1–C5); CJK bigram
  recall (D1); and six review-bug fixes incl. a CLI process-tree/semaphore-leak
  guard (E).
- **Phase 19 — Manager 1-on-1 dialogues + TC hardening.** Unlimited-turn private
  chats with one employee (tools live); save the record into the knowledge base
  on the manager's call. Deterministic Traditional Chinese enforcement via OpenCC.
- **Phase 18 — Subscription reasoning brains.** `LLM_PROVIDER=claude-cli` /
  `codex-cli` run agent turns on your Claude Pro/Max or ChatGPT Plus/Pro
  subscription via the official CLIs. In-app brain selector with live availability.
- **Phase 17 — OpenClaw removed; Claude.ai-style light theme (default); knowledge viewer.**
- **Phase 16 — Manager-chaired meetings.** Discuss → interject → continue →
  conclude; meetings no longer auto-end at N rounds.
- **Phase 15 — True multi-agent upgrades.** Per-agent config, CJK-aware retrieval,
  cross-meeting memory, dynamic speaking order, parallel goals + SSE streaming.
- **Phase 14 — Web-search toggle + autonomous research** (Tavily advanced depth,
  manager-approved into the knowledge base).
- **Phase 13 — Agentic tool use.** Agents call `search_knowledge` / `web_search` /
  `remember` on their own initiative.
- **Phases 6–12 — Report export (.docx), document ingestion (MarkItDown),
  output-quality & offline-naturalness passes, history/search/dashboard.**
- **Phases 1–5 — Foundation.** MVP → SQLite + layered backend + RAG →
  Traditional Chinese UI + Google Gen AI → built-in standalone multi-agent runtime.

See the git history for commit-level detail.
