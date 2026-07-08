import React from 'react';
import { download } from '../api.js';

// Report download controls. `path` is the export endpoint (e.g. `/meetings/ID`);
// we request `.docx` by default and offer Markdown as a portable alternative.
// `compact` renders the icon-only variant used inside list rows.
export function ExportButtons({ path, compact = false }) {
  const go = (format) => (e) => { e.stopPropagation(); download(`${path}/export?format=${format}`); };
  if (compact) {
    return (
      <button className="icon-btn" onClick={go('docx')} title="下載 Word 報告（.docx）" aria-label="下載 Word 報告">⬇</button>
    );
  }
  return (
    <span className="export-buttons">
      <button className="btn btn-sm" onClick={go('docx')} title="下載 Word 文件">⬇ 下載 Word（.docx）</button>
      <button className="btn-ghost btn-sm" onClick={go('md')} title="下載 Markdown">Markdown</button>
    </span>
  );
}

// Minimal, dependency-free markdown renderer — headings, bold, inline code,
// list items, paragraphs, fenced code blocks, and GFM pipe TABLES (agents
// legitimately produce roadmaps/plans as tables — raw `|---|` text is not
// acceptable output). Deliberately does NOT parse raw HTML (sanitation stance —
// keep it that way if you ever replace this). Memoized (C5): the parse is
// O(text); unchanged transcript rows must not re-parse on every keystroke.
function MarkdownImpl({ text = '' }) {
  const lines = String(text).split('\n');
  const blocks = [];
  let list = null;

  const inline = (s) =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
      return <React.Fragment key={i}>{part}</React.Fragment>;
    });

  const flush = () => {
    if (list) {
      blocks.push(<ul key={`ul${blocks.length}`}>{list}</ul>);
      list = null;
    }
  };

  // --- GFM pipe tables ---------------------------------------------------
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => isRow(l) && /^[\s|:-]+$/.test(l) && l.includes('-');
  const splitRow = (l) => {
    const r = l.trim().replace(/^\|/, '').replace(/\|$/, '');
    return r.split('|').map((c) => c.trim());
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // Fenced code block: verbatim until the closing fence (or end of text).
    if (/^```/.test(line)) {
      flush();
      const buf = [];
      let j = i + 1;
      for (; j < lines.length && !/^```/.test(lines[j].trimEnd()); j++) buf.push(lines[j]);
      blocks.push(<pre key={`pre${i}`}><code>{buf.join('\n')}</code></pre>);
      i = j; // skip past the closing fence
      continue;
    }

    // Table: a run of consecutive |…| rows. LENIENT about the |---| separator
    // (present → row 0 is the header; a model that omits it still gets a real
    // table, just headerless) — LLM output is not always spec-perfect.
    if (isRow(line) && !isSep(line)) {
      const run = [line];
      while (i + 1 < lines.length && isRow(lines[i + 1].trimEnd())) run.push(lines[++i].trimEnd());
      if (run.length >= 2) {
        flush();
        const hasHeader = isSep(run[1]);
        const header = hasHeader ? splitRow(run[0]) : null;
        const body = (hasHeader ? run.slice(2) : run).filter((r) => !isSep(r)).map(splitRow);
        blocks.push(
          <div className="table-wrap" key={`tb${i}`}>
            <table>
              {header && (
                <thead><tr>{header.map((c, ci) => <th key={ci}>{inline(c)}</th>)}</tr></thead>
              )}
              <tbody>
                {body.map((cells, ri) => (
                  <tr key={ri}>{cells.map((c, ci) => <td key={ci}>{inline(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }
      // A single stray |…| line falls through and renders as a paragraph.
    }

    if (/^#{1,6}\s/.test(line)) {
      flush();
      const level = line.match(/^#+/)[0].length;
      const Tag = `h${Math.min(level + 2, 6)}`;
      blocks.push(<Tag key={i}>{inline(line.replace(/^#+\s/, ''))}</Tag>);
    } else if (/^[-*]\s/.test(line)) {
      list = list || [];
      list.push(<li key={i}>{inline(line.replace(/^[-*]\s/, ''))}</li>);
    } else if (line === '') {
      flush();
    } else {
      flush();
      blocks.push(<p key={i}>{inline(line)}</p>);
    }
  }
  flush();
  return <div className="markdown">{blocks}</div>;
}

export const Markdown = React.memo(MarkdownImpl);

export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="關閉">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

// Multi-select checklist of employees.
export function EmployeePicker({ employees, selected, toggle }) {
  return (
    <div className="picker">
      {employees.map((e) => (
        <label key={e.id} className={selected.includes(e.id) ? 'chip chip-on' : 'chip'}>
          <input
            type="checkbox"
            checked={selected.includes(e.id)}
            onChange={() => toggle(e.id)}
          />
          <span className="chip-name">{e.name}</span>
          <span className="chip-role">{e.roleTitle}</span>
        </label>
      ))}
    </div>
  );
}
