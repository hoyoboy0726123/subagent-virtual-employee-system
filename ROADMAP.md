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

## 🔜 Phase 7 — Document ingestion pipeline for the knowledge base

**Goal:** let managers grow an employee's knowledge base by *uploading files*,
not just pasting text.

- Accept **PDF / DOCX / TXT / Markdown** uploads via a new
  `POST /api/employees/:id/knowledge/upload` (multipart).
- Server-side text extraction — pure-JS / standalone-first extractors (e.g.
  `mammoth` for `.docx`, a dependency-light PDF text pass, native decode for
  text). No OCR, no cloud parsing in this phase.
- Feed extracted text through the **existing chunking + FTS indexing** path so
  uploaded docs behave exactly like pasted ones in retrieval and grounding.
- Store original filename + mime + byte size as document metadata; surface it in
  the employee knowledge panel.
- Guardrails: size/type limits, graceful "couldn't extract text" messaging in
  Traditional Chinese, and a smoke test that uploads each supported type and
  asserts chunks are indexed and retrievable.

## 🧭 Phase 8 — Output quality & orchestration polish

**Goal:** make agent interactions read less "templated" and more like real
colleagues, and make outputs more useful.

- Richer per-agent prompting: stronger persona conditioning, explicit
  disagreement/build-on-others behavior across rounds, and tighter grounding so
  citations feel earned rather than decorative.
- Improve the manager/synthesizer pass (executive summary, clearer decisions and
  owned action items, deduping repetition across turns).
- Reduce boilerplate phrasing in the deterministic offline engine so the
  zero-key experience still feels substantive.
- Optional: streaming/progress signal to the UI so long runs show life.

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
