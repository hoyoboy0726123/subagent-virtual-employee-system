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

## ✅ Phase 9 — History, search & management polish *(shipped)*

**Goal:** make a growing library of meetings/goals/employees easy to navigate.

- [x] Meetings list now supports **search + filters** by topic/report text,
      participant, runtime mode, and live-vs-offline output.
- [x] Goals list now supports **search + filters** by title/output text,
      assignee, status, runtime mode, and live-vs-offline output.
- [x] Both meetings and goals gained **sorting + pagination** (newest/oldest,
      alpha sorts, configurable page size) and refined empty states that reflect
      active filters rather than only true-zero history.
- [x] Added a lightweight **dashboard** endpoint/UI strip with counts for
      employees / documents / chunks / runs plus live-run and live-turn ratios,
      giving the product a useful operational summary at a glance.
- [x] Smoke tests cover the new dashboard and filtered/paginated list APIs.

_Deferred to a later pass: re-run / duplicate, archive / bulk export, and deeper
run history actions beyond discoverability._

## ✅ Phases 10–12 — Offline output naturalness *(shipped)*

**Goal:** three small polish passes on output quality (previously untracked here
— reconciling this doc with the git history).

- [x] Phase 10: output reliability + demo polish (`orchestration/output.js`
      utterance/artifact polishing, dangling-tail repair).
- [x] Phase 11: de-echo and naturalize offline meeting output.
- [x] Phase 12: reduce template bleed in offline reports.

## ✅ Phase 13 — Agentic tool use *(shipped)*

**Goal:** agents stop being push-fed prompt functions and start *pulling* what
they need — the first step toward true subagent autonomy.

- [x] **Toolbox registry** (`reasoning/tools.js`): declarative tool schemas +
      one `execute()` dispatcher + an honest per-turn `trace`.
- [x] **`search_knowledge`** — always available: mid-turn, an agent can re-query
      *its own* knowledge base with a query it formulates itself (e.g. a term a
      colleague just raised), instead of relying only on the topic-keyword
      grounding pre-injected by the orchestrator. Looked-up chunks merge into the
      turn's citations, so grounding stays honest.
- [x] **`web_search`** — optional, provider-gated (`TAVILY_API_KEY` /
      `WEB_SEARCH_API_KEY`); without a key the tool is simply not offered —
      standalone-first, exactly like the live LLM and MarkItDown.
- [x] **Agentic loop** (`llm.js generateAgentic`): bounded perceive → act →
      observe. Native function calling on models that support it; a prompt
      protocol (single-line JSON request → result fed back → speak) for Gemma,
      which lacks native tool support. Guards: `AGENT_MAX_TOOL_CALLS` per turn
      (default 3) + repeated-identical-call refusal; any failure falls back
      cleanly to the deterministic engine.
- [x] Transcript turns and goal tasks record `toolCalls`; `GET /api/health`
      advertises `tools: { knowledgeSearch, webSearch, maxCallsPerTurn }`.
- [x] Hermetic tests (`npm run test:tools`, part of `npm test`): protocol
      parsing, employee scoping, provider gating (no network), the
      search-then-speak loop, loop bounding, and the zero-overhead no-tool path.

## ✅ Phase 14 — Web-search toggle & autonomous research *(shipped)*

**Goal:** put agent web access under an explicit manager-controlled switch, and
let agents grow their own knowledge base — with the manager as gatekeeper.

- [x] **前端網路搜尋開關**（topbar）。Turning it on requires a configured
      provider key (`TAVILY_API_KEY` / `WEB_SEARCH_API_KEY`) — the toggle is an
      authorization switch persisted in settings, not a key substitute. Exposed
      via `GET/PUT /api/settings` (`webSearch: {keyConfigured, enabled}`) and
      `/api/health` (`tools.webSearch`, `tools.webSearchKey`).
- [x] **Agents get web_search when (and only when) the switch is on** — in
      meetings, goals, and research alike. Toolbox policy (both transports)
      demands source attribution: any claim drawn from the web must name its
      source; consulted sources are tracked (`webSources()`) and merged into the
      turn's citations with `web: true` + URL.
