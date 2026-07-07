# 🧑‍💼 Subagent Virtual Employee System

A **standalone virtual employee system with built-in multi-agent orchestration
and optional external integrations.** You are the *manager*. You create and
manage a team of AI *employees*, give each one a persona and a personal,
searchable **knowledge base**, pull them into meetings, and assign them
collaborative goals — then read the transcripts, minutes, reports, and
collaboration outputs they produce, each **grounded in retrieved knowledge**.

The system **orchestrates everything itself**. Each employee is executed as a
distinct in-app agent — its own persona + its own retrieved knowledge + the live
conversation — driven through its own backend and **Google Gen AI** (model
`gemma-4-31b-it`). Meetings are real multi-round, multi-agent conversations where
employees respond to one another; goals are real multi-agent collaborative
executions with a coordinating manager agent synthesizing the final output.
**No external runtime, gateway, or orchestrator is required.**

The entire product UI is in **Traditional Chinese (繁體中文)** — buttons, tabs,
labels, dialogs, empty states, runtime labels, and the generated meeting reports
/ collaboration outputs.

It also runs **fully offline with zero API keys**: if no Google key is set, each
agent turn degrades to a deterministic, persona-driven reasoning engine grounded
with the same RAG retrieval layer — the multi-agent orchestration stays real
either way, and the runtime metadata says honestly how much ran on the live model.

