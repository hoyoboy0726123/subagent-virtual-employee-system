// CJK-aware FTS helpers (Phase 15).
//
// SQLite's unicode61 tokenizer treats a run of CJK characters as a single
// token, so「電商物流的退貨政策」was ONE token and a search for「退貨」could
// never match. The fix is symmetrical:
//   • INDEX side (`segmentForFts`): insert spaces around every CJK character so
//     each character becomes its own token;
//   • QUERY side (`toMatchQuery`): turn each CJK term into a quoted PHRASE of
//     its characters ("退 貨"), which matches those tokens adjacently.
// English/Latin text is untouched on both sides (porter stemming still applies).
const CJK = /([㐀-䶿一-鿿豈-﫿])/g;
const HAS_CJK = /[㐀-䶿一-鿿豈-﫿]/;

/** Prepare text for insertion into the FTS index. */
export function segmentForFts(text) {
  return String(text || '').replace(CJK, ' $1 ');
}

/**
 * Turn arbitrary user text into a safe FTS5 MATCH expression: extract word
 * tokens, drop single-char Latin fragments, quote everything (quoting
 * neutralizes FTS operator characters), segment CJK terms into phrases, and OR
 * the terms together. Returns null when there is nothing searchable.
 */
export function toMatchQuery(text) {
  const terms = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const uniq = [...new Set(terms)]
    .filter((t) => t.length > 1 || HAS_CJK.test(t))
    .slice(0, 24);
  if (!uniq.length) return null;
  return uniq
    .map((t) => (HAS_CJK.test(t) ? `"${segmentForFts(t).trim().replace(/\s+/g, ' ')}"` : `"${t}"`))
    .join(' OR ');
}
