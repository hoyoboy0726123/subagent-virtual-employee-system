# 🧑‍💼 Subagent Virtual Employee System

A runnable product for a **digital virtual-employee system**. You are the
*manager* (the main agent). You create and manage a team of AI *employees*
(subagents), give each one a persona and a personal, searchable **knowledge
base**, pull them into meetings, and assign them collaborative goals — then read
the transcripts, minutes, reports, and collaboration outputs they produce, each
**grounded in retrieved knowledge**.

The entire product UI is in **Traditional Chinese (繁體中文)** — buttons, tabs,
labels, dialogs, empty states, runtime labels, and the generated meeting
reports / collaboration outputs.

It runs **fully offline with zero API keys**. Every subagent contribution is
produced by a deterministic, persona-driven engine grounded with a simple RAG
retrieval layer. An optional live-LLM path (**Google Gen AI**, model
`gemma-4-31b-it`) and a (stubbed) real **OpenClaw** subagent runtime can be
switched on, but nothing requires them.

> **Phase 2** rebuilt the backend on **SQLite** with a clean layered
> architecture (routes → services → runtime → storage/retrieval), added a
> chunked + full-text knowledge base ready for RAG, and introduced a pluggable
> **runtime adapter** abstraction so the app can grow into real OpenClaw
> subagent orchestration. See [Architecture](#️-architecture).

---

## ✨ What it does

| # | Capability | Where |
|---|------------|-------|
| 1 | **Create an employee role** — name, role, personality, expertise, objectives, comms style, plus an auto-generated background you can edit | Employees → *New employee* |
| 2 | **Personal knowledge base** — add/remove documents per employee; each is chunked + full-text indexed and retrieved when the employee reasons | Employees → open a card → *knowledge base* |
| 3 | **Knowledge-grounded meetings** — pick employees, set a topic + rounds; the retrieval layer pulls each participant's most relevant knowledge, and the discussion cites it → **transcript + minutes + report + knowledge used** | Meetings |
| 4 | **Goal assignment** — assign a goal to one or more employees; work is split by expertise into tasks, grounded in their knowledge, with a **collaboration output** | Goals |
| 5 | **New-role ideation** — describe the employee you want; the system drafts a full profile you can edit before saving | Employees → *Ideate a role* |
| 6 | **Retrieval search** — keyword/FTS search across the knowledge base, scoped to one or many employees | `GET /api/knowledge/search` |
| 7 | **Runtime switch** — choose how subagents execute: **Simulated** (offline, default) or **OpenClaw** (stubbed, falls back to simulated) | Header → *Runtime* |
| 8 | **SQLite persistence** — everything survives restarts in a single `.db` file | `server/data/app.db` |

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

### Production-style run (single server)

```bash
npm run serve        # builds the client, then serves API + UI on :3001
# open http://localhost:3001
```

### Other scripts

```bash
npm test             # end-to-end smoke test (boots the app, exercises every flow)
npm run migrate      # apply pending DB migrations + print schema version
npm run seed         # RESET the DB and load sample data
npm run build        # build the client into client/dist
npm start            # serve an already-built client + API on :3001
```

---

## 🏛️ Architecture

Phase 2 introduces clear backend layering. **Routes are thin** — they only adapt
HTTP; all logic lives in **services**, which delegate execution to a **runtime
adapter** and read/write through the **storage/retrieval** layer.

```
HTTP ──▶ routes/ ──▶ services/ ──▶ runtime/ (adapters)      ──▶ reasoning/ (engine, LLM)
                          │                                        │
                          └────────▶ storage/ (repos, retrieval) ◀─┘
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
│   │   ├── runtime/                ── orchestration / runtime adapters ──
│   │   │   ├── AgentRuntimeAdapter.js      base interface
│   │   │   ├── SimulatedRuntimeAdapter.js  default, offline, retrieval-grounded
│   │   │   ├── OpenClawRuntimeAdapter.js   real subagent runtime (STUBBED)
│   │   │   └── index.js                    adapter registry + factory
│   │   │
│   │   ├── reasoning/              ── the "subagent" thinking ──
│   │   │   ├── engine.js  ★        pure, offline, persona + RAG generators
│   │   │   ├── chunk.js            sentence-aware text chunker
│   │   │   └── llm.js              Google Gen AI path (@google/genai; fallback to engine)
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
│   └── test/smoke.mjs              end-to-end HTTP smoke test (in-memory DB)
└── client/                         Vite + React SPA
    └── src/ App.jsx · api.js · components/ui.jsx · pages/
```

**Stack:** Vite + React (client) · Express (API) · **SQLite via `node:sqlite`**
(built into Node — no native module, nothing to compile) with **FTS5** for
full-text retrieval.

### Storage & migrations

Persistence is SQLite. The connection (`db/connection.js`) is a lazily-created
singleton that opens the file, enables WAL + foreign keys, and runs any pending
**migrations** on boot. Migrations are an ordered list keyed off
`PRAGMA user_version`, applied transactionally — adding a schema change is just
appending a function to `db/migrations.js`. `npm run migrate` applies them
explicitly; `npm run seed` resets and reseeds.

Data model: `employees`, `documents`, `chunks`, `chunks_fts` (FTS5),
`meetings`, `goals`, `settings`.

### Knowledge base & retrieval (simple RAG)

Each employee owns **documents** (notes/snippets/context). On write, a document
is split into overlapping, sentence-aware **chunks** (`reasoning/chunk.js`) and
mirrored into an **FTS5** index. `storage/retrieval.js` ranks chunks with
**BM25** and can **scope results to one or many employees** — the core primitive
that keeps meetings and goals grounded in the *right* people's knowledge:

```
GET /api/knowledge/search?q=release%20readiness
GET /api/knowledge/search?q=retention&employeeIds=emp_a,emp_b   # scoped
```

The `search()` signature is the seam where a future **vector/embedding**
retriever would slot in — routes and the runtime depend only on the returned
shape, not on how ranking is done.

### How the "subagents" think

`reasoning/engine.js` turns each persona (role, expertise, personality, comms
style) **plus its retrieved knowledge chunks** into behavior:

- **`generateProfile`** / **`ideateRole`** — draft backgrounds and whole roles.
- **`runMeeting`** — each participant "speaks" over N rounds, grounded in chunks
  retrieved for the topic and scoped to them; produces a **transcript** (with
  citations), **minutes**, and a markdown **report**.
- **`executeGoal`** — decomposes a goal across assignees by expertise, informed
  by their knowledge, into tasks + an integrated **collaboration output**.

The engine is pure and deterministic, so the app is instant, free, and offline —
and it's the guaranteed fallback for every richer runtime.

### Runtime adapters (the path to real OpenClaw subagents)

The service layer never calls the engine directly. It asks the **active runtime
adapter** to `runMeeting` / `executeGoal`. All adapters share one small,
stable interface (`runtime/AgentRuntimeAdapter.js`) so they're interchangeable:

| Adapter | Mode | Behavior |
|---------|------|----------|
| `SimulatedRuntimeAdapter` | `simulated` (default) | Deterministic engine + RAG grounding, fully offline. Enriches the report/plan via Google's Gemma model if `GEMINI_API_KEY` is set. |
| `OpenClawRuntimeAdapter` | `openclaw` | **Stubbed.** Where the manager spawns each employee as a real OpenClaw subagent. Until wired up, it transparently falls back to the simulated adapter and labels its output `fallback: true`. |

Switch modes live from the header, or via the API:

```bash
curl -X PUT localhost:3001/api/settings -d '{"runtimeMode":"openclaw"}' \
     -H 'content-type: application/json'
```

The chosen mode is persisted in the `settings` table, and each stored
meeting/goal records which runtime produced it (`runtime: {mode,label,fallback}`).

#### Wiring up real OpenClaw subagents later

`OpenClawRuntimeAdapter` documents exactly where the live integration plugs in.
Three private methods are the *only* thing a real implementation needs to fill:

- `#spawnSubagent(employee, grounding)` — create one OpenClaw subagent per
  virtual employee, seeded with its persona (system prompt) and retrieved
  knowledge.
- `#dispatchTurn(agent, turnContext)` — send a discussion/work turn and await
  the subagent's reply (this is the real multi-agent loop).
- `#collectArtifact(kind, rawTurns)` — have the manager (main) agent synthesize
  the final minutes/report or tasks/output.

Set `OPENCLAW_ENDPOINT` to flip `configured()` on. Nothing else in the app
changes — services, routes, storage, and the client all depend only on the
adapter interface.

### Optional: live LLM via Google Gen AI (`@google/genai`)

The optional live path uses the official **[`@google/genai`](https://www.npmjs.com/package/@google/genai)**
SDK and Google's **`gemma-4-31b-it`** model. Authentication is by API key —
create one in **[Google AI Studio](https://aistudio.google.com/apikey)** and set
it in the environment:

```bash
export GEMINI_API_KEY=AIza...              # preferred; enables the live path
# export GOOGLE_API_KEY=AIza...            # also accepted as a fallback var
# export GEMINI_MODEL=gemma-4-31b-it       # optional override (this is the default)
npm run dev
```

The header pill flips to **「LLM：即時（Gemma）」**. In simulated mode the meeting
**report** and goal **collaboration output** are then written by Gemma (prompted
in Traditional Chinese), grounded with the retrieved knowledge. The transcript,
minutes, grounding, and every fallback stay deterministic, so **if the key is
missing or any Google call fails, the app silently falls back** to the offline
engine and never breaks on a network error.

**How it's wired** (`server/src/reasoning/llm.js`):

- A single `GoogleGenAI` client is created lazily from `config.llm.apiKey`.
- All generation goes through `ai.models.generateContent(...)`, wrapped by one
  `generate()` primitive that returns a normalized `{ text, functionCalls }`
  shape (or `null` on any failure → deterministic fallback).
- **Function calling is a first-class extension point**: pass `tools` built with
  the exported `toolset(...)` helper and `Type` (re-exported from the SDK), then
  read `.functionCalls` off the result — no call site needs to change to adopt
  tool-calling later.
- Because Gemma models on the Gemini API don't take a separate system role, a
  system instruction is folded into the prompt for Gemma (and passed as a real
  `systemInstruction` for non-Gemma models).

---

## 🔌 API reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | status, LLM/runtime mode, counts (employees, documents, chunks, meetings, goals) |
| GET/PUT | `/api/settings` | read settings + per-runtime health / switch runtime mode |
| GET/POST | `/api/employees` | list / create employees |
| GET/PUT/DELETE | `/api/employees/:id` | read (with knowledge) / update / delete |
| POST | `/api/employees/generate-profile` | draft a background from fields |
| POST | `/api/employees/ideate` | draft a full role from a description |
| GET/POST | `/api/employees/:id/knowledge` | list / add knowledge documents (chunked + indexed) |
| GET | `/api/knowledge/search` | keyword/FTS search (`?q=`, optional `?employeeIds=a,b`, `?limit=`) |
| DELETE | `/api/knowledge/:id` | delete a document (and its chunks/index) |
| GET/POST | `/api/meetings` | list / run a grounded meeting |
| GET/DELETE | `/api/meetings/:id` | read / delete a meeting |
| GET/POST | `/api/goals` | list / assign a goal |
| PUT/DELETE | `/api/goals/:id` | update status/tasks / delete |

---

## ✅ Validation

`npm test` boots the real Express app on an ephemeral port against an
**in-memory SQLite database** (so it never touches your saved data) and asserts
every core flow: SQLite-backed persistence, employee creation + profile
generation, required-field validation, role ideation, **document chunking**,
**keyword retrieval + employee scoping**, a **knowledge-grounded meeting**
(transcript/minutes/report/grounding), goal assignment, the **runtime switch**
(including the labeled OpenClaw fallback), and document deletion.

---

## Notes & limitations

- Single-user, local-first. SQLite in WAL mode is fine for one node; not built
  for concurrent multi-writer deployments.
- Retrieval is keyword/FTS (BM25) today — deliberately dependency-free. The
  `search()` seam is designed for a vector retriever to drop in later.
- The OpenClaw runtime is stubbed; it falls back to the simulated adapter (and
  says so) until the three plug-point methods are implemented.
- Data lives in `server/data/app.db`. Delete it (or re-run `npm run seed`) to
  reset.
