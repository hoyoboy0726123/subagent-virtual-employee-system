# 🗺️ Productization Roadmap

This document tracks the staged work that takes the standalone virtual employee
system from *"already useful"* to *"productized and truly good to use."* Each
phase is scoped to be shippable on its own, keeps the **standalone-first**
architecture (no external runtime or network required to run), and preserves the
**Traditional Chinese (繁體中文)** product UI.

Legend: ✅ shipped · 🔜 next · 🧭 planned

Phases 1–5 (foundation) are complete and described in the [README](./README.md):
MVP → SQLite + layered backend + RAG → Traditional Chinese UI + Google Gen AI →
real OpenClaw subagent runtime → **standalone built-in multi-agent runtime**.

---

## ✅ Phase 6 — Downloadable report artifacts *(shipped)*

**Goal:** turn persisted meeting reports and goal collaboration outputs into
real, downloadable documents.

- [x] Primary format: polished **Word `.docx`** (pure-JS `docx` generator — no
      binaries, no network), plus portable **Markdown** / plain text.
- [x] Backend export endpoints: `GET /api/meetings/:id/export` and
      `GET /api/goals/:id/export` (`?format=docx|md|txt`, `docx` default);
      added `GET /api/goals/:id`.
- [x] Frontend download buttons in the Meetings & Goals detail views plus a
      compact `⬇` control on each list row (Traditional Chinese labels).
- [x] Clean, structured exports: title/topic, attendees/assignees, runtime
      metadata (mode/engine/model/live/fallback), minutes or task breakdown,
      report/output body, full transcript, and knowledge references.
- [x] CJK-friendly font + RFC 5987 `Content-Disposition` so Traditional Chinese
      filenames survive intact (e.g. `會議報告-<topic>-20260704.docx`).
- [x] Smoke tests assert a valid OOXML/ZIP `.docx`, the attachment filename,
      Markdown section content, and a `404` on a missing report.

---

## ✅ Phase 7 — Document ingestion pipeline for the knowledge base *(shipped)*

**Goal:** let managers grow an employee's knowledge base by *uploading files*,
not just pasting text.

- [x] Accept **PDF / DOCX / TXT / Markdown / HTML** uploads via a new
      `POST /api/employees/:id/knowledge/upload` (multipart, `multer`).
- [x] **Microsoft [MarkItDown](https://github.com/microsoft/markitdown) is the
      canonical document → Markdown pipeline** — the Node backend drives it through
      a small Python helper via `execFile` (never a shell; the only Python
      touch-point). Markdown is treated as the canonical ingestion format.
- [x] **Standalone-first fallback** — MarkItDown is an optional enhancement (like
      the live LLM): TXT/MD/HTML still ingest via a pure-JS extractor when it's
      absent; PDF/DOCX surface a clear Traditional Chinese error. Auto-detects a
      project-local `.venv`; `MARKITDOWN_DISABLE=1` forces the fallback.
- [x] Preserve **both** the canonical Markdown (chunked) and a raw/plain-text copy;
      store `originalFilename` / `mimeType` / `sourceType` / `parser` /
      `parseStatus` / `byteSize` metadata, surfaced in the employee knowledge panel
      with source-type badges.
- [x] **Section-aware Markdown chunking** — split on the heading hierarchy so a
      chunk never straddles unrelated sections, each prefixed with its heading
      breadcrumb — then fed through the *existing* chunking + FTS path so uploaded
      docs behave exactly like pasted ones in retrieval and grounding.
- [x] Guardrails: route + service size caps, type/extension allow-list, private
      `0600` temp file always deleted, graceful TC error messaging. `GET /api/health`
      advertises the ingestion capability + supported types.
- [x] Tests: hermetic `npm test` uploads TXT/MD/HTML (fallback path) asserting
      conversion, section chunking, retrieval, metadata, and rejection of
      binary/unsupported types; opt-in `npm run test:markitdown` proves the real
      MarkItDown path with an in-process `.docx`.

## ✅ Phase 8 — Output quality & orchestration polish *(shipped)*

**Goal:** make agent interactions read less "templated" and more like real
colleagues, and make outputs more useful.

- [x] **Richer per-agent prompting** — the persona system instruction is built
      from the employee's *full* profile (role, expertise, personality, comms
      style, objectives, **and** the generated background side-profile) and now
      conditions **voice + behaviour**: speak in-character, hold a position,
      disagree with reasons, build on a *named* colleague. A list of templated
      openers is explicitly banned; creative temperature is nudged per-employee
      (deterministically) so distinct personas also phrase distinctly.
- [x] **Agent-aware conversation state** — `ConversationState.contextFor` packs an
      *agent-specific* view into each turn: who it's answering (previous other
      speaker, by name), its own last stance (consistency), and what others said
      (without echoing itself). A per-round **stance** (open → challenge → commit)
      makes later turns reflect earlier ones coherently and decisions feel earned.
- [x] **Sharper manager/synthesizer pass** — briefed as a chief of staff; meeting
      reports use 執行摘要 / 討論脈絡 / 決議 / 行動項目 / 風險與待解問題 and goal outputs
      use 目標與成功標準 / 分工 / 相依與交接 / 整合計畫 / 里程碑, de-duping the transcript
      and citing retrieved knowledge only where earned.
- [x] **Concrete goal decomposition** — each assignee sees the other assignees'
      roles/expertise, so slices don't overlap and hand-offs are named; approaches
      state deliverables, dependencies, acceptance criteria and risk.
- [x] **De-boilerplated offline engine** — deterministic turns vary phrasing by a
      reproducible per-employee seed, weave in a persona lens, name prior speakers,
      and commit to a workline-specific acceptance bar; report/minutes gained an
      exec summary, discussion threads and open-questions — so the zero-key path
      stays substantive. (Fixed a signed-shift index bug that could emit `undefined`.)
- [x] **Tests** — a new hermetic `server/test/smoke.orchestration.mjs`
      (`npm run test:orchestration`, also run by `npm test`) asserts persona
      differentiation, the agent-aware context split, banned-boilerplate absence,
      named callbacks, earned citations, and the richer report/output structure.

_Deferred to a later pass: streaming/progress signal to the UI for long runs._

## 🧭 Phase 9 — History, search & management polish

**Goal:** make a growing library of meetings/goals/employees easy to navigate.

- List-view **search + filters** (by topic/title, participant/assignee, date,
  runtime engine, live vs. offline).
- Sort + pagination for meetings and goals; empty/loading states refined.
- Re-run / duplicate a meeting or goal; rename/archive; bulk export.
- Lightweight dashboard counts (documents, chunks, runs, live-turn ratio).

## 🧭 Phase 10 — Final product polish & packaging

**Goal:** ship-ready operational clarity.

- First-run onboarding, clearer runtime/API-key status surfacing, and inline help
  in Traditional Chinese.
- Optional **PDF export** (built on the Phase 6 export seam).
- Error-state and toast/notification consistency; accessibility pass.
- Packaging: one-command run, `.env.example`, and deploy notes; optional Docker
  image that keeps the standalone-first guarantee.

---

*This roadmap is intentionally practical: each phase is independently shippable,
does not regress prior phases, and preserves the standalone-first + Traditional
Chinese product guarantees.*
