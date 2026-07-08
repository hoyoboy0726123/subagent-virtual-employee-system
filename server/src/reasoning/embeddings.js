// Optional semantic embeddings (D2) — standalone-first, exactly like the live
// LLM and MarkItDown.
//
// Turns chunk/query text into L2-normalized vectors with a LOCAL transformers.js
// model (`@huggingface/transformers`). That package is NOT a declared dependency
// — it's installed on demand by `npm run setup:embeddings` (same pattern as the
// MarkItDown Python helper), so a plain `npm install` stays lean. If it isn't
// installed, or the model can't load, the embedder reports itself unavailable and
// retrieval silently stays on pure BM25/FTS — identical to today. There is NO
// network call at query time once the model is cached; the first load downloads
// the model to the Hugging Face cache.
//
// The whole surface is injectable (`__setEmbedderForTest`) so the retrieval and
// fusion logic can be exercised hermetically without a 100 MB model download.
import { config } from '../config.js';

let _extractorPromise = null; // singleton model load (real path)
let _override = null;         // injected fake embedder (tests)
let _warned = false;          // load-failure note is emitted once, not per call

const cfg = () => config.retrieval.embedding;

/**
 * Inject a fake embedder for hermetic tests.
 * @param {?{model?: string, dim: number, embed: (texts: string[]) => number[][]|Promise<number[][]>}} fake
 *   Pass null to clear. When set, `embeddingsEnabled()` reports true regardless
 *   of config, so a test never needs to touch EMBEDDINGS_ENABLED.
 */
export function __setEmbedderForTest(fake) {
  _override = fake;
  _extractorPromise = null;
  _warned = false;
}

/** Is semantic retrieval switched on? (Config flag, or a test override.) Does
 *  NOT guarantee the model actually loads — callers still handle unavailability. */
export function embeddingsEnabled() {
  return _override ? true : Boolean(cfg().enabled);
}

// L2-normalize so cosine similarity reduces to a dot product. A zero vector
// (e.g. text that matched no signal in a fake embedder) is left as zeros.
function l2normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (!norm) return Float32Array.from(vec);
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  return out;
}

async function loadExtractor() {
  let transformers;
  try {
    transformers = await import('@huggingface/transformers');
  } catch {
    if (!_warned) {
      _warned = true;
      console.info(
        '[embeddings] 未安裝 @huggingface/transformers,語義檢索停用(退回純 BM25)。'
        + '執行 `npm run setup:embeddings` 以啟用混合檢索。',
      );
    }
    return null;
  }
  try {
    // Let transformers.js pick the model's default weights/dtype (the option
    // name for quantization differs across v2/v3 — omitting it stays portable).
    // The pipeline caches the model after first load.
    return await transformers.pipeline('feature-extraction', cfg().model);
  } catch (err) {
    if (!_warned) {
      _warned = true;
      console.warn(`[embeddings] 模型載入失敗(${cfg().model}):${err.message}。退回純 BM25。`);
    }
    return null;
  }
}

export const embedder = {
  /** The model id vectors are tagged with (must match on store + query). */
  model: () => (_override ? (_override.model || 'test-embedder') : cfg().model),

  /** Load the model if needed; resolves false when embeddings are unavailable. */
  async ready() {
    if (!embeddingsEnabled()) return false;
    if (_override) return true;
    if (!_extractorPromise) _extractorPromise = loadExtractor();
    return Boolean(await _extractorPromise);
  },

  /**
   * Embed texts into L2-normalized vectors.
   * @param {string[]} texts
   * @param {{kind?: 'query'|'passage'}} [opts] applies the e5 instruction prefix
   * @returns {Promise<number[][]|null>} null when embeddings are unavailable
   */
  async embed(texts, { kind = 'passage' } = {}) {
    if (!Array.isArray(texts) || !texts.length) return [];
    const prefix = kind === 'query' ? cfg().queryPrefix : cfg().passagePrefix;
    const inputs = texts.map((t) => `${prefix}${String(t ?? '')}`);

    if (_override) {
      const raw = await _override.embed(inputs);
      return raw.map((v) => Array.from(l2normalize(Float32Array.from(v))));
    }
    if (!(await this.ready())) return null;
    const extractor = await _extractorPromise;
    // mean-pooled + normalized sentence embeddings; tolist() → number[][].
    const out = await extractor(inputs, { pooling: 'mean', normalize: true });
    return out.tolist();
  },
};
