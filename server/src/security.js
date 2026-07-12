// Public-deploy hardening (Phase 2-1). All of it is OFF-by-default-invisible:
// a local single-user setup behaves exactly as before. The pieces only matter
// when someone exposes the server beyond localhost:
//
//   HOST=0.0.0.0        opt IN to non-loopback binding (Docker sets this)
//   AUTH_TOKEN=…        require a shared token on every /api request
//   CORS_ORIGINS=…      allow-list for cross-origin browsers (default: none —
//                       the client is served same-origin, dev uses Vite proxy)
//   RATE_LIMIT / RATE_WINDOW_SEC   per-IP sliding-window limiter on /api
//
// Zero new dependencies: tiny hand-rolled middlewares beat pulling in helmet +
// express-rate-limit + cookie-parser for a single-user app.
import { config } from './config.js';

/** Conservative security headers that cannot break a same-origin SPA. */
export function securityHeaders() {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  };
}

/**
 * CORS allow-list. By default we emit NO CORS headers at all — the client is
 * served by this same server (and the dev client reaches us through the Vite
 * proxy), so cross-origin access is simply not a thing this app needs. Setting
 * CORS_ORIGINS="https://a.example,https://b.example" re-enables it for those.
 */
export function corsAllowList() {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Auth-Token');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  };
}

/**
 * Per-IP sliding-window rate limiter for /api. Generous by default (600
 * requests / 5 min) — a human clicking around never notices; a scraper or a
 * runaway script does. In-memory on purpose: single-process, single-user app.
 */
export function rateLimiter() {
  const hits = new Map(); // ip → number[] (request timestamps)
  let lastSweep = Date.now();
  return (req, res, next) => {
    const max = config.rateLimit.max;
    if (!max) return next(); // RATE_LIMIT=0 disables
    const windowMs = config.rateLimit.windowSec * 1000;
    const now = Date.now();
    // periodic sweep so idle IPs don't accumulate forever
    if (now - lastSweep > windowMs) {
      for (const [ip, arr] of hits) {
        const live = arr.filter((t) => now - t < windowMs);
        if (live.length) hits.set(ip, live); else hits.delete(ip);
      }
      lastSweep = now;
    }
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: '請求太頻繁，請稍後再試。' });
    }
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}

/** Minimal cookie read without a cookie-parser dependency. */
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

/**
 * Optional shared-token auth on /api. Accepts the token via Authorization
 * Bearer, X-Auth-Token, or the veemp_token cookie (the cookie exists so anchor
 * downloads — which can't set headers — keep working; we deliberately do NOT
 * accept ?token= query strings, which end up in logs and history).
 */
export function requireAuthToken() {
  return (req, res, next) => {
    const expected = config.authToken;
    if (!expected) return next(); // not configured → open (local single-user)
    const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || req.headers['x-auth-token']
      || readCookie(req, 'veemp_token');
    if (got === expected) return next();
    res.status(401).json({ error: '需要存取權杖（AUTH_TOKEN）。' });
  };
}
