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

export const api = {
  get: json('GET'),
  post: json('POST'),
  put: json('PUT'),
  del: json('DELETE'),
  upload: uploadFile,
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
