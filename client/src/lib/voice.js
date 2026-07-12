// Browser voice helpers (half-duplex Live 對談): Web Speech TTS (speak) + STT
// (recognizer). Zero dependency, no API key, runs fully on-device — so voice
// works with ANY brain (Gemini / Claude / Codex / offline). Chrome & Edge only
// for STT; TTS is broadly supported.

export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
export const sttSupported = typeof window !== 'undefined'
  && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

// Voice list loads async on first access; cache it and refresh on the event.
let voices = [];
function refreshVoices() { voices = ttsSupported ? window.speechSynthesis.getVoices() : []; }
if (ttsSupported) {
  refreshVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
}

/** Best available zh-TW voice — prefer the modern neural voices (Yating /
 *  Zhiwei / HsiaoChen) over the older robotic Hanhan, then any zh voice. */
export function pickZhVoice() {
  if (!voices.length) refreshVoices();
  const zh = voices.filter((v) => /^zh/i.test(v.lang) || /Chinese|Mandarin|Hanhan|Yating|Zhiwei|Hsiao/i.test(v.name));
  return zh.find((v) => /Yating/i.test(v.name))
    || zh.find((v) => /Zhiwei|Hsiao/i.test(v.name))
    || zh.find((v) => /^zh-TW/i.test(v.lang))
    || zh[0] || null;
}

/**
 * Speak text aloud. Cancels any in-flight utterance first (barge-in). Returns
 * the utterance so callers can attach further handlers; resolves nothing.
 */
export function speak(text, { rate = 1, pitch = 1, onend, onstart } = {}) {
  if (!ttsSupported || !text) return null;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new window.SpeechSynthesisUtterance(String(text));
  const v = pickZhVoice();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'zh-TW'; }
  u.rate = rate; u.pitch = pitch;
  if (onstart) u.onstart = onstart;
  if (onend) { u.onend = onend; u.onerror = onend; }
  synth.speak(u);
  return u;
}

/** Stop any current TTS immediately. */
export function stopSpeaking() { if (ttsSupported) window.speechSynthesis.cancel(); }

/**
 * Trigger the browser's native microphone permission prompt and resolve once
 * the user allows it. SpeechRecognition.start() alone does NOT reliably show
 * the prompt (it just throws not-allowed when permission isn't already
 * granted), so we request getUserMedia first — that's what pops the "Allow
 * microphone?" dialog — then immediately release the stream (recognition opens
 * its own). Returns { ok } or { ok:false, error } ('denied' | 'no-device' | …).
 */
export async function ensureMicPermission() {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: true }; // let recognition try anyway
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((tr) => tr.stop()); // permission granted; we don't need the stream
    return { ok: true };
  } catch (err) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, error: 'denied' };
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return { ok: false, error: 'no-device' };
    return { ok: false, error: name || 'unknown' };
  }
}

/**
 * Create an STT session. Callbacks: onInterim(text), onFinal(text), onError(code),
 * onEnd(). Returns { start, stop, abort }. One utterance per start() (continuous
 * off) so a natural pause ends the turn and we can send it.
 */
export function createRecognizer({ lang = 'zh-TW', continuous = true, onInterim, onFinal, onError, onEnd } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = lang;
  rec.interimResults = true;
  // continuous=true for press-and-hold: a mid-sentence pause must NOT end the
  // turn — the user ends it by releasing the button (stop()).
  rec.continuous = continuous;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    if (interim) onInterim?.(interim);
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => {
    const t = finalText.trim();
    finalText = '';
    if (t) onFinal?.(t);
    onEnd?.();
  };
  return {
    start() { finalText = ''; try { rec.start(); } catch { /* already started */ } },
    stop() { try { rec.stop(); } catch { /* not running */ } },
    abort() { try { rec.abort(); } catch { /* not running */ } },
  };
}
