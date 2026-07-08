// Server-Sent Events plumbing (Phase 20 / Milestone C2), shared by every
// streaming endpoint. Adds three things the hand-rolled versions lacked:
//   1. a heartbeat comment frame every 20s so reverse proxies (nginx 60s,
//      Heroku 55s, Cloudflare 100s) don't cut a connection during a long
//      synthesis phase;
//   2. `x-accel-buffering: no` so nginx doesn't buffer the stream (events would
//      otherwise never reach the browser until the response ended);
//   3. an AbortSignal wired to the client disconnect, so a long agent run can
//      stop burning LLM calls the moment the user closes the tab.
// Every write is guarded by `writableEnded` so a closed socket is a no-op, not
// a crash.

/**
 * Open an SSE stream on `res`. Returns { send, signal, done }.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function openSse(req, res) {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();

  const send = (e) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
  const hb = setInterval(() => { if (!res.writableEnded) res.write(': hb\n\n'); }, 20_000);

  // Abort on RESPONSE close (client disconnected mid-stream). NOTE: use res, not
  // req — req 'close' fires as soon as the POST body is fully received, which is
  // immediate and would abort the run before it even starts.
  const ac = new AbortController();
  res.on('close', () => ac.abort());

  const done = () => { clearInterval(hb); if (!res.writableEnded) res.end(); };
  return { send, signal: ac.signal, done };
}

/**
 * Run a streaming operation and frame its result. `fn(send, signal)` should do
 * the work and return the final object; it's emitted as {type:'done',[key]:...}.
 * @param {string} [resultKey='result'] key the result is nested under in `done`
 */
export async function streamRun(req, res, fn, resultKey = 'result') {
  const { send, signal, done } = openSse(req, res);
  try {
    const result = await fn(send, signal);
    send({ type: 'done', [resultKey]: result });
  } catch (err) {
    send({ type: 'error', error: err.message || '內部錯誤' });
  } finally {
    done();
  }
}
