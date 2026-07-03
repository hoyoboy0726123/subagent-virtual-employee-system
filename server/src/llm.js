// Optional live-LLM integration.
//
// The app is fully functional WITHOUT any API key — every feature falls back to
// the deterministic engine. If ANTHROPIC_API_KEY is set in the environment,
// the meeting / goal / ideation routes will instead ask Claude to generate
// richer, persona-grounded output using Node 22's built-in fetch (no SDK dep).

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export function llmEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function complete(system, user, maxTokens = 1500) {
  if (!llmEnabled()) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      console.warn('[llm] request failed, falling back to deterministic engine:', res.status);
      return null;
    }
    const data = await res.json();
    return data?.content?.[0]?.text ?? null;
  } catch (err) {
    console.warn('[llm] error, falling back to deterministic engine:', err.message);
    return null;
  }
}