> **Phase 5 (standalone-first).** The product no longer depends on OpenClaw to
> work. The default runtime is a **built-in multi-agent orchestration**
> (`StandaloneRuntimeAdapter`): the backend itself drives each employee as an
> in-app agent through Google Gen AI, runs meetings/goals as genuine multi-turn
> conversations (employees see and respond to one another across rounds), and a
> coordinating manager agent synthesizes the final report/output from the *real*
> transcript. OpenClaw is now an **optional external adapter**, not a dependency.
> See [The standalone runtime](#-the-standalone-runtime-built-in-multi-agent) and
> [Optional: OpenClaw](#-optional-the-openclaw-integration).
>
> Earlier phases: **Phase 2** rebuilt the backend on **SQLite** with a clean
> layered architecture and a chunked + full-text RAG knowledge base; **Phase 3**
> made the UI Traditional Chinese and added the Google Gen AI path; **Phase 4**
> turned the (then-optional) OpenClaw path into a real subagent runtime.
>
> **Phase 6 (shipped).** Meeting reports and goal collaboration outputs are now
> **downloadable** as polished **Word `.docx`** documents (or portable Markdown)
> with structured sections.
>
> **Phase 7 (shipped).** An employee's knowledge base can now grow by **uploading
> documents** — PDF / DOCX / TXT / Markdown / HTML — not just pasting text. Each
> upload is converted to canonical **Markdown** by **[Microsoft MarkItDown](https://github.com/microsoft/markitdown)**,
> then chunked (section-aware) and indexed through the *same* retrieval path as a
> pasted note, so uploaded knowledge grounds meetings/goals/RAG identically.
> MarkItDown is an **optional enhancement** (like the live LLM): without it,
> text-like formats still ingest via a pure-JS fallback, keeping the app
> standalone-first. See [Document ingestion](#-document-ingestion-markitdown).
>
> **Phase 8 (shipped).** Output & orchestration **quality** upgrade — agents now
> read like real colleagues, not a template. Each employee is conditioned on its
> **full persona** (role, personality, comms style, expertise, objectives,
> profile) to speak with a recognisable voice; turns are **agent-aware** (they
> answer the previous speaker by name, stay consistent with their own earlier
> stance, and don't re-litigate what's settled) via a per-round *stance*
> (open → challenge → commit); and the manager pass now writes a chief-of-staff
> report (**執行摘要 / 討論脈絡 / 決議 / 行動項目 / 風險與待解問題**) that de-dups the
> transcript and cites knowledge only where it was earned. The **offline engine**
> was de-boilerplated too, so the zero-key experience is distinct and concrete.
> See [The standalone runtime](#-the-standalone-runtime-built-in-multi-agent).
>
> **Phase 13 (shipped).** **Agentic tool use** — live agent turns are no longer
> single-shot prompt calls: each employee agent can now *decide on its own* to
> call tools before speaking. `search_knowledge` (always available) lets it
> re-query its own knowledge base mid-turn with a query it formulates itself;
> `web_search` (optional, provider-gated) lets it reach the web when a key is
> configured — and is simply not offered otherwise, preserving standalone-first.
> The loop is bounded (`AGENT_MAX_TOOL_CALLS`, default 3), refuses repeated
> identical calls, records `toolCalls` on every transcript turn, and merges
> looked-up chunks into the turn's citations so grounding stays honest.
>
> **Phase 14 (shipped).** **網路搜尋開關 + AI 自主研究** — a topbar toggle
> (requires `TAVILY_API_KEY`) arms every agent with `web_search` (Tavily
> **advanced** depth); anything drawn from the web must be attributed, and
> consulted sources land in the turn's citations. In the employee detail modal,
> 「AI 自主研究」 lets an employee agent research a topic on its own (multiple
> self-directed queries), write an attributed 調查報告, and submit it for YOUR
> review — approval ingests it into that employee's knowledge base; rejection
> archives it. Live-proven end-to-end (`npm run test:live:research`).
>
> **Phase 18 (shipped).** **訂閱制推理大腦** — set `LLM_PROVIDER=claude-cli`
> (Claude Pro/Max via the official `claude` CLI) or `codex-cli` (ChatGPT
> Plus/Pro via `codex`) and every agent turn runs on your existing
> subscription instead of a metered API key. Agentic tools still work (prompt
> protocol); metered-billing env vars are stripped and any non-zero
> `total_cost_usd` triggers a loud warning. **僅限你本人、單機使用** — routing
> your subscription credentials for other users violates the providers' terms.
> Model overrides: `CLAUDE_MODEL`（sonnet/opus/haiku）、`CODEX_MODEL`.
>
> The full productization plan — through the planned Phase 19 (final packaging)
> — lives in **[ROADMAP.md](./ROADMAP.md)**.

---

## ✨ What it does

| # | Capability | Where |
|---|------------|-------|
| 1 | **Create an employee role** — name, role, personality, expertise, objectives, comms style, plus an auto-generated background you can edit | Employees → *New employee* |
| 2 | **Personal knowledge base** — paste notes *or* **upload documents** (PDF / DOCX / TXT / MD / HTML) per employee; uploads are converted to Markdown by **MarkItDown**, then chunked + full-text indexed and retrieved when the employee reasons | Employees → open a card → *knowledge base* → *⬆ 上傳文件* |
| 3 | **Multi-agent meetings** — pick employees, set a topic + rounds; each participant runs as its own agent grounded in *its* retrieved knowledge and responds to the others across rounds → **transcript + minutes + report + knowledge used** | Meetings |
| 4 | **Collaborative goals** — assign a goal to one or more employees; each produces its own subtask/approach as an agent, then a manager agent integrates them into a **collaboration output** | Goals |
| 5 | **New-role ideation** — describe the employee you want; the system drafts a full profile you can edit before saving | Employees → *Ideate a role* |
| 6 | **Retrieval search** — keyword/FTS search across the knowledge base, scoped to one or many employees | `GET /api/knowledge/search` |
| 7 | **Runtime switch** — **Standalone** (built-in multi-agent orchestration, default, no external deps) or **OpenClaw** (optional external subagent execution via the `openclaw` CLI → Gateway) | Header → *Runtime* |
| 8 | **SQLite persistence** — everything survives restarts in a single `.db` file | `server/data/app.db` |
| 9 | **Downloadable reports** — export any meeting report or goal collaboration output as a polished **Word `.docx`** (or portable Markdown) with structured sections: title, participants/assignees, minutes/task breakdown, report body, transcript, runtime metadata, and knowledge references | Meetings / Goals → *⬇ 下載 Word* |
| 10 | **History & management polish** — meetings/goals now support **search, filters, sorting, pagination**, and the header shows a lightweight **dashboard** for employee / knowledge / run health | Meetings / Goals lists · header dashboard |

---

## 🚀 Quick start

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite`; tested on Node
22.22). No native builds, no database server — just `npm install`.

```bash
npm install          # install deps (no compilation step)
npm run seed         # create + seed the SQLite DB with sample data (optional)
npm run dev          # start API (:3001) + web (:5173) with hot reload
```

Then open **http://localhost:5173**.

It works immediately with **no configuration**. To have the employee agents run
on the live model instead of the offline engine, set a Google API key (see
[Live model](#-the-live-model-google-gen-ai-googlegenai)). To parse **uploaded
PDF/DOCX** knowledge files, install MarkItDown once (optional — text formats work
without it; see [Document ingestion](#-document-ingestion-markitdown)):

```bash
python3 -m venv .venv && ./.venv/bin/pip install 'markitdown[all]'
# the backend auto-detects a project-local .venv — no other config needed
```

### Production-style run (single server)

```bash
npm run serve        # builds the client, then serves API + UI on :3001
# open http://localhost:3001
```

### Other scripts

```bash
npm test             # hermetic end-to-end smoke test (boots the app, exercises every flow)
npm run test:openclaw # opt-in test for the OPTIONAL OpenClaw integration (needs a live Gateway; slow)
npm run test:markitdown # opt-in test for the REAL MarkItDown ingestion path (needs Python + markitdown)
npm run migrate      # apply pending DB migrations + print schema version
npm run seed         # RESET the DB and load sample data
npm run build        # build the client into client/dist
npm start            # serve an already-built client + API on :3001
```

---

## 🏛️ Architecture

Routes are **thin** — they only adapt HTTP; all logic lives in **services**,
which delegate execution to the **active runtime adapter**. The default runtime
is the built-in **orchestration** layer; it reads/writes through the
**storage/retrieval** layer and reasons through **Google Gen AI** with a
deterministic **engine** fallback.

```
HTTP ─▶ routes/ ─▶ services/ ─▶ runtime/ (adapters) ─▶ orchestration/ ─▶ reasoning/ (LLM, engine)
                       │              standalone (default)      │                 │
                       │              openclaw   (optional)     │                 │
                       └──────────────▶ storage/ (repos, retrieval) ◀─────────────┘
                                               │
                                            db/ (SQLite, migrations, seed)
```

```
subagent-virtual-employee-system/
├── server/
│   ├── src/
│   │   ├── index.js                entry point (builds app, listens)
│   │   ├── app.js                  Express assembly: mounts routers, static, error handler
│   │   ├── config.js               env-driven config (port, db, runtime, retrieval, llm)
│   │   │
│   │   ├── routes/                 ── API layer (thin) ──
│   │   │   ├── health.routes.js    · employees.routes.js · knowledge.routes.js
│   │   │   ├── meetings.routes.js  · goals.routes.js      · settings.routes.js
│   │   │
│   │   ├── services/               ── business logic ──
│   │   │   ├── employees.service.js · knowledge.service.js · meetings.service.js
│   │   │   ├── goals.service.js      · settings.service.js
│   │   │
│   │   ├── runtime/                ── runtime adapters (the seam) ──
│   │   │   ├── AgentRuntimeAdapter.js       base interface
│   │   │   ├── StandaloneRuntimeAdapter.js ★ DEFAULT: built-in multi-agent orchestration
│   │   │   ├── OpenClawRuntimeAdapter.js    OPTIONAL: external OpenClaw subagents
│   │   │   ├── openclaw/
│   │   │   │   ├── cli.js                   execFile client for `openclaw agent --json`
│   │   │   │   └── orchestrator.js          multi-subagent meeting/goal orchestration
│   │   │   └── index.js                     adapter registry + factory (+ legacy alias)
│   │   │
│   │   ├── orchestration/          ── the standalone multi-agent runtime ──
│   │   │   ├── MeetingOrchestrator.js  ★    multi-round, multi-agent meeting loop
│   │   │   ├── GoalCoordinator.js      ★    multi-agent collaborative goal execution
│   │   │   ├── EmployeeAgentExecutor.js ★   runs ONE employee as an agent (persona+RAG → LLM)
│   │   │   ├── ReportSynthesizer.js    ★    the coordinating manager agent
│   │   │   ├── ConversationState.js         AgentTurn log + prompt context (cross-threading)
│   │   │   └── deterministic.js             fully-offline meeting/goal (shared fallback)
│   │   │
│   │   ├── ingest/                ── document ingestion (Phase 7) ──
│   │   │   ├── extract.js  ★         file → canonical Markdown (+ raw text, metadata)
│   │   │   ├── markitdown.js         Node ↔ MarkItDown bridge (probe + convert via execFile)
│   │   │   └── markitdown_helper.py  tiny Python helper (JSON in/out) driving MarkItDown
│   │   │
│   │   ├── reasoning/              ── reasoning backends ──
│   │   │   ├── llm.js  ★            Google Gen AI path (@google/genai)
│   │   │   ├── engine.js            pure, offline, persona + RAG generators (fallback)
│   │   │   └── chunk.js             sentence-aware + section-aware (Markdown) chunker
│   │   │
│   │   ├── storage/                ── storage / retrieval layer ──
│   │   │   ├── employees.repo.js   · knowledge.repo.js (documents + chunks + FTS)
│   │   │   ├── meetings.repo.js    · goals.repo.js      · settings.repo.js
│   │   │   └── retrieval.js  ★     FTS5 + BM25 keyword search, employee-scoped
│   │   │
│   │   ├── db/                     ── SQLite ──
│   │   │   ├── connection.js       DatabaseSync singleton (node:sqlite)
│   │   │   ├── migrations.js       versioned schema (PRAGMA user_version)
│   │   │   ├── migrate.js          CLI runner  · tx.js  BEGIN/COMMIT helper
│   │   │   └── seed.js             sample data (resets the DB)
│   │   │
│   │   └── util/                   ids.js · http.js (asyncHandler, HttpError)
│   │   └── data/app.db             SQLite database (git-ignored)
│   └── test/
│       ├── smoke.mjs               hermetic end-to-end HTTP smoke test (in-memory DB)
│       └── smoke.openclaw.mjs      opt-in test for the optional OpenClaw integration
└── client/                         Vite + React SPA
    └── src/ App.jsx · api.js · components/ui.jsx · pages/
```

**Stack:** Vite + React (client) · Express (API) · **SQLite via `node:sqlite`**
(built into Node — no native module, nothing to compile) with **FTS5** for
full-text retrieval · **Google Gen AI** (`@google/genai`) for the agent turns ·
**multer** for knowledge-file uploads · **Microsoft MarkItDown** (optional Python
helper) as the document → Markdown ingestion pipeline.

### Storage & migrations

Persistence is SQLite. The connection (`db/connection.js`) is a lazily-created
singleton that opens the file, enables WAL + foreign keys, and runs any pending
**migrations** on boot. Migrations are an ordered list keyed off
`PRAGMA user_version`, applied transactionally. `npm run migrate` applies them
explicitly; `npm run seed` resets and reseeds.

Data model: `employees`, `documents`, `chunks`, `chunks_fts` (FTS5), `meetings`,
`goals`, `settings`.

### Knowledge base & retrieval (simple RAG)

Each employee owns **documents** (pasted notes or uploaded files — see
[Document ingestion](#-document-ingestion-markitdown)). On write, a document is
split into overlapping **chunks** (`reasoning/chunk.js`) — sentence-aware for
prose, **section-aware** for Markdown from uploads — and mirrored into an **FTS5**
index. `storage/retrieval.js` ranks chunks with **BM25** and can **scope results
to one or many employees** — the core primitive that grounds each agent in the
*right* person's knowledge:

```
GET /api/knowledge/search?q=release%20readiness
GET /api/knowledge/search?q=retention&employeeIds=emp_a,emp_b   # scoped
```

The `search()` signature is the seam where a future **vector/embedding**
retriever would slot in — routes and the runtime depend only on the returned
shape, not on how ranking is done.

### Runtime adapters

The service layer never orchestrates directly. It asks the **active runtime
adapter** to `runMeeting` / `executeGoal`. All adapters share one small, stable
interface (`runtime/AgentRuntimeAdapter.js`) so they're interchangeable:

| Adapter | Mode | Behavior |
|---------|------|----------|
| `StandaloneRuntimeAdapter` | `standalone` **(default)** | **Built-in multi-agent orchestration — no external deps.** Runs each employee as an in-app agent (persona + employee-scoped RAG + live conversation) via Google Gen AI, threading turns so they respond to one another, then a manager agent synthesizes the artifact. Degrades **per turn** to the deterministic engine when no API key is set — honestly flagged. |
| `OpenClawRuntimeAdapter` | `openclaw` *(optional)* | **External integration.** Runs each employee as a real OpenClaw subagent session via the `openclaw` CLI → Gateway. Falls back to the built-in deterministic engine **only** if the CLI/Gateway is unreachable — and flags it (`fallback: true`, `engine: 'deterministic'`). |

Switch modes live from the header, or via the API (the legacy value `simulated`
is transparently normalized to `standalone` for existing databases):

```bash
curl -X PUT localhost:3001/api/settings -d '{"runtimeMode":"standalone"}' \
     -H 'content-type: application/json'
```

The chosen mode is persisted in the `settings` table, and each stored
meeting/goal records which runtime produced it, honestly labeled:

```jsonc
"runtime": {
  "mode": "standalone",
  "engine": "standalone-genai",   // "deterministic" when it ran offline
  "live": true,                    // false when every turn used the offline engine
  "fallback": false,               // true only if NOT ONE turn ran on the live model
  "liveTurns": 7, "totalTurns": 7, // how many agent turns ran on the live model
  "model": "gemma-4-31b-it", "provider": "google",
  "note": "由內建多代理協作執行（7/7 回合為即時模型，模型：gemma-4-31b-it）。"
}
```

---

## 🤖 The standalone runtime (built-in multi-agent)

This is the **default** and the product's primary execution path. Everything
happens in-process — there is no gateway, no external orchestrator, no live
runtime dependency. The mechanics live in `server/src/orchestration/`:

- **`EmployeeAgentExecutor`** — runs **one** employee as a distinct agent. It
  builds a persona system instruction from the employee's **full profile** (role,
  expertise, personality, comms style, objectives, *and* the generated background
  side-profile) **plus the knowledge retrieved for *that* employee** (RAG), adds
  the turn's context, and calls Google Gen AI. The persona prompt now conditions
  **voice and behaviour** — speak in-character, hold a position, disagree with
  reasons, build on a *named* colleague — and bans a list of templated openers, so
  two agents on the same topic diverge in *how they sound*, not just what they
  know. Its creative temperature is nudged per-employee (deterministically) to
  reinforce that. If the model is unconfigured or a turn fails (after one retry),
  it degrades **per turn** to the deterministic engine and marks that turn
  `live: false`.
- **`ConversationState` / `AgentTurn`** — the running conversation, kept in-app.
  Since model calls are stateless, the orchestrator re-injects an **agent-aware**
  slice (`contextFor`) into each next agent's prompt: who the agent is answering
  (the previous *other* speaker, by name), what the agent itself already argued (so
  it stays consistent), and what others said (without echoing itself). This is what
  lets later turns reflect earlier ones **coherently**, not with formulaic callbacks.
- **`MeetingOrchestrator`** — for a meeting it runs `rounds` × `participants`
  genuine agent turns. It plans a coherent **arc** (always opens on positions and
  ends on a decision/close round) and gives each round a behavioural **stance** —
  *open* (stake a view) → *challenge* (agree/disagree with reasons) → *commit*
  (owned, concrete decisions) — so decisions feel earned rather than generic.
- **`GoalCoordinator`** — for a goal each assignee runs as an agent that sees the
  **other assignees' roles and expertise** (not just their names), so it claims a
  non-overlapping slice and names real hand-offs, then produces its subtask +
  execution approach (deliverables, dependencies, acceptance criteria, risk).
- **`ReportSynthesizer`** — a separate **coordinating manager agent** (briefed as a
  *chief of staff*) reads the *real* transcript and synthesizes the final **report**
  (執行摘要 / 討論脈絡 / 決議 / 行動項目 / 風險與待解問題) or **collaboration output**
  (目標與成功標準 / 分工 / 相依與交接 / 整合計畫 / 里程碑), de-duping the transcript and
  citing knowledge only where it was earned. Minutes are derived deterministically
  from the same real transcript. If the model is unavailable, it assembles the
  artifact from that real transcript deterministically — never fabricated.

**Honesty.** A run is labeled `live`/`engine: "standalone-genai"` only for the
turns that actually ran on the model; `fallback: true` appears **only** when not a
single turn ran live (a fully offline run), and the note says so. The
orchestration itself is always real multi-turn, multi-agent — only the per-turn
reasoning backend (live model vs. offline engine) changes.

### The deterministic offline engine (`reasoning/engine.js`)

The guaranteed baseline: pure, persona-driven generators grounded with RAG, zero
model calls. It powers `generateProfile` / `ideateRole`, provides the **per-turn
fallback** inside `EmployeeAgentExecutor`, and the whole-run fallback for the
OpenClaw adapter (via `orchestration/deterministic.js`). It keeps the app instant,
free, and fully functional with no keys and no network. Phase 8 **de-boilerplated**
it: turns vary phrasing by a *deterministic* per-employee seed (reproducible, never
random) and weave in each persona's expertise + comms-style lens, callbacks name a
prior speaker, and closings commit to a concrete, workline-specific acceptance bar —
so even the zero-key experience reads distinct and substantive rather than filled-in.

### The live model: Google Gen AI (`@google/genai`)

The agent turns and the manager synthesis run on Google's **`gemma-4-31b-it`**
model through the official
**[`@google/genai`](https://www.npmjs.com/package/@google/genai)** SDK.
Authentication is by API key — create one in
**[Google AI Studio](https://aistudio.google.com/apikey)** and set it:

```bash
export GEMINI_API_KEY=AIza...              # preferred; enables the live model
# export GOOGLE_API_KEY=AIza...            # also accepted as a fallback var
# export GEMINI_MODEL=gemma-4-31b-it       # optional override (this is the default)
npm run dev
```

The header pill flips to **「內建多代理：即時（gemma-4-31b-it）」**, and each
meeting/goal shows a **「🤖 內建多代理即時 N/N 回合 · <model>」** badge. Every
prompt is written in Traditional Chinese. If the key is missing or any Google
call fails, the app silently falls back to the offline engine and never breaks.

**How it's wired** (`server/src/reasoning/llm.js`):

- A single `GoogleGenAI` client is created lazily from `config.llm.apiKey`.
- All generation goes through `ai.models.generateContent(...)`, wrapped by one
  `generate()` primitive that returns a normalized `{ text, functionCalls }`
  shape (or `null` on any failure → deterministic fallback).
- **Function calling is a first-class extension point**: pass `tools` built with
  the exported `toolset(...)` helper and `Type` (re-exported from the SDK), then
  read `.functionCalls` off the result — no call site needs to change to adopt
  tool-calling later.
- Because Gemma models on the Gemini API don't take a separate system role, the
  system instruction is folded into the prompt for Gemma (and passed as a real
  `systemInstruction` for non-Gemma models).

---

## 🦞 Optional: the OpenClaw integration

OpenClaw is **not required** and **not the default** — it is an opt-in adapter for
teams that already run an OpenClaw Gateway and want each employee executed as a
real, isolated OpenClaw **subagent session** instead of an in-app agent. Select
the `openclaw` runtime and, when a Gateway is reachable, execution is real:

- **One subagent per employee** — each mapped to a persistent OpenClaw session
  (`veemp-emp-<employeeId>-<runId>`) that remembers its own turns.
- **Persona + RAG seeding** on the first turn; real multi-turn, cross-threaded
  rounds; a manager session (`veemp-mgr-…`) synthesizes the final artifact from
  the real transcript.
- **Honest fallback** — turn failures retry once, then degrade to a flagged
  deterministic line; the run is only `fallback: true` if **zero** turns ran live.

Mechanics live in `runtime/openclaw/cli.js` (the only place that shells out; uses
`execFile`, never a shell) and `runtime/openclaw/orchestrator.js`.

### Requirements (only if you choose this adapter)

- The **`openclaw` CLI** on `PATH` (`openclaw --version`).
- A **running OpenClaw Gateway** with at least one agent (`openclaw agents list`).
- Model-provider credentials configured **in OpenClaw itself** (the Gateway owns
  model execution — this app never sees those keys).

If any are missing, selecting `openclaw` still works — it falls back to the
built-in deterministic engine and says so.

### Configuration (all optional, env-overridable)

| Env var | Default | Purpose |
|---------|---------|---------|
| `OPENCLAW_CLI` | `openclaw` | CLI binary used to drive turns |
| `OPENCLAW_AGENT` | *(gateway default)* | route turns to a specific agent (`--agent`) |
| `OPENCLAW_MANAGER_AGENT` | `OPENCLAW_AGENT` | agent used for the manager synthesis pass |
| `OPENCLAW_TIMEOUT_SEC` | `300` | per-turn timeout |
| `OPENCLAW_THINKING` | `low` | thinking level: `off\|minimal\|low\|medium\|high` |
| `OPENCLAW_SESSION_PREFIX` | `veemp` | namespacing prefix for created sessions |
| `OPENCLAW_DISABLE` | *(unset)* | hard kill-switch → force the offline fallback (used by the hermetic test) |

### Health / liveness visibility

- `GET /api/health` → `standalone: { live, engine, model }` **and**
  `openclaw: { live, engine, gateway, version, disabled }`.
- `GET /api/settings` → `runtimes.{standalone,openclaw}` with each adapter's probe.
- The header shows the standalone pill always, plus an **「OpenClaw：可用（可選）」**
  pill only when an OpenClaw Gateway is detected. Each meeting/goal shows a
  **「🦞 真實子代理 N/N 回合 · <model>」** badge when an OpenClaw run was live.

### Caveats

- Each OpenClaw turn is a real model call via your Gateway — slow (tens of
  seconds) and consumes provider quota. Meetings are bounded to ≤ 5 rounds.
- Sessions accumulate in the Gateway's store (one per employee per run); prune
  with the OpenClaw CLI if desired.

---

## 📄 Report export (downloadable `.docx`)

Meeting reports and goal collaboration outputs are persisted in SQLite — this
turns them into **downloadable artifacts** you can hand off. Open a meeting or
goal (or use the ⬇ button in the list) and click **下載 Word（.docx）**; a
polished Word document downloads with a clean, timestamped filename such as
`會議報告-第三季路線圖的取捨-20260704.docx`.

- **Priority format is `.docx`** — a real Word document generated by the pure-JS
  [`docx`](https://www.npmjs.com/package/docx) library (no binaries, no network,
  nothing external — the **standalone-first** design is preserved). **Markdown**
  (`?format=md`) and plain text (`?format=txt`) are also offered for portability.
- **Structured sections.** Meetings export title/topic, participants, runtime
  metadata, minutes (agenda / key points / decisions / action items), the
  synthesized report, the full round-by-round transcript, and knowledge
  references. Goals export title, assignees, runtime metadata, the task
  breakdown (subtask + approach + status per assignee), the collaboration
  output, and knowledge references.
- **Runtime metadata is rendered cleanly** — execution mode, engine, model,
  whether output was live, live/total turns, and whether a fallback was used —
  so every report is honest about how it was produced.
- **Traditional Chinese throughout**, with a CJK-friendly Word font, and
  non-ASCII filenames preserved via an RFC 5987 `Content-Disposition`.

Generation lives in `server/src/export/reportDoc.js` (pure — bytes in, bytes
out), wired through `GET /api/meetings/:id/export` and `/api/goals/:id/export`.

---

## 📥 Document ingestion (MarkItDown)

Grow an employee's knowledge base by **uploading real documents**, not just
pasting text. Open an employee → **📚 個人知識庫** → **⬆ 上傳文件** and pick a
file; it is converted to canonical **Markdown**, chunked, indexed, and instantly
usable for retrieval/grounding — behaving identically to a pasted note.

**Supported types:** `PDF` · `DOCX` · `TXT` · `Markdown` · `HTML` (≤ 15 MB by
default, `UPLOAD_MAX_BYTES`-overridable).

**Markdown is the canonical ingestion format.** The pipeline
(`server/src/ingest/`) is:

```
upload (multipart) ─▶ type + size guard ─▶ extract.js ─▶ canonical Markdown
                                                │              │
                                    MarkItDown (primary)       ├─▶ raw/plain text (fallback copy)
                                    built-in JS (fallback)     └─▶ metadata (filename, mime, sourceType,
                                                                    parser, parseStatus, byteSize)
                                                          ▼
                              section-aware Markdown chunking ─▶ FTS5 index (same path as notes)
```

- **Microsoft [MarkItDown](https://github.com/microsoft/markitdown) is the
  primary parser/canonicalizer** for every supported type. The Node backend
  drives it through a tiny Python helper (`markitdown_helper.py`) via `execFile`
  (never a shell) — the only place the app shells out to Python. It auto-detects
  the interpreter: an explicit `MARKITDOWN_PYTHON`, then a project-local `.venv`,
  then a system `python3`.
- **Standalone-first fallback.** MarkItDown is an *enhancement*, exactly like the
  live LLM. If no Python/markitdown is reachable, text-like formats (TXT / MD /
  HTML) still ingest via a pure-JS extractor; binary formats (PDF / DOCX) surface
  a clear Traditional Chinese error explaining MarkItDown is required. `MARKITDOWN_DISABLE=1`
  forces the fallback (used by the hermetic test).
- **Both forms preserved.** The document stores the **canonical Markdown** (its
  `content`, what gets chunked) *and* a **raw/plain-text** copy in `metadata`,
  plus `originalFilename`, `mimeType`, `sourceType`, `parser`, `parseStatus`, and
  `byteSize`. The employee panel shows a source-type badge and the origin file.
- **Section-aware chunking.** Markdown is split on its heading hierarchy first,
  so a chunk never straddles two unrelated sections and each chunk is prefixed
  with its heading breadcrumb (e.g. `產品規格 › 安全`) — the heading's terms travel
  with its body, improving retrieval precision (`reasoning/chunk.js`
  `chunkMarkdown`).
- **Security.** Ingestion is constrained to the single explicit uploaded file:
  bytes are written to a private temp file (`0600`), parsed, and always deleted;
  only the documented types/extensions are accepted; size is capped at the route
  *and* service.

Configuration (all optional, env-overridable):

| Env var | Default | Purpose |
|---------|---------|---------|
| `MARKITDOWN_PYTHON` | *(auto: `.venv` → `python3`)* | Python interpreter that has `markitdown` |
| `UPLOAD_MAX_BYTES` | `15728640` (15 MiB) | per-file upload ceiling |
| `MARKITDOWN_TIMEOUT_SEC` | `120` | per-conversion subprocess timeout |
| `MARKITDOWN_DISABLE` | *(unset)* | force the pure-JS fallback (used by the hermetic test) |

`GET /api/health` reports `ingest: { markitdown: { available, version },
supportedTypes, supportedExtensions, maxBytes }` so the UI/ops can see whether
the primary parser is live.

---

## 🔌 API reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | status, LLM flag, runtime mode, **standalone** + **OpenClaw** liveness, **ingest capability** (MarkItDown + supported types), counts |
| GET | `/api/dashboard` | lightweight product dashboard: employee / knowledge / run counts, average chunks per document, live-run and live-turn ratios |
| GET/PUT | `/api/settings` | read settings + per-runtime health / switch runtime mode |
| GET/POST | `/api/employees` | list / create employees |
| GET/PUT/DELETE | `/api/employees/:id` | read (with knowledge) / update / delete |
| POST | `/api/employees/generate-profile` | draft a background from fields |
| POST | `/api/employees/ideate` | draft a full role from a description |
| GET/POST | `/api/employees/:id/knowledge` | list / add knowledge documents (chunked + indexed) |
| POST | `/api/employees/:id/knowledge/upload` | **upload a knowledge file** (multipart `file`): PDF/DOCX/TXT/MD/HTML → MarkItDown → Markdown → chunked + indexed |
| GET | `/api/knowledge/search` | keyword/FTS search (`?q=`, optional `?employeeIds=a,b`, `?limit=`) |
| DELETE | `/api/knowledge/:id` | delete a document (and its chunks/index) |
| GET/POST | `/api/meetings` | list / run a multi-agent meeting (`GET` supports `q`, `participantId`, `runtime`, `live`, `sort`, `page`, `pageSize`) |
| GET/DELETE | `/api/meetings/:id` | read / delete a meeting |
| GET | `/api/meetings/:id/export` | download the meeting report (`?format=docx` *(default)* `\| md \| txt`) |
| GET/POST | `/api/goals` | list / assign a collaborative goal (`GET` supports `q`, `assigneeId`, `status`, `runtime`, `live`, `sort`, `page`, `pageSize`) |
| GET | `/api/goals/:id` | read a single goal |
| PUT/DELETE | `/api/goals/:id` | update status/tasks / delete |
| GET | `/api/goals/:id/export` | download the collaboration output (`?format=docx` *(default)* `\| md \| txt`) |

---

## ✅ Validation

`npm test` boots the real Express app on an ephemeral port against an
**in-memory SQLite database** (so it never touches your saved data) and asserts
every core flow: SQLite-backed persistence, employee creation + profile
generation, required-field validation, role ideation, **document chunking**,
**keyword retrieval + employee scoping**, **document ingestion** (uploads a TXT,
Markdown, and HTML file — asserting canonical-Markdown conversion via the built-in
fallback, section-aware chunking with heading breadcrumbs, retrievability, stored
metadata, and that binary/unsupported types are rejected with a clear error), a
**multi-agent meeting** through the
standalone runtime (transcript/minutes/report/grounding, with the offline turns
honestly flagged `engine: 'deterministic'`, `live: false`), collaborative goal
assignment, **report export** (asserts the `.docx` download is a valid OOXML/ZIP
package with an attachment filename, the Markdown export contains the expected
sections, and a missing report exports as `404`), the **runtime switch**, and the
**legacy `simulated` → `standalone` normalization**. The test runs with no API key (so agent turns use the offline
engine) and `OPENCLAW_DISABLE=1` (so the optional OpenClaw path stays hermetic).

`npm run test:openclaw` validates the **optional** OpenClaw integration: it boots
the app with the OpenClaw runtime active and drives a genuine 2-subagent meeting +
a goal through the CLI → Gateway, asserting `engine: 'openclaw-cli'`,
`fallback: false`, with live turns and real transcript text. It **skips (exit 0)**
if no Gateway is reachable, and is not part of `npm test` because each turn is a
real, billable model call.

`npm run test:markitdown` validates the **primary** ingestion path: it generates
a real `.docx` in-process and uploads it, asserting it was converted by
**MarkItDown** (`parser: 'markitdown'`, not the fallback), section-chunked, and
made retrievable. It **skips (exit 0)** if no Python + `markitdown` is reachable,
so it's safe anywhere; it isn't part of `npm test` (which forces the pure-JS
fallback to stay hermetic).

---

## Notes & limitations

- **Standalone by design.** The default path needs nothing external. A Google API
  key upgrades the agent turns from the offline engine to the live model; it is an
  enhancement, not a requirement.
- Single-user, local-first. SQLite in WAL mode is fine for one node; not built for
  concurrent multi-writer deployments.
- Retrieval is keyword/FTS (BM25) today — deliberately dependency-free. The
  `search()` seam is designed for a vector retriever to drop in later. (FTS5's
  `unicode61` tokenizer segments CJK coarsely, so Chinese retrieval matches whole
  runs rather than sub-phrases — a known limitation shared by pasted and uploaded
  knowledge alike.)
- **Document ingestion via MarkItDown is optional** (like the live LLM). Without
  Python/markitdown, TXT/MD/HTML still ingest via a pure-JS fallback; PDF/DOCX
  need MarkItDown installed and otherwise return a clear error. No OCR of
  image-only PDFs in this phase.
- Runs are processed sequentially per request; there's no streaming to the UI yet
  (results appear when the run completes).
- OpenClaw is an **optional** adapter — the app never depends on it. Selecting it
  without a reachable Gateway simply falls back to the built-in engine and says so.
- Data lives in `server/data/app.db`. Delete it (or re-run `npm run seed`) to reset.
```
