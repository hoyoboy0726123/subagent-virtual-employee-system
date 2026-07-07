// Output reliability helpers.
//
// Phase 10 focus:
//   1) shave off model-y boilerplate when a live turn/report starts with it,
//   2) repair common half-sentence / dangling-tail endings,
//   3) keep utterances and artifacts shaped like demo-ready deliverables.
//
// Phase 19 addition — DETERMINISTIC Traditional Chinese enforcement: some
// models (observed with claude-cli brains) occasionally slip into Simplified
// Chinese or half-width punctuation mid-turn. Prompt rules alone can't
// guarantee it, so every polished utterance/artifact is normalized through
// OpenCC (cn → twp, Taiwan standard with phrase conversion: 软件→軟體) and
// half-width ，：； between CJK characters become full-width. Text that is
// already Traditional passes through byte-identical.
import * as OpenCC from 'opencc-js';

const toTaiwanese = OpenCC.Converter({ from: 'cn', to: 'twp' });
const HAS_CJK = /[㐀-鿿]/;

export function normalizeTraditional(text = '') {
  const s = String(text || '');
  if (!HAS_CJK.test(s)) return s;
  return toTaiwanese(s)
    .replace(/([㐀-鿿]),(?=[㐀-鿿])/g, '$1，')
    .replace(/([㐀-鿿]):(?=[㐀-鿿])/g, '$1：')
    .replace(/([㐀-鿿]);(?=[㐀-鿿])/g, '$1；');
}

const SENTENCE_END = /[。！？!?）)]$/;
const CONNECTOR_WORDS = '(以及|而且|但是|不過|並且|因此|所以|例如|包含|像是|尤其是|同時|另外|接著|然後|如果|並|與|跟|或|及)';
const CONNECTOR_END = new RegExp(`${CONNECTOR_WORDS}$`);
const WEAK_TRAIL = /[，、：；—-]$/;
const CONNECTOR_TRAIL = new RegExp(`${CONNECTOR_WORDS}(?:[，、：；。！？!?])?$`);

function compact(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripSpeakerPrefix(text = '') {
  return String(text)
    .replace(/^[-*•]\s*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^「|」$/g, '')
    .replace(/^[^：\n]{1,20}：\s*/, '');
}

function stripBannedOpeners(text = '') {
  return String(text)
    .replace(/^(從我的角度來看[，,、]?|作為一名[^，,。；:：]{0,18}[，,、]?|總的來說[，,、]?|首先[，,、]?|其次[，,、]?|最後[，,、]?)+/u, '')
    .trim();
}

function removeDanglingTail(text = '') {
  const s = String(text).trim();
  if (!s) return s;
  if (SENTENCE_END.test(s)) return s;

  const lastStrong = Math.max(s.lastIndexOf('。'), s.lastIndexOf('！'), s.lastIndexOf('？'), s.lastIndexOf('!'), s.lastIndexOf('?'));
  if (lastStrong >= 0) {
    const tail = s.slice(lastStrong + 1).trim();
    if (!tail) return s.slice(0, lastStrong + 1).trim();
    if (tail.length <= 18 || CONNECTOR_END.test(tail) || WEAK_TRAIL.test(tail)) {
      return s.slice(0, lastStrong + 1).trim();
    }
  }

  if (CONNECTOR_TRAIL.test(s) || WEAK_TRAIL.test(s)) {
    return s.replace(CONNECTOR_TRAIL, '').replace(/[，、：；—-]+$/g, '').trim();
  }
  return `${s}。`;
}

function ensureTerminal(text = '') {
  const s = String(text).trim();
  if (!s) return s;
  return SENTENCE_END.test(s) ? s : `${s}。`;
}

export function polishUtterance(text = '') {
  let out = compact(text);
  out = stripSpeakerPrefix(out);
  out = stripBannedOpeners(out);
  out = removeDanglingTail(out);
  out = ensureTerminal(out);
  return normalizeTraditional(compact(out));
}

function polishMarkdownBullets(text = '') {
  return String(text)
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (/^(-|\d+\.)\s+/.test(trimmed)) {
        const marker = trimmed.match(/^(-|\d+\.)\s+/)?.[0] || '';
        const body = trimmed.slice(marker.length).trim();
        const clean = removeDanglingTail(stripBannedOpeners(body));
        return `${marker}${ensureTerminal(clean)}`;
      }
      return line;
    })
    .join('\n');
}

export function polishArtifact(text = '') {
  let out = compact(text);
  out = polishMarkdownBullets(out);
  const lines = out.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (!/^#/.test(trimmed) && !/^(-|\d+\.)\s+/.test(trimmed)) {
      lines[i] = ensureTerminal(removeDanglingTail(stripBannedOpeners(trimmed)));
    }
    break;
  }
  return normalizeTraditional(compact(lines.join('\n')));
}
