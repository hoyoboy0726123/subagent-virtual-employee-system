// MeetingChair (Phase 15) — the manager agent takes the chair.
//
// Round-robin is a script, not a meeting. With the chair, the manager agent
// looks at the conversation-so-far and orders the WHOLE round — who speaks in
// what sequence — routing e.g. a cost concern to the finance persona first, and
// optionally attaching a pointed follow-up question per person. Fairness is
// preserved structurally: everyone still speaks exactly once per round (the
// chair sets the ORDER, it can't silence anyone — omitted names are appended),
// so the stored transcript shape is identical.
//
// C3 (Milestone C): the chair plans the ENTIRE round in ONE call, instead of
// one call before every speaker (P calls → 1). That removes P−1 sequential LLM
// round-trips per round from the critical path. Speakers still react to one
// another (each sees the prior turns), and mid-round manager interjections are
// still injected into subsequent speakers — only the routing DECISION is
// batched. Between rounds the chair re-plans against everything said so far.
//
// Offline (or on any model failure / invalid plan) the chair degrades to the
// deterministic input order, so hermetic runs and the zero-key experience are
// byte-for-byte as stable as before.
import { generate, llmEnabled } from '../reasoning/llm.js';

const asList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

const CHAIR_SYSTEM = [
  '你是這場虛擬員工會議的主持人（主管代理）。你的工作是讓這一輪討論高效向前：',
  '根據目前的對話，為「這一輪所有尚未發言的人」安排最有生產力的發言順序——',
  '誰的專業正好對上懸而未決的問題、誰被點名了、誰的立場還沒被檢驗，就讓誰先講。',
  '你也可以（非必要）為其中某些人附一個尖銳但建設性的追問，逼出具體答案。',
  '只輸出 JSON：{"order":[{"name":"姓名","question":"追問或空字串"}, ...]}，',
  '名單必須涵蓋下面每一個人剛好一次，不要任何其他文字。',
].join('\n');

// Parse the chair's ordering. Robust: keep the LLM's order for names it named
// (deduped), then append any participant it omitted (in input order) so no one
// is ever silenced. Returns null only if nothing usable was produced.
function parseOrder(text, participants) {
  try {
    const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
    const obj = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned);
    const list = Array.isArray(obj.order) ? obj.order : null;
    if (!list) return null;
    const byName = new Map(participants.map((p) => [p.name, p]));
    const seen = new Set();
    const order = [];
    for (const item of list) {
      const name = String(item?.name || '').trim();
      const emp = byName.get(name);
      if (!emp || seen.has(name)) continue;
      seen.add(name);
      order.push({ employee: emp, question: String(item?.question || '').trim() || null });
    }
    if (!order.length) return null;
    for (const p of participants) if (!seen.has(p.name)) order.push({ employee: p, question: null });
    return order;
  } catch {
    return null;
  }
}

/**
 * Plan the speaking order for a whole round in ONE chair call.
 * @param {object} opts
 * @param {string} opts.topic
 * @param {string} opts.roundTitle
 * @param {string} opts.roundGoal
 * @param {object} opts.convo          ConversationState (for the digest)
 * @param {Array}  opts.participants   everyone who speaks this round (unspoken)
 * @param {Function} [opts._generate]  injectable generate fn (hermetic tests)
 * @returns {Promise<{order: Array<{employee, question}>, live: boolean}>}
 */
export async function planRoundOrder({ topic, roundTitle, roundGoal, convo, participants, _generate }) {
  const deterministic = participants.map((p) => ({ employee: p, question: null }));
  if (participants.length <= 1) return { order: deterministic, live: false };

  const gen = _generate !== undefined ? _generate : (llmEnabled() ? generate : null);
  if (!gen) return { order: deterministic, live: false };

  const roster = participants
    .map((p) => `- ${p.name}（${p.roleTitle}；專長：${asList(p.expertise).slice(0, 3).join('、') || '通用'}）`)
    .join('\n');
  const user = [
    `會議主題：「${topic}」，目前是「${roundTitle}」輪，本輪目標：${roundGoal}。`,
    '',
    '到目前為止的對話：',
    convo.isEmpty ? '（尚無人發言。）' : convo.digest(8),
    '',
    '這一輪要發言的人：',
    roster,
    '',
    '請安排這一輪的發言順序（可為部分人附追問）。',
  ].join('\n');

  const res = await gen({ system: CHAIR_SYSTEM, user, maxTokens: 500, temperature: 0.3 });
  const order = res?.text ? parseOrder(res.text, participants) : null;
  return order ? { order, live: true } : { order: deterministic, live: false };
}