- [x] **Tavily deep search**: `search_depth: "advanced"` (multiple semantically
      relevant snippets per source, 2 credits/query) + `chunks_per_source: 3`,
      Bearer auth, env-overridable (`WEB_SEARCH_DEPTH`, `WEB_SEARCH_CHUNKS_PER_SOURCE`).
- [x] **Autonomous research → manager review → knowledge base**: POST
      `/api/employees/:id/research` runs the employee as a research agent
      (bigger tool budget, `RESEARCH_MAX_TOOL_CALLS`, default 6) that runs
      self-directed multi-angle web searches and writes a structured, attributed
      調查報告 (摘要/重點發現/詳細說明/資料來源/建議). Reports are PENDING until
      the manager approves (→ ingested as a `source: 'research'` knowledge
      document through the same chunk/FTS path) or rejects (archived). A run
      that never actually searched the web is discarded as untrustworthy.
- [x] Schema migration v2 (`research_reports`), research REST API, and the
      research review UI in the employee detail modal.
- [x] Tests: hermetic (toggle gating without key, prerequisite errors, approve/
      reject flow over HTTP, Tavily advanced-depth request shape) and LIVE
      (`npm run test:live:research`): real Gemma 4 + real Tavily — the agent
      chose its own queries, consulted 24 sources, produced an attributed
      report, and approval made it FTS-retrievable. 3/3 passing.

## ✅ Phase 15 — True multi-agent upgrades *(shipped)*

**Goal:** close every remaining gap between "well-orchestrated script" and
"real multi-agent system" from the architecture review.

- [x] **Per-agent config** (migration v3, `employees.agent_config`): each
      employee can override model / temperature / per-turn tool budget, and
      `webSearch:false` forbids the web for that agent even when the global
      toggle is on. Advanced section in the employee form.
- [x] **CJK-aware retrieval** (migration v4): FTS index stores CJK
      character-segmented text and CJK query terms become phrase queries —
      Chinese substring search finally matches (「退貨」 finds 退貨政策).
- [x] **Cross-meeting memory**: MemoryDistiller writes each participant a
      first-person memory document after every meeting (deterministic fallback
      offline; MEETING_MEMORY_DISABLE kill-switch), and the always-available
      `remember` tool lets an agent persist key facts mid-turn. Memories are
      normal knowledge → future groundings and search_knowledge surface them.
- [x] **MeetingChair (dynamic speaking order)**: the manager agent picks who
      speaks next within each round (expertise-routed) and can attach a
      follow-up question the speaker must answer; everyone still speaks once
      per round; offline degrades to the exact previous order. Transcript
      records pickedBy + managerQuestion (👔 badges in the UI).
- [x] **Parallel goals + SSE streaming**: goal assignees now run concurrently
      (wall-clock ≈ slowest assignee); `POST /api/meetings/stream` and
      `POST /api/goals/stream` stream round/turn/task/synthesizing events live,
      and the UI shows the conversation as it happens.
- [x] Tests: 64 hermetic checks + 4/4 live agentic regression passing.

## ✅ Phase 16 — Manager-chaired meetings *(shipped)*

**Goal:** meetings stop being fixed-length scripts — the human MANAGER chairs.

- [x] Meeting lifecycle (`status: discussing | concluded`, migration v5):
      a discussion STOPS after its rounds and waits; only the manager's
      conclusion synthesizes minutes/report and distills memories.
