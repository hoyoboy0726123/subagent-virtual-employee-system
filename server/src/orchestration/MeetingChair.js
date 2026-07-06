// MeetingChair (Phase 15) — the manager agent takes the chair.
//
// Round-robin is a script, not a meeting. With the chair, WITHIN each round the
// manager agent looks at the live conversation and decides WHO speaks next —
// e.g. routing a cost concern straight to the finance persona — and may attach
// a pointed follow-up question that speaker must answer. Fairness is preserved
// structurally: everyone still speaks exactly once per round (the chair picks
// the ORDER from the remaining speakers, it cannot silence anyone), so the
// stored transcript shape stays identical.
//
// Offline (or on any model failure) the chair degrades to the previous
// deterministic sequence, so hermetic runs and the zero-key experience are
// byte-for-byte as stable as before.
import { generate, llmEnabled } from '../reasoning/llm.js';

const asList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

const CHAIR_SYSTEM = [
  '你是這場虛擬員工會議的主持人（主管代理）。你的工作是讓討論高效向前：',
  '根據目前的對話，從「尚未發言」的人選中挑出此刻最該說話的一位——',
  '誰的專業正好對上懸而未決的問題、誰被點名了、誰的立場還沒被檢驗，就選誰。',
  '你也可以（非必要）附一個尖銳但建設性的追問，逼出具體答案。',
  '只輸出 JSON：{"next":"姓名","question":"追問內容或空字串"}，不要任何其他文字。',
].join('\n');

function parsePick(text, remaining) {
  try {
    const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
    const obj = JSON.parse(cleaned.match(/\{[\s\S]*\}/)?.[0] || cleaned);
    const found = remaining.find((p) => p.name === String(obj.next || '').trim());
    if (!found) return null;
    const q = String(obj.question || '').trim();
    return { employee: found, question: q || null };
  } catch {
    return null;
  }
}

/**
 * Pick the next speaker for this round from `remaining`.
 * @param {object} opts
 * @param {string} opts.topic
 * @param {string} opts.roundTitle
 * @param {string} opts.roundGoal
 * @param {object} opts.convo        ConversationState (for the digest)
 * @param {Array}  opts.remaining    participants who have not spoken this round
 * @param {Function} [opts._generate] injectable generate fn (hermetic tests; bypasses the llmEnabled gate)
 * @returns {Promise<{employee: object, question: string|null, live: boolean}>}
 */
export async function pickNextSpeaker({ topic, roundTitle, roundGoal, convo, remaining, _generate }) {
  // Nothing to decide — and the deterministic path keeps prior behaviour exact.
  const fallback = { employee: remaining[0], question: null, live: false };
  if (remaining.length <= 1) return fallback;

  const gen = _generate !== undefined ? _generate : (llmEnabled() ? generate : null);
  if (!gen) return fallback;

  const roster = remaining
    .map((p) => `- ${p.name}（${p.roleTitle}；專長：${asList(p.expertise).slice(0, 3).join('、') || '通用'}）`)
    .join('\n');
  const user = [
    `會議主題：「${topic}」，目前是「${roundTitle}」輪，本輪目標：${roundGoal}。`,
    '',
    '到目前為止的對話：',
    convo.isEmpty ? '（尚無人發言。）' : convo.digest(8),
    '',
    '這一輪還沒發言的人：',
    roster,
    '',
    '請選出下一位發言者（可附一個追問）。',
  ].join('\n');

  const res = await gen({ system: CHAIR_SYSTEM, user, maxTokens: 300, temperature: 0.3 });
  const pick = res?.text ? parsePick(res.text, remaining) : null;
  return pick ? { ...pick, live: true } : fallback;
}
