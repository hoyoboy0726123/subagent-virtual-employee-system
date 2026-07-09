# Security Policy

## ⚠️ Threat model — read before deploying

This app is designed for **single-user, local-machine use**. It has **no
authentication and no multi-tenancy**, and by default **CORS is open** and the
server binds all interfaces. That is fine on `localhost`; it is **not safe to
expose on the public internet as-is**.

If a stranger can reach your instance, they can:

- read/write/delete all your data (employees, knowledge, meetings) — every
  endpoint is unauthenticated;
- trigger cost-incurring actions (autonomous research burns Tavily credits;
  meetings/goals/dialogues burn your Gemini API or Claude/Codex subscription
  usage).

**Before exposing it beyond your own machine**, put it behind a reverse proxy
with authentication, restrict `CORS`, and add rate limiting. The planned
public-deploy hardening is a loopback bind, an `AUTH_TOKEN`, a `CORS`
allow-list, rate limiting, and `helmet`.

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
