// Text chunking for retrieval.
//
// Splits a document into overlapping, sentence-aware chunks. We greedily pack
// sentences up to ~chunkSize characters, then start the next chunk with a small
// overlap so a fact spanning a boundary is still retrievable from both sides.
// Character-based sizing keeps this dependency-free (no tokenizer) and is more
// than good enough for keyword/FTS retrieval.
import { config } from '../config.js';

export function chunkText(text, opts = {}) {
  const size = opts.chunkSize || config.retrieval.chunkSize;
  const overlap = opts.chunkOverlap || config.retrieval.chunkOverlap;

  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // Split into sentence-ish units, preserving the delimiter.
  const units = clean
    .split(/(?<=[.!?])\s+|\n{2,}/)
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

function tail(s, n) {
  if (n <= 0) return '';
  return s.slice(Math.max(0, s.length - n));
}

function hardWrap(s, size) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}
