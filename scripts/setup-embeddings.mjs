// Enable + warm up hybrid semantic retrieval (D2).
//
// Installs the optional local embedding model dependency
// (@huggingface/transformers), then pre-downloads the model and back-indexes
// every existing knowledge chunk into a vector — so the FIRST query after you
// flip EMBEDDINGS_ENABLED=1 is already hybrid, not cold. Entirely optional: with
// it off the app runs pure BM25/FTS exactly as before (standalone-first).
//
// Usage:
//   npm run setup:embeddings          # install dep + backfill vectors
//   EMBEDDINGS_MODEL=... npm run setup:embeddings   # override the model
import { execFileSync } from 'node:child_process';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

// 1) Ensure the optional dependency is present. It's declared in
//    optionalDependencies, so a normal `npm install` may have skipped it (or it
//    failed to build) — install it explicitly here.
console.log('→ 安裝本機嵌入模型依賴 @huggingface/transformers …');
try {
  execFileSync(npmCmd, ['install', '--no-save', '@huggingface/transformers'], { stdio: 'inherit' });
} catch (err) {
  console.error(`✗ 安裝失敗:${err.message}`);
  console.error('  語義檢索是選用功能:不裝也能用純 BM25 全文檢索。');
  process.exit(1);
}

// 2) Turn embeddings on for THIS process and warm the model + backfill vectors.
process.env.EMBEDDINGS_ENABLED = '1';
const { config } = await import('../server/src/config.js');
const { embedder } = await import('../server/src/reasoning/embeddings.js');
const { embedPendingChunks } = await import('../server/src/reasoning/indexer.js');
const { embeddingStats } = await import('../server/src/storage/vector.js');

console.log(`→ 載入嵌入模型 ${config.retrieval.embedding.model}（首次會下載到 HF 快取，請稍候）…`);
if (!(await embedder.ready())) {
  console.error('✗ 模型載入失敗。請確認網路可存取 Hugging Face,或改用 EMBEDDINGS_MODEL 指定其他模型。');
  process.exit(1);
}

const before = embeddingStats(embedder.model());
console.log(`→ 目前 ${before.total} 個知識片段,已嵌入 ${before.embedded},待處理 ${before.missing}。開始回填 …`);

const res = await embedPendingChunks({
  onProgress: (n) => process.stdout.write(`\r  已嵌入 ${n}/${before.missing} …`),
});
process.stdout.write('\n');

const after = embeddingStats(embedder.model());
console.log(`✓ 完成。本次嵌入 ${res.embedded} 個片段,合計 ${after.embedded}/${after.total}。`);
console.log('  最後一步:在 .env 設定 EMBEDDINGS_ENABLED=1 並重啟伺服器,檢索即改為 BM25 + 向量混合。');
