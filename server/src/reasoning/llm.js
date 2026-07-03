// Optional live-LLM integration (Anthropic).
//
// The app is fully functional WITHOUT any API key — every feature falls back to
// the deterministic engine. If ANTHROPIC_API_KEY is set, the Simulated runtime
// uses Claude to enrich reports/plans (grounded with retrieved knowledge),
// using Node's built-in fetch (no SDK dependency).
import { config, llmEnabled } from '../config.js';

export { llmEnabled };

export async function complete(system, user, maxTokens = 1500) {
  if (!llmEnabled()) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.llm.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.llm.model,
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
