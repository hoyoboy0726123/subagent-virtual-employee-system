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
 * neutralizes FTS operator characters), and OR the terms together. Returns null
 * when there is nothing searchable.
 *
 * CJK recall upgrade (D1): a long compound like 「退貨政策」 used to become ONE
 * exact adjacent phrase "退 貨 政 策", so 「退貨的政策」 (a 的 inserted) never
 * matched. Terms of ≥4 CJK tokens now emit the full phrase (BM25 ranks an exact
 * hit first) PLUS every consecutive bigram ("退 貨", "貨 政", "政 策"), so
 * paraphrases and split compounds still match. Short terms (≤3 tokens) and Latin
 * words are unchanged.
 */
export function toMatchQuery(text) {
  const terms = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const uniq = [...new Set(terms)]
    .filter((t) => t.length > 1 || HAS_CJK.test(t))
    .slice(0, 12);
  if (!uniq.length) return null;

  const clauses = [];
  for (const t of uniq) {
    if (!HAS_CJK.test(t)) { clauses.push(`"${t}"`); continue; }
    const tokens = segmentForFts(t).trim().split(/\s+/).filter(Boolean);
    clauses.push(`"${tokens.join(' ')}"`); // full phrase (highest BM25 rank)
    if (tokens.length >= 4) {
      for (let i = 0; i + 1 < tokens.length; i++) clauses.push(`"${tokens[i]} ${tokens[i + 1]}"`);
    }
  }
  // Dedupe + cap so the MATCH expression stays bounded.
  return [...new Set(clauses)].slice(0, 32).join(' OR ') || null;
}
