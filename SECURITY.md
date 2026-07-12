# Security Policy

## ⚠️ Threat model — read before deploying

This app is designed for **single-user, local-machine use**. It has no
multi-tenancy. The default posture is hardened for that use case:

- **Loopback bind by default** — the server listens on `127.0.0.1`; nothing on
  the network can reach it unless you opt in with `HOST=0.0.0.0` (the Docker
  image sets this, since the container boundary provides the equivalent).
- **No CORS by default** — the client is served same-origin (dev uses the Vite
  proxy); `CORS_ORIGINS` re-enables a strict allow-list if you truly need it.
- **Optional shared-token auth** — set `AUTH_TOKEN=…` and every `/api` request
  must present it (`Authorization: Bearer`, `X-Auth-Token`, or the
  `veemp_token` cookie; the web UI prompts once and remembers). Query-string
  tokens are deliberately NOT accepted (they leak into logs/history).
- **Per-IP rate limiting** on `/api` (default 600 requests / 5 min,
  `RATE_LIMIT=0` disables).
- **Security headers** (`nosniff`, `X-Frame-Options: DENY`, referrer policy,
  camera/mic/geolocation off).

**If you expose it beyond your own machine** (`HOST=0.0.0.0` + port open),
**always set `AUTH_TOKEN`** — without it, anyone who can reach the port can
read/write/delete all your data (employees, knowledge, meetings) and trigger
cost-incurring actions (autonomous research burns Tavily credits;
meetings/goals/dialogues burn your Gemini API or Claude/Codex subscription
usage). A TLS-terminating reverse proxy in front is still recommended for
anything internet-facing.

## Subscription providers (claude-cli / codex-cli)

Using your own Claude Pro/Max or ChatGPT Plus/Pro subscription **for yourself, on
your own machine** is the intended, supported use. **Do not** route your
subscription credentials on behalf of other users — that violates the providers'
terms. The app strips metered-billing credentials from the CLI subprocess
environment and isolates the turn (no host MCP servers, read-only sandbox), but
the single-user boundary is your responsibility.

## What has been reviewed

A multi-agent security audit confirmed the core surfaces are safe: all SQL is
parameterized, the FTS `MATCH` builder neutralizes operators, there is no
`dangerouslySetInnerHTML` (the Markdown renderer emits text nodes only, so
model/web content can't inject script), subprocesses use `execFile` (no shell),
upload temp files are constrained and always deleted, and API keys are never
returned in HTTP responses. The remaining hardening item is the public-deploy
work described above.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Email
**hoyoboy0726@gmail.com** with details and reproduction steps. You'll get an
acknowledgement as soon as possible.
