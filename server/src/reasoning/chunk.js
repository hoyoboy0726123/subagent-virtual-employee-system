// Text chunking for retrieval.
//
// Splits a document into overlapping, sentence-aware chunks. We greedily pack
// sentences up to ~chunkSize characters, then start the next chunk with a small
// overlap so a fact spanning a boundary is still retrievable from both sides.
// Character-based sizing keeps this dependency-free (no tokenizer) and is more
// than good enough for keyword/FTS retrieval.
import { config } from '../config.js';

export function chunkText(text, opts = {}) {
  // Markdown-aware ingestion (Phase 7): when the canonical form is Markdown we
  // chunk section-by-section so a heading's context travels with its body and a
  // chunk never straddles two unrelated sections. Falls through to the plain
  // sentence packer for prose.
  if (opts.format === 'markdown') return chunkMarkdown(text, opts);

  const size = opts.chunkSize || config.retrieval.chunkSize;
  const overlap = opts.chunkOverlap || config.retrieval.chunkOverlap;

  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // Split into sentence-ish units, preserving the delimiter. Handles BOTH Latin
  // (.!? + following whitespace) and CJK (full-width 。！？；… which are NOT
  // followed by a space) — without the CJK case, a Chinese document with no
  // blank lines was one giant unsplittable unit (this app's primary language is
  // Chinese), so chunks overran their size and boundaries fell mid-sentence.
  const units = clean
    .split(/(?<=[。！？；…])|(?<=[.!?])\s+|\n{2,}/u)
    .map((s) => s.trim())
    .filter(Boolean);

  // If the text has no sentence structure (e.g. one long line), hard-wrap it.
  const pieces = units.length ? units : hardWrap(clean, size);

  const chunks = [];
  let buf = '';
  for (const piece of pieces) {
    if (buf && (buf.length + piece.length + 1) > size) {
      chunks.push(buf.trim());
      buf = tail(buf, overlap);
    }
    buf = buf ? `${buf} ${piece}` : piece;
    // A single oversized piece becomes its own chunk(s).
    while (buf.length > size * 1.5) {
      chunks.push(buf.slice(0, size).trim());
      buf = buf.slice(size - overlap);
    }
  }
  if (buf.trim()) chunks.push(buf.trim());

  return chunks.filter(Boolean);
}

// Section-aware Markdown chunker (Phase 7).
//
// Splits Markdown on its heading hierarchy first, then packs each section's body
// with the same sentence-aware logic — but never across a heading boundary. Each
// emitted chunk is prefixed with its heading breadcrumb (e.g. "產品規格 › 安全"),
// so the heading's terms travel with the body: retrieval that matches a section
// title still surfaces the right passage, and a returned chunk is self-describing.
export function chunkMarkdown(text, opts = {}) {
  const size = opts.chunkSize || config.retrieval.chunkSize;
  const overlap = opts.chunkOverlap || config.retrieval.chunkOverlap;

  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const lines = clean.split('\n');
  const headingRe = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
  const sections = [];
  const stack = []; // ancestor headings: { level, text }
  let heading = null;
  let body = [];

  const flush = () => {
    const bodyText = body.join('\n').trim();
    if (!bodyText && !heading) return;
    sections.push({ path: stack.map((h) => h.text), bodyText });
  };

  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(headingRe);
    if (m) {
      flush();
      const lvl = m[1].length;
      while (stack.length && stack[stack.length - 1].level >= lvl) stack.pop();
      stack.push({ level: lvl, text: m[2].trim() });
      heading = m[2].trim();
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();

  // No real heading structure → treat it as prose (avoids a single giant chunk).
  if (!sections.some((s) => s.path.length)) {
    return chunkText(clean, { ...opts, format: undefined });
  }

  const out = [];
  for (const sec of sections) {
    const crumb = sec.path.join(' › ');
    const prefix = crumb ? `${crumb}\n\n` : '';
    const budget = Math.max(120, size - prefix.length);
    const bodyChunks = sec.bodyText
      ? chunkText(sec.bodyText, { chunkSize: budget, chunkOverlap: overlap })
      : [];
    if (!bodyChunks.length && crumb) out.push(crumb); // heading-only section stays searchable
    for (const c of bodyChunks) out.push(prefix + c);
  }
  return out.filter(Boolean);
}

function tail(s, n) {
  if (n <= 0) return '';
  return s.slice(Math.max(0, s.length - n));
}

function hardWrap(s, size) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
