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

export const api = {
  get: json('GET'),
  post: json('POST'),
  put: json('PUT'),
  del: json('DELETE'),
};
