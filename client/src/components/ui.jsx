import React from 'react';

// Minimal, dependency-free markdown renderer — good enough for the reports the
// engine produces (headings, bold, list items, paragraphs).
export function Markdown({ text = '' }) {
  const lines = String(text).split('\n');
  const blocks = [];
  let list = null;

  const inline = (s) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        <React.Fragment key={i}>{part}</React.Fragment>
      )
    );

  const flush = () => {
    if (list) {
      blocks.push(<ul key={`ul${blocks.length}`}>{list}</ul>);
      list = null;
    }
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
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
  });
  flush();
  return <div className="markdown">{blocks}</div>;
}

export function Modal({ title, children, onClose, wide }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
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
