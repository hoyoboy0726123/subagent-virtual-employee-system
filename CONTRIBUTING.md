# Contributing

Thanks for your interest! This project is a **standalone, local-first** multi-agent
virtual-employee system. Contributions that keep it runnable with **zero external
services** (no forced cloud dependency) are especially welcome.

## Getting started

```bash
git clone https://github.com/hoyoboy0726123/subagent-virtual-employee-system.git
cd subagent-virtual-employee-system
npm install
npm test          # hermetic — no API keys, no network
npm run dev       # API on :3001, Vite client on :5173
```

Everything runs offline out of the box. To enable the live model / web search,
copy `.env.example` to `.env` and fill in the keys you want.

## Ground rules

- **Standalone-first.** Any new capability (a model provider, a retriever, an
  ingestion path) must degrade gracefully when its dependency is absent — the app
  must still boot and work with no keys. Follow the existing pattern: return
  `null`/an honest "unavailable" and fall back to the deterministic engine.
- **Traditional Chinese UI.** User-facing strings are 繁體中文. Model output is
  normalized through OpenCC (`normalizeTraditional`) before it reaches the user or
  the knowledge base — don't bypass it for LLM-generated text.
- **Tests are hermetic.** `npm test` must never touch the network, real API keys,
  or a real database (`DB_FILE=:memory:`). Live/integration tests
  (`test:live*`, `test:markitdown`) are opt-in and require credentials.

## Before you open a PR

```bash
npm run lint      # ESLint (0 errors required; warnings OK)
npm test          # all four hermetic suites must pass
npm run build     # client must build
```

- Add a hermetic test for new backend behavior (see `server/test/smoke.*.mjs`).
- Keep commits focused; write a clear message describing *what changed and why*.
- New env vars go in `.env.example` with a one-line comment, and in `config.js`.

## Where things live

| Area | Path |
|---|---|
| Reasoning / providers / tools | `server/src/reasoning/` |
| Multi-agent orchestration | `server/src/orchestration/` |
| Storage (SQLite + FTS) | `server/src/storage/`, `server/src/db/` |
| HTTP routes / services | `server/src/routes/`, `server/src/services/` |
| Document ingestion | `server/src/ingest/` |
| React client | `client/src/` |
| Roadmap / future work | `docs/FUTURE_PLAN.md` |

## Reporting bugs / security issues

Regular bugs → GitHub Issues. Security concerns → see [SECURITY.md](./SECURITY.md).
