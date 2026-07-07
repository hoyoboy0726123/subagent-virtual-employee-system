# Changelog

Development is organized into phases. The full phase log and forward-looking
plan live in [`ROADMAP.md`](./ROADMAP.md) and [`docs/FUTURE_PLAN.md`](./docs/FUTURE_PLAN.md);
this file summarizes shipped milestones.

## Shipped

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
