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
import { getSetting } from '../storage/settings.repo.js';

const asList = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

// ── Chair configuration (user-tunable in ⚙️ 設定) ───────────────────────────
// dynamicOrder — the chair reorders each round by the discussion (off = fixed
//                round-robin, zero chair LLM calls);
// followUps    — the chair may attach a pointed question to a speaker;
// style        — the chair's tone: gentle | standard | strict;
// model        — model override for CHAIR calls only ('' = the active brain).
export const CHAIR_SETTING_KEY = 'chairConfig';
export const CHAIR_STYLES = ['gentle', 'standard', 'strict'];

export function sanitizeChairConfig(raw = {}) {
  return {
    dynamicOrder: raw.dynamicOrder !== false,
    followUps: raw.followUps !== false,
    style: CHAIR_STYLES.includes(raw.style) ? raw.style : 'standard',
    model: typeof raw.model === 'string' ? raw.model.trim().slice(0, 80) : '',
  };
}

export function getChairConfig() {
  try {
    return sanitizeChairConfig(JSON.parse(getSetting(CHAIR_SETTING_KEY) || '{}'));
  } catch {
    return sanitizeChairConfig({});
  }
}

const STYLE_LINES = {
  gentle: '你的主持風格溫和而鼓勵：追問以開放式問題引導對方展開，不施壓、不逼供，先肯定再深挖。',
  standard: '你也可以（非必要）為其中某些人附一個尖銳但建設性的追問，逼出具體答案。',
  strict: '你的主持風格直接而嚴格：追問必須逼出具體數字、期限與可驗收的承諾，對含糊、場面話式的回答毫不留情地點破。',
};

function chairSystem(cfg) {
  return [
    '你是這場虛擬員工會議的主持人（主管代理）。你的工作是讓這一輪討論高效向前：',
    '根據目前的對話，為「這一輪所有尚未發言的人」安排最有生產力的發言順序——',
    '誰的專業正好對上懸而未決的問題、誰被點名了、誰的立場還沒被檢驗，就讓誰先講。',
    cfg.followUps
      ? STYLE_LINES[cfg.style] || STYLE_LINES.standard
      : '不要附加任何追問，question 一律輸出空字串。',
    '只輸出 JSON：{"order":[{"name":"姓名","question":"追問或空字串"}, ...]}，',
    '名單必須涵蓋下面每一個人剛好一次，不要任何其他文字。',
  ].join('\n');
}

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
 * @param {object}  [opts._chairConfig] injectable chair config (hermetic tests)
 * @returns {Promise<{order: Array<{employee, question}>, live: boolean}>}
 */
export async function planRoundOrder({ topic, roundTitle, roundGoal, convo, participants, _generate, _chairConfig }) {
  const cfg = _chairConfig ? sanitizeChairConfig(_chairConfig) : getChairConfig();
  const deterministic = participants.map((p) => ({ employee: p, question: null }));
  if (participants.length <= 1) return { order: deterministic, live: false };
  // Dynamic ordering switched off (⚙️ 設定): fixed round-robin, zero chair calls.
  if (!cfg.dynamicOrder) return { order: deterministic, live: false };

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

  const res = await gen({
    system: chairSystem(cfg), user, maxTokens: 500, temperature: 0.3,
    ...(cfg.model ? { model: cfg.model } : {}), // chair-only model override
  });
  const order = res?.text ? parseOrder(res.text, participants) : null;
  if (!order) return { order: deterministic, live: false };
  // Belt-and-suspenders: with follow-ups off, strip any question the model
  // produced anyway (the prompt already forbids them).
  if (!cfg.followUps) for (const o of order) o.question = null;
  return { order, live: true };
}
