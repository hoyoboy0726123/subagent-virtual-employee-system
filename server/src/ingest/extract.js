// Document → Markdown extraction.
//
// Phase 7 ingestion pipeline. Given one uploaded file on disk, produce the
// canonical **Markdown** we store and chunk, plus a raw/plain-text fallback and
// honest parse metadata. Microsoft MarkItDown is the primary parser/canonicalizer
// for every supported type; when it isn't installed we still handle the
// text-like formats (txt / md / html) with a pure-JS fallback so the app stays
// standalone-first. Binary formats (pdf / docx) genuinely need MarkItDown, so
// without it we surface a clear, actionable error instead of guessing.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as markitdown from './markitdown.js';

// The supported upload matrix. MarkItDown is the ONE canonical converter for
// every type (everything becomes Markdown through it); `binary` types can only
// be parsed by MarkItDown, while `textLike` types additionally keep a built-in
// pure-JS fallback so a machine without Python still ingests plain text.
export const SUPPORTED_TYPES = {
  pdf: { ext: '.pdf', mime: 'application/pdf', binary: true },
  docx: {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    binary: true,
  },
  pptx: {
    ext: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    binary: true,
  },
  xlsx: {
    ext: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    binary: true,
  },
  // Tables only become proper Markdown tables through MarkItDown.
  csv: { ext: '.csv', mime: 'text/csv', binary: true },
  txt: { ext: '.txt', mime: 'text/plain', textLike: true },
  md: { ext: '.md', mime: 'text/markdown', textLike: true },
  html: { ext: '.html', mime: 'text/html', textLike: true },
};

// A couple of common aliases we accept and normalize onto a canonical type.
const EXT_ALIASES = { '.markdown': 'md', '.htm': 'html', '.text': 'txt' };

export const SUPPORTED_EXTENSIONS = [
  ...Object.values(SUPPORTED_TYPES).map((t) => t.ext),
  ...Object.keys(EXT_ALIASES),
];

/**
 * Resolve the canonical source type for an upload from its filename (primary)
 * and mime type (secondary). Returns a key of SUPPORTED_TYPES or null.
 */
export function detectType(filename, mimeType) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (EXT_ALIASES[ext]) return EXT_ALIASES[ext];
  const byExt = Object.keys(SUPPORTED_TYPES).find((k) => SUPPORTED_TYPES[k].ext === ext);
  if (byExt) return byExt;
  const mt = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const byMime = Object.keys(SUPPORTED_TYPES).find((k) => SUPPORTED_TYPES[k].mime === mt);
  return byMime || null;
}

/**
 * Extract canonical Markdown (+ raw text + metadata) from an uploaded file.
 *
 * @param {object} p
 * @param {string} p.filePath  absolute path to the uploaded file on disk
 * @param {string} p.filename  original filename (for type detection + metadata)
 * @param {string} [p.mimeType] browser-reported mime type
 * @returns {Promise<{
 *   ok: boolean, sourceType: string|null, mimeType: string,
 *   parser: string|null, parseStatus: string, parseError: string|null,
 *   markdown: string, text: string, title: string|null,
 * }>}
 */
