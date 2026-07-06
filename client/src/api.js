// Thin API client. All calls go to the Express server (proxied in dev).
const json = (method) => (path, body) =>
  fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => {
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(data?.error || `請求失敗（${res.status}）`);
    return data;
  });

// Multipart upload (a File/Blob) to a server endpoint. We deliberately do NOT
// set a Content-Type header — the browser adds the multipart boundary itself.
const uploadFile = (path, file, field = 'file') => {
  const body = new FormData();
  body.append(field, file, file.name);
  return fetch(`/api${path}`, { method: 'POST', body }).then(async (res) => {
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(data?.error || `上傳失敗（${res.status}）`);
    return data;
  });
};

// Consume a Server-Sent-Events POST endpoint (Phase 15 live progress). Calls
// onEvent for every event; resolves with the {type:'done', ...} payload and
// throws on {type:'error'} or transport failure.
const stream = async (path, body, onEvent) => {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok || !res.body) {
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    throw new Error(data?.error || `請求失敗（${res.status}）`);
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
      if (evt.type === 'error') throw new Error(evt.error || '執行失敗');
      onEvent?.(evt);
      if (evt.type === 'done') return evt;
    }
  }
  throw new Error('串流意外中斷');
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
