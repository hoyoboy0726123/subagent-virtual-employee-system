// Thin API client. All calls go to the Express server (proxied in dev).
import { tStatic } from './i18n.jsx';

// Optional access token (server started with AUTH_TOKEN=…). Kept in
// localStorage for fetch headers AND mirrored into a cookie so plain anchor
// downloads (which can't set headers) keep working. On the first 401 we ask
// once, remember, and retry.
const TOKEN_KEY = 'veemp-token';
const getToken = () => localStorage.getItem(TOKEN_KEY) || '';
const setToken = (t) => {
  localStorage.setItem(TOKEN_KEY, t);
  document.cookie = `veemp_token=${encodeURIComponent(t)}; path=/; SameSite=Strict`;
};
const authHeaders = () => (getToken() ? { 'x-auth-token': getToken() } : {});
const promptForToken = () => {
  const t = window.prompt(tStatic('api.tokenPrompt'));
  if (t && t.trim()) { setToken(t.trim()); return true; }
  return false;
};
// ensure the cookie exists on load (e.g. after localStorage survived a cookie wipe)
if (getToken()) setToken(getToken());

const json = (method) => async (path, body, _retried) => {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !_retried && promptForToken()) return json(method)(path, body, true);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || tStatic('api.requestFailed', { status: res.status }));
  return data;
};

// Multipart upload (a File/Blob) to a server endpoint. We deliberately do NOT
// set a Content-Type header — the browser adds the multipart boundary itself.
const uploadFile = (path, file, field = 'file', fields = {}) => {
  const body = new FormData();
  body.append(field, file, file.name);
  for (const [k, v] of Object.entries(fields)) if (v != null) body.append(k, v);
  return fetch(`/api${path}`, { method: 'POST', body, headers: authHeaders() }).then(async (res) => {
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(data?.error || tStatic('api.uploadFailed', { status: res.status }));
    return data;
  });
};

// Consume a Server-Sent-Events POST endpoint (Phase 15 live progress). Calls
// onEvent for every event; resolves with the {type:'done', ...} payload and
// throws on {type:'error'} or transport failure.
const stream = async (path, body, onEvent, _retried) => {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 401 && !_retried && promptForToken()) return stream(path, body, onEvent, true);
  if (!res.ok || !res.body) {
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    throw new Error(data?.error || tStatic('api.requestFailed', { status: res.status }));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const evt = JSON.parse(dataLine.slice(6));
      if (evt.type === 'error') throw new Error(evt.error || tStatic('api.runFailed'));
      onEvent?.(evt);
      if (evt.type === 'done') return evt;
    }
  }
  throw new Error(tStatic('api.streamBroken'));
};

export const api = {
  get: json('GET'),
  post: json('POST'),
  put: json('PUT'),
  del: json('DELETE'),
  upload: uploadFile,
  stream,
};

// Trigger a browser download for a server export endpoint. The server sends
// `Content-Disposition: attachment` with a clean UTF-8 filename, so clicking an
// anchor downloads the file (with that filename) without navigating the page.
// Works both in dev (Vite proxies /api) and in single-server production.
export function download(path) {
  const a = document.createElement('a');
  a.href = `/api${path}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