export async function extractToMarkdown({ filePath, filename, mimeType }) {
  const sourceType = detectType(filename, mimeType);
  const resolvedMime = (sourceType && SUPPORTED_TYPES[sourceType].mime) || String(mimeType || 'application/octet-stream');
  const base = { sourceType, mimeType: resolvedMime, title: null };

  if (!sourceType) {
    return {
      ...base,
      ok: false,
      parser: null,
      parseStatus: 'unsupported',
      parseError: `不支援的檔案類型（支援：PDF、DOCX、PPTX、XLSX、CSV、TXT、MD、HTML）。`,
      markdown: '',
      text: '',
    };
  }

  // 1) Primary path: Microsoft MarkItDown for ALL supported types.
  const converted = await markitdown.convert(filePath);
  if (converted.ok && String(converted.markdown || '').trim()) {
    const markdown = normalizeMarkdown(converted.markdown);
    return {
      ...base,
      ok: true,
      parser: 'markitdown',
      parseStatus: 'parsed',
      parseError: null,
      markdown,
      text: markdownToPlainText(markdown),
      title: converted.title || null,
    };
  }

  // 2) Fallback path: text-like formats we can decode ourselves.
  if (SUPPORTED_TYPES[sourceType].textLike) {
    const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
    const built = buildFromText(sourceType, raw);
    if (built.markdown.trim()) {
      return {
        ...base,
        ok: true,
        parser: built.parser,
        parseStatus: 'fallback',
        // Keep the MarkItDown reason around so the UI can explain WHY it fell back.
        parseError: converted.error ? `已使用內建擷取（MarkItDown 不可用：${converted.error}）` : null,
        markdown: built.markdown,
        text: built.text,
      };
    }
  }

  // 3) Binary format with no MarkItDown, or an empty parse → clear failure.
  return {
    ...base,
    ok: false,
    parser: null,
    parseStatus: 'failed',
    parseError:
      converted.error
      || '無法從此檔案擷取內容。' + (SUPPORTED_TYPES[sourceType].binary ? '（此格式需要 MarkItDown：npm run setup:markitdown）' : ''),
    markdown: '',
    text: '',
  };
}

// --- built-in text extractors ------------------------------------------------

function buildFromText(sourceType, raw) {
  if (sourceType === 'html') {
    return { parser: 'builtin-html', markdown: htmlToMarkdown(raw), text: htmlToText(raw) };
  }
  if (sourceType === 'md') {
    // Already Markdown — this IS the canonical form; derive plain text from it.
    const markdown = normalizeMarkdown(raw);
    return { parser: 'builtin-text', markdown, text: markdownToPlainText(markdown) };
  }
  // txt → wrap as-is; the plain text is the same content.
  const clean = normalizeNewlines(raw).trim();
  return { parser: 'builtin-text', markdown: clean, text: clean };
}

const normalizeNewlines = (s) => String(s || '').replace(/\r\n?/g, '\n');

function normalizeMarkdown(s) {
  return normalizeNewlines(s)
    .replace(/[ \t]+$/gm, '') // trailing whitespace
    .replace(/\n{3,}/g, '\n\n') // collapse excessive blank lines
    .trim();
}

// Strip Markdown syntax down to a readable plain-text approximation. Used to
// persist the raw/plain fallback alongside the canonical Markdown.
function markdownToPlainText(md) {
  return normalizeNewlines(md)
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?/g, '')) // fenced code → keep body
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/^\s{0,3}>\s?/gm, '') // blockquotes
    .replace(/^\s*[-*+]\s+/gm, '') // bullet markers
    .replace(/^\s*\d+\.\s+/gm, '') // ordered markers
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → text
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/^\s*\|.*\|\s*$/gm, (m) => m.replace(/\|/g, ' ').trim()) // table rows
    .replace(/^\s*[-:| ]+\s*$/gm, '') // table separators
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- lightweight HTML handling (fallback only) -------------------------------

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ',
};
function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m);
}

const stripHead = (html) =>
  normalizeNewlines(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');

// A deliberately small HTML→Markdown pass. It is NOT a full converter — it just
// preserves the structure that matters for retrieval (headings, lists,
// paragraphs) and is only used when MarkItDown is unavailable.
function htmlToMarkdown(html) {
  let s = stripHead(html);
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) =>
    `\n\n${'#'.repeat(Number(lvl))} ${inline(inner)}\n\n`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => `\n- ${inline(inner)}`);
  s = s.replace(/<(p|div|section|article|tr)[^>]*>/gi, '\n\n').replace(/<\/(p|div|section|article|tr)>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => `**${inline(inner)}**`);
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => `*${inline(inner)}*`);
  s = s.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => `[${inline(inner)}](${href})`);
  s = stripTags(s);
  s = decodeEntities(s);
  return normalizeMarkdown(s);
}

function htmlToText(html) {
  return normalizeMarkdown(decodeEntities(stripTags(stripHead(html))));
}

const inline = (s) => decodeEntities(stripTags(String(s))).replace(/\s+/g, ' ').trim();
const stripTags = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ');
