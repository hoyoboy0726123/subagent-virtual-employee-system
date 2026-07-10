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

// Deterministic Simplified→Traditional, applied PER CHARACTER with cn→t (plain
// s2t, not the twp phrase variant). Per-char conversion avoids OpenCC's phrase
// context (which damaged 只能→隻能), and a small keep-list protects the handful
// of characters that are valid in Taiwan Traditional writing yet OpenCC still
// "corrects" per-char (台→臺, 后→後, 里→裏, 范→範) — so 平台 / 台北 / 皇后 survive.
// Genuinely-simplified chars (软→軟, 内→內, 计→計, 户→戶, 转→轉…) still convert.
// Traditional text is left byte-identical; no manual simplified list needed.
const cn2t = OpenCC.Converter({ from: 'cn', to: 't' });
const HAS_CJK = /[㐀-鿿]/;
const KEEP = new Set(['台', '后', '里', '范']); // Taiwan-valid; OpenCC over-converts these per-char

// Some models (observed with gemma-4) emit LaTeX inline math — $\rightarrow$,
// $\ge 64GB$, $\le 13.9\text{mm}$ — which our plain Markdown renderer shows as
// raw garbage. Convert the common commands to Unicode, unwrap \text{}, and drop
// the $…$ delimiters. Deliberately PRECISE: only $…$ spans that actually contain
// a backslash command are touched, so a price like "$799" is never damaged.
const LATEX_CMD = {
  rightarrow: '→', Rightarrow: '⇒', longrightarrow: '→', to: '→',
  leftarrow: '←', Leftarrow: '⇐', leftrightarrow: '↔', mapsto: '↦',
  ge: '≥', geq: '≥', le: '≤', leq: '≤', neq: '≠', ne: '≠', ll: '≪', gg: '≫',
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '＊',
  approx: '≈', equiv: '≡', propto: '∝', infty: '∞', sim: '∼', simeq: '≃',
  ldots: '…', dots: '…', cdots: '⋯', deg: '°', circ: '°', bullet: '•', checkmark: '✓',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ',
  mu: 'µ', pi: 'π', sigma: 'σ', Omega: 'Ω', Delta: 'Δ', Sigma: 'Σ',
};
const convertLatex = (inner) => String(inner)
  // Superscript degree ("60^\circ C" / "60^{\circ}C" → "60°C") — handle before
  // the generic command pass so the caret is consumed too.
  .replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°')
  .replace(/\\(?:text|textbf|textit|textrm|mathrm|mathbf|mathit|mathsf|operatorname)\s*\{([^{}]*)\}/g, '$1')
  .replace(/\\([a-zA-Z]+)/g, (m, cmd) => (Object.prototype.hasOwnProperty.call(LATEX_CMD, cmd) ? LATEX_CMD[cmd] : m))
  // Strip leftover super/subscript braces that carry no command ("x^{2}" → "x2").
  .replace(/[_^]\s*\{([^{}]*)\}/g, '$1')
  .replace(/\\([%&_#{}$])/g, '$1');

export function stripLatexMath(text = '') {
  let s = String(text);
  if (!s.includes('\\')) return s; // the artifact always involves a backslash command
  // $…$ / $$…$$ spans that contain a LaTeX command → unwrap + drop the $ markers.
  s = s.replace(/\$\$?([^$\n]*?\\[a-zA-Z][^$\n]*?)\$\$?/g, (m, inner) => convertLatex(inner));
  // \( … \) and \[ … \] math spans.
  s = s.replace(/\\[([]([^\n]*?)\\[)\]]/g, (m, inner) => convertLatex(inner));
  // Bare commands outside any delimiter (e.g. "\rightarrow 陳冠宇").
  return convertLatex(s);
}

export function normalizeTraditional(text = '') {
  const s = stripLatexMath(String(text || ''));
  if (!HAS_CJK.test(s)) return s;
  return s
    .replace(/[㐀-鿿]/g, (ch) => (KEEP.has(ch) ? ch : cn2t(ch)))
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

// Structured content (a 1-on-1 report may contain a code block, a Markdown
// table, or a bullet list) must NOT be whitespace-compacted, tail-trimmed, or
// terminal-punctuated — those steps flatten code indentation, append 。 after a
// ``` fence, and delete short final list items. Detect it and only normalize
// Traditional Chinese + tidy line whitespace, leaving the structure intact.
const STRUCTURED = /```|(^|\n)\s*\|.*\|/;

export function polishUtterance(text = '') {
  const raw = String(text || '');
  if (STRUCTURED.test(raw)) {
    return normalizeTraditional(raw.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  }
  let out = compact(raw);
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
