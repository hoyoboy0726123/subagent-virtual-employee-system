// Hermetic test preamble — import this FIRST (before any config-backed module).
//
// Two leaks it plugs:
//   • DB: without DB_FILE the config points at the REAL dev database
//     (server/data/app.db) — and provider selection reads the settings table,
//     so a brain the USER switched to in the UI (e.g. claude-cli) leaks into
//     the test run and makes "offline" paths go live against a real CLI /
//     real subscription quota. ':memory:' isolates every suite.
//   • env keys: a developer shell with GEMINI_API_KEY/TAVILY_API_KEY set would
//     likewise flip llmEnabled()/webSearchConfigured() on. Tests that want a
//     key inject fakes explicitly.
process.env.DB_FILE = ':memory:';
process.env.LLM_PROVIDER = 'google';
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.TAVILY_API_KEY;
delete process.env.WEB_SEARCH_API_KEY;
