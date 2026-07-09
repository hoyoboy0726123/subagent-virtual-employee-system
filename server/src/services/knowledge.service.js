// Service: knowledge base (documents + retrieval + file ingestion).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as docs from '../storage/knowledge.repo.js';
import { getEmployee } from '../storage/employees.repo.js';
import { search as retrievalSearch } from '../storage/retrieval.js';
import { scheduleEmbedding } from '../reasoning/indexer.js';
import { consolidateEmployeeMemories } from '../orchestration/MemoryConsolidator.js';
import { badRequest, notFound, HttpError } from '../util/http.js';
import { id } from '../util/ids.js';
import { config } from '../config.js';
import {
  extractToMarkdown,
  detectType,
  SUPPORTED_TYPES,
  SUPPORTED_EXTENSIONS,
} from '../ingest/extract.js';
import * as markitdown from '../ingest/markitdown.js';

export function listForEmployee(employeeId) {
  if (!getEmployee(employeeId)) throw notFound('找不到該員工');
  return docs.listDocuments(employeeId);
}

export function addDocument(employeeId, data = {}) {
  if (!getEmployee(employeeId)) throw notFound('找不到該員工');
  if (!data.content) throw badRequest('內容為必填');
  const doc = docs.insertDocument(employeeId, data);
  scheduleEmbedding(); // fire-and-forget; no-op unless embeddings are enabled
  return doc;
}

export function removeDocument(documentId) {
  if (!docs.deleteDocument(documentId)) throw notFound('找不到該文件');
  return { ok: true };
}

/**
 * Edit a document's title and/or content. Re-chunks + re-indexes when the
 * content changes so retrieval stays in sync. Returns the updated document with
 * its fresh chunks.
 */
export function editDocument(documentId, patch = {}) {
  const hasTitle = patch.title != null;
  const hasContent = patch.content != null;
  if (!hasTitle && !hasContent) throw badRequest('沒有要更新的欄位');
  if (hasContent && !String(patch.content).trim()) throw badRequest('內容不可為空');
  const updated = docs.updateDocument(documentId, {
    ...(hasTitle ? { title: patch.title } : {}),
    ...(hasContent ? { content: patch.content } : {}),
  });
  if (!updated) throw notFound('找不到該文件');
  scheduleEmbedding(); // fire-and-forget; no-op unless embeddings are enabled
  return getDocumentWithChunks(documentId);
}

/**
 * Manually consolidate an employee's accumulated memory documents (D3). `force`
 * bypasses the auto-trigger threshold — a manual request should run even with a
 * modest backlog. Returns the consolidation result (or a `skipped` reason).
 */
export async function consolidateMemory(employeeId, { force = true } = {}) {
  if (!getEmployee(employeeId)) throw notFound('找不到該員工');
  return consolidateEmployeeMemories(employeeId, { force });
}

/** Full document detail + its retrievable chunks (the knowledge viewer). */
export function getDocumentWithChunks(documentId) {
  const doc = docs.getDocument(documentId);
  if (!doc) throw notFound('找不到該文件');
  return { ...doc, chunks: docs.listChunks(documentId) };
}

/**
 * Ingest an uploaded knowledge file (Phase 7): convert it to canonical Markdown
 * via MarkItDown (with a built-in fallback for text-like types), then feed the
 * Markdown through the SAME chunking + FTS indexing path as pasted notes — so an
 * uploaded PDF/DOCX/TXT/MD/HTML behaves identically in retrieval and grounding.
 *
 * `file` is the multer file object: { originalname, mimetype, size, buffer }.
 */
export async function ingestUpload(employeeId, file) {
  if (!getEmployee(employeeId)) throw notFound('找不到該員工');
  if (!file || !file.buffer || !file.buffer.length) throw badRequest('請選擇要上傳的檔案');

  const originalFilename = file.originalname || 'upload';
  const sourceType = detectType(originalFilename, file.mimetype);
  if (!sourceType) {
    throw badRequest(
      `不支援的檔案類型「${path.extname(originalFilename) || file.mimetype || '未知'}」。`
      + `目前支援：PDF、DOCX、PPTX、XLSX、CSV、TXT、MD、HTML。`,
    );
  }
  if (file.size > config.ingest.maxBytes) {
    const mb = Math.round(config.ingest.maxBytes / (1024 * 1024));
    throw badRequest(`檔案過大（上限 ${mb} MB）。`);
  }

  // Constrain the ingestion surface to this one explicit upload: write the bytes
  // to a private temp file (with the correct extension so MarkItDown detects the
  // type), parse it, then always delete it.
  const ext = SUPPORTED_TYPES[sourceType].ext;
  const tmpPath = path.join(os.tmpdir(), `veemp-upload-${id('up')}${ext}`);
  await fs.writeFile(tmpPath, file.buffer, { mode: 0o600 });

  try {
    const parsed = await extractToMarkdown({
      filePath: tmpPath,
      filename: originalFilename,
      mimeType: file.mimetype,
    });

    if (!parsed.ok || !String(parsed.markdown).trim()) {
      // Surface a clear, actionable error (Traditional Chinese) rather than
      // persisting an empty/broken document.
      throw new HttpError(422, parsed.parseError || '無法從此檔案擷取內容。');
    }

    const title = (parsed.title && parsed.title.trim())
      || path.basename(originalFilename, path.extname(originalFilename))
      || originalFilename;

    const metadata = {
      originalFilename,
      mimeType: parsed.mimeType,
      sourceType,
      byteSize: file.size,
      parser: parsed.parser, // 'markitdown' | 'builtin-text' | 'builtin-html'
      parseStatus: parsed.parseStatus, // 'parsed' | 'fallback'
      parseError: parsed.parseError || null, // note when a fallback kicked in
      // Preserve the raw/plain-text extraction alongside the canonical Markdown.
      rawText: parsed.text || '',
    };

    // Canonical Markdown becomes the document content and is chunked
    // section-aware; tag with the source type for scannability.
    const doc = docs.insertDocument(employeeId, {
      title,
      content: parsed.markdown,
      source: 'file',
      format: 'markdown',
      tags: [sourceType],
      metadata,
    });
    scheduleEmbedding(); // fire-and-forget; no-op unless embeddings are enabled
    return doc;
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

/**
 * Ingestion capability probe for health/settings: whether MarkItDown is
 * reachable, plus the statically supported types (always available via the
 * built-in fallback for text-like formats).
 */
export async function ingestCapability() {
  const md = await markitdown.probe();
  const { getSetupStatus } = await import('../ingest/setupStatus.js');
  return {
    markitdown: { available: md.available, version: md.version || null },
    // Packaged-exe auto-setup progress (idle in a source checkout) — lets the
    // UI/health say「正在背景安裝」instead of a bare unavailable.
    autoSetup: getSetupStatus(),
    supportedTypes: Object.keys(SUPPORTED_TYPES),
    supportedExtensions: SUPPORTED_EXTENSIONS,
    maxBytes: config.ingest.maxBytes,
  };
}

/**
 * Keyword/FTS search over the knowledge base, optionally scoped to one or more
 * employees. Powers the retrieval demo endpoint and (indirectly) the runtime.
 */
export async function search({ query, employeeIds, limit } = {}) {
  if (!query || !String(query).trim()) throw badRequest('查詢字串為必填');
  const ids = Array.isArray(employeeIds)
    ? employeeIds
    : (employeeIds ? String(employeeIds).split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  return retrievalSearch({ query, employeeIds: ids, limit: limit ? Number(limit) : undefined });
}
