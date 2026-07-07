# 🧑‍💼 Subagent Virtual Employee System

**Build a team of AI employees, give each one knowledge, and put them to work —
in manager-chaired meetings, collaborative goals, autonomous research, and 1-on-1s.**
Standalone, local-first, and **runnable with zero API keys**.

![CI](https://github.com/hoyoboy0726123/subagent-virtual-employee-system/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

You are the **manager**. You create AI *employees* (each with a persona and a
private, searchable **knowledge base**), pull them into **multi-round meetings**
where they respond to one another and you can interject to steer the direction,
assign **collaborative goals**, ask an employee to **research a topic on the web**
and approve the result into its knowledge, or hold an open-ended **1-on-1**.
Everything is **grounded in retrieval**, and every artifact (transcript, minutes,
report) is exportable to **Word**.

The whole product runs itself — no external orchestrator, gateway, or vector
service. With **no API key** it uses a deterministic, persona-driven reasoning
engine; add a **Google Gemini** key (or point it at your **Claude / ChatGPT
subscription**) and every agent turn runs on a live model. The UI is **Traditional
Chinese (繁體中文)**, with a **Claude.ai-style light theme** (dark available).

---

## 🚀 Quick start

```bash
git clone https://github.com/hoyoboy0726123/subagent-virtual-employee-system.git
cd subagent-virtual-employee-system
npm install

# Dev: API on :3001, hot-reloading client on :5173
npm run dev
#   → open http://localhost:5173

# Or a single production server (builds the client, serves it + the API on :3001)
npm run serve
#   → open http://localhost:3001
```

That's it — it works offline immediately. To turn on the live model and web
search, copy the env template and add your keys:

```bash
cp .env.example .env
# GEMINI_API_KEY=...    (https://aistudio.google.com/apikey)
# TAVILY_API_KEY=...    (https://tavily.com — enables web_search + research)
```

**Optional — document ingestion.** To upload PDF / DOCX / PPTX / XLSX / CSV
(converted to Markdown via Microsoft [MarkItDown](https://github.com/microsoft/markitdown)):

```bash
npm run setup:markitdown   # creates a project-local .venv (needs Python 3.11–3.13)
```

Plain TXT / MD / HTML upload without it.

**Docker:**

```bash
docker build -t veemp .
docker run -p 3001:3001 -v veemp-data:/app/server/data veemp
# add --build-arg WITH_MARKITDOWN=1 to include PDF/DOCX ingestion
```

---

## ✨ What it does

| # | Capability | Where |
|---|------------|-------|
| 1 | **Create an employee** — name, role, personality, expertise, objectives; auto-drafted background you can edit; per-agent model / temperature / tool permissions | 員工 → 新增員工 |
| 2 | **Personal knowledge base** — paste notes or **upload documents**; chunked + full-text indexed; click any doc to view its content and the exact retrieval chunks | 員工 → open a card |
| 3 | **Manager-chaired meetings** — pick employees + a topic; a manager agent picks who speaks next and you can **interject** to steer; it never auto-ends — you **continue** or **conclude** into minutes + report | 會議 |
| 4 | **Collaborative goals** — assign to one or more employees; each carves a non-overlapping slice (run in parallel); a manager agent integrates the output | 目標 |
| 5 | **Autonomous research** — an employee researches a topic on the web, writes an attributed report, and **you approve** it into its knowledge base | 員工 → 🔍 AI 自主研究 |
| 6 | **1-on-1 dialogues** — an unlimited-turn private chat with one employee (tools live); save the record to its knowledge on close | 員工 → 💬 1 on 1 面談 |
| 7 | **Agentic tools** — agents call `search_knowledge` / `web_search` / `remember` on their own initiative, citing sources | everywhere agents run |
| 8 | **Cross-meeting memory** — after each meeting, each participant's stance/commitments are distilled into their knowledge, so they remember past meetings | automatic |
| 9 | **Downloadable reports** — export any meeting/goal as **Word `.docx`** or Markdown | Meetings / Goals |
| 10 | **Pick the brain** — Google Gemini API, or your **Claude / ChatGPT subscription** via the official CLI, switchable in the UI with live availability | topbar 🧠 大腦 |

---

## 🧠 Reasoning brains

Switch in the topbar (🧠 大腦) or via `LLM_PROVIDER`. The selector shows each
brain's live availability (installed? logged in?).

| Provider | How it runs | Notes |
|---|---|---|
| **(none)** | deterministic engine | persona + RAG, fully offline, always available |
| **`google`** | Google Gen AI API (`GEMINI_API_KEY`) | default when a key is set; model `gemma-4-31b-it` |
| **`claude-cli`** | your **Claude Pro/Max** via the official `claude` CLI | `CLAUDE_MODEL=sonnet\|opus\|haiku` |
| **`codex-cli`** | your **ChatGPT Plus/Pro** via the official `codex` CLI | `CODEX_MODEL=gpt-5.5-codex` |

> **Subscription brains are single-user, local-machine only.** Routing your
> subscription credentials for other users violates the providers' terms. The
> app strips metered-billing env vars from the CLI subprocess and isolates the
> turn. See [SECURITY.md](./SECURITY.md).

---

## 🏛️ How it works (in one screen)

- **Backend** — Node + Express, **SQLite** via Node's built-in `node:sqlite`
  (no native build), **FTS5** full-text search with **CJK-aware** tokenization.
- **Orchestration** (`server/src/orchestration/`) — each employee is executed as
  a distinct in-app agent: persona system prompt + its own retrieved knowledge +
  the live conversation. A `MeetingChair` agent routes turns; a `ReportSynthesizer`
  agent writes the final artifact from the real transcript; a `MemoryDistiller`
  writes cross-meeting memory.
- **Reasoning** (`server/src/reasoning/`) — one `generate()` primitive behind a
  pluggable provider layer (google / claude-cli / codex-cli); an agentic loop
  (`generateAgentic`) that lets a turn call tools before speaking; a declarative
  toolbox (`search_knowledge` / `web_search` / `remember`).
- **Retrieval** (`server/src/storage/retrieval.js`) — BM25 over FTS5, scoped per
  employee, CJK character-segmented so Chinese substring queries match.
- **Ingestion** (`server/src/ingest/`) — MarkItDown converts uploads to canonical
  Markdown (with a pure-JS fallback for text formats), then the same chunk + index
  path as pasted notes.
- **Client** (`client/src/`) — React + Vite, Traditional Chinese, light/dark themes.

Offline honesty: when a turn can't run on the live model it degrades to the
deterministic engine per-turn, and the runtime metadata reports exactly how many
turns ran live.

---

## 🔌 API (selected)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | status, live-model flag, ingest capability, counts |
| GET/PUT | `/api/settings` | web-search toggle, brain selector |
| CRUD | `/api/employees…` | employees + knowledge (`/knowledge`, `/knowledge/upload`) |
| POST | `/api/meetings/discuss/stream` · `/:id/continue/stream` · `/interject` · `/:id/conclude/stream` | manager-chaired meeting lifecycle (SSE) |
| POST | `/api/goals/stream` | collaborative goal (SSE, parallel assignees) |
| POST | `/api/employees/:id/research` · `/api/research/:id/approve` | autonomous research + approval |
| POST | `/api/employees/:id/dialogue` · `/api/dialogues/:id/messages` · `/close` | 1-on-1 |
| GET | `/api/meetings/:id/export?format=docx\|md` | download report |

---

## ✅ Validation

```bash
npm test        # 4 hermetic suites (no keys, no network, in-memory DB)
npm run lint    # ESLint
npm run build   # client build
```

Opt-in live/integration tests: `test:live`, `test:live:research`, `test:markitdown`
(require real credentials / Python).

---

## 🗺️ Roadmap & contributing

- Forward-looking plan (KB scaling, performance, hardening): [`docs/FUTURE_PLAN.md`](./docs/FUTURE_PLAN.md)
- Phase history: [`ROADMAP.md`](./ROADMAP.md) · [`CHANGELOG.md`](./CHANGELOG.md)
- How to contribute: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- Security policy & threat model: [`SECURITY.md`](./SECURITY.md)

## 📄 License

[MIT](./LICENSE) © 2026 hoyoboy0726