- [x] 繼續討論: `POST /api/meetings/:id/continue/stream` resumes with the full
      transcript (round numbering and every agent's context carry over).
- [x] 主管插話: `POST /api/meetings/interject` — live into a running segment
      (drained before the next speaker) or stored between segments; lands in
      the transcript as a manager turn and is injected into every subsequent
      agent prompt as the top-priority directive.
- [x] 會議室 UI: full live transcript, interject input, continue / conclude
      buttons, 「🟢 討論中」 meetings reopen from the history list.
- [x] Legacy one-shot `POST /api/meetings(/stream)` kept for API compatibility.
- [x] Tests: 65 hermetic checks incl. the full lifecycle (no report before
      conclusion, stored interjection enters the record, double-conclude and
      late interjection refused); live-verified — employees visibly pivot to
      the manager's directive in the continued round.

## ✅ Phase 17 — OpenClaw removal, UI alignment, themes *(shipped)*

- [x] OpenClaw integration removed end-to-end (adapter/CLI bridge/config/health/
      UI); the adapter seam remains with standalone as the only runtime.
- [x] Filter toolbars aligned (labels above full-width controls).
- [x] Claude.ai-inspired light theme (cream + terracotta + serif headings),
      now the DEFAULT; dark stays one click away and the choice persists.
- [x] Knowledge viewer: click any document → full Markdown + its retrievable
      chunks (`GET /api/knowledge/:id`).

## ✅ Phase 18 — Subscription reasoning providers *(shipped)*

**Goal:** run the agents' brain on an already-paid subscription instead of a
metered API key.

- [x] `LLM_PROVIDER = google | claude-cli | codex-cli`. CLI providers drive the
      OFFICIAL binaries (`claude -p --output-format json`, `codex exec --json`)
      as subprocesses — auth stays inside the CLI; we never touch tokens.
- [x] Same `generate()` contract (null → deterministic-engine fallback), so
      every caller is untouched; agentic tool use automatically routes to the
      legacy prompt protocol (`nativeToolsSupported()`), so search_knowledge /
      web_search / remember all still work on subscription brains.
- [x] Guardrails: metered-billing env vars stripped from the child
      (`ANTHROPIC_API_KEY` / `AUTH_TOKEN` / `BASE_URL`) + a loud warning when
      `total_cost_usd > 0` (our live test caught a real mis-billing case);
      Claude Code's own tools disabled (`--disallowedTools`); codex runs
      `--sandbox read-only` in an empty scratch dir; FIFO semaphore caps
      concurrent turns (subscription windows are shared).
- [x] Windows: npm `.cmd` shims can't be exec'd without a shell — `resolveCli`
      locates the packaged real `.exe` (verified live for `claude`).
- [x] Honest identity everywhere: `activeModelInfo()` flows into runtime
      metadata, health, boot banner, and the UI pill.
- [x] ToS notes (researched 2026-07): single-user local use of your own
      subscription is the documented, supported path; routing your credentials
      for other users violates provider terms. Documented in README.
- [x] Tests: 69 hermetic checks (fake-CLI providers: args/stdin/env/JSON+JSONL
      parsing/error paths/gating) + live proof on this machine (probe → real
      in-persona reply through `claude` in 8s, cost guard firing as designed).

## ✅ Phase 19 — Manager 1-on-1 dialogues + TC hardening *(shipped)*

**Goal:** a private, unlimited-turn conversation between the manager and one
employee — with real tool use — whose record only enters the knowledge base if
the manager says so.

- [x] `dialogues` table (migration v6) + REST: open/resume (one open dialogue
      per employee), POST message → in-persona agentic reply (full toolbox:
      「幫我查一下」actually triggers Tavily/knowledge search; per-agent config
      honoured), close with `{save}`.
- [x] Save-and-close distills the conversation into a knowledge document
      (主題／結論與共識／主管的指示／員工的承諾／查證到的關鍵事實, sources kept;
      formatted transcript offline) — source `dialogue`, 💬 1on1 badge, viewable
      in the knowledge viewer. Close-without-save archives only.
- [x] Chat UI in the employee detail modal: bubbles, 🛠 查證 badges + citations,
      optimistic send, end-dialogue flow with the save/discard choice.
- [x] Deterministic Traditional Chinese enforcement hardened: OpenCC cn→twp on
      polished output, gated on simplified-only character evidence so
      pure-Traditional text is never damaged (只能→隻能 regression caught by a
      browser test and fixed), plus CJK half-width punctuation normalization.
- [x] Live-verified: employee web-researched on request (real sources + her own
      meeting memory cited), stayed honest about unavailable 2026 data,
      follow-up turn answered from context, distilled record landed in the
      knowledge base. 72 hermetic checks pass.

## 🧭 Phase 20 — Final product polish & packaging

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
