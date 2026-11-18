import { Fragment, type ReactNode } from 'react';

/**
 * Renderizador Markdown pequeño y SEGURO: construye elementos React, nunca inyecta HTML.
 * Cubre lo que producen Claude y las notas de Obsidian: encabezados, listas, código, citas,
 * tablas, separadores y formato en línea. Las marcas [S1]/[R2] se delegan a `renderRef`.
 */
export interface MarkdownProps {
  text: string;
  renderRef?: (ref: string) => ReactNode;
  className?: string;
}

export function Markdown({ text, renderRef, className }: MarkdownProps) {
  return <div className={`prose-sc ${className ?? ''}`}>{renderBlocks(text, renderRef)}</div>;
}

type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; text: string }
  | { t: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'hr' };

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push({ t: 'code', lang: fence[2], text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ t: 'h', level: h[1].length, text: h[2].replace(/\s+#+\s*$/, '') });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ t: 'quote', text: body.join('\n').replace(/^\[!(\w+)\][+-]?\s*/, (_, k: string) => `**${k.charAt(0).toUpperCase()}${k.slice(1)}** · `) });
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push({ t: 'table', head, rows });
      continue;
    }
    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: { text: string; depth: number }[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push({ text: m[3].replace(/^\[( |x)\]\s*/i, (_, x: string) => (x.trim() ? '☑ ' : '☐ ')), depth: Math.min(3, Math.floor(m[1].replace(/\t/g, '  ').length / 2)) });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i++].trim()}`;
        } else break;
      }
      out.push({ t: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*```|\s*~~~|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])) para.push(lines[i++].trim());
    if (!para.length) para.push(lines[i++].trim());
    out.push({ t: 'p', text: para.join(' ') });
  }
  return out;
}

function renderBlocks(src: string, renderRef?: (ref: string) => ReactNode): ReactNode[] {
  return parseBlocks(src).map((b, k) => {
    const il = (s: string) => inline(s, renderRef);
    switch (b.t) {
      case 'h': {
        const Tag = (`h${Math.min(4, b.level)}`) as 'h1';
        return <Tag key={k}>{il(b.text)}</Tag>;
      }
      case 'p':
        return <p key={k}>{il(b.text)}</p>;
      case 'code':
        return (
          <pre key={k} data-lang={b.lang || undefined}>
            <code>{b.text}</code>
          </pre>
        );
      case 'quote':
        return <blockquote key={k}>{renderBlocks(b.text, renderRef)}</blockquote>;
      case 'hr':
        return <hr key={k} />;
      case 'table':
        return (
          <div key={k} className="overflow-x-auto max-w-full">
            <table>
              <thead>
                <tr>{b.head.map((c, j) => <th key={j}>{il(c)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, j) => <td key={j}>{il(c)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag key={k}>
            {b.items.map((it, j) => (
              <li key={j} style={it.depth ? { marginLeft: `${it.depth * 1.1}rem` } : undefined}>
                {il(it.text)}
              </li>
            ))}
          </Tag>
        );
      }
    }
  });
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)]+\))|(\[(?:[SR]\d{1,2})(?:\s*,\s*[SR]\d{1,2})*\])/g;

export function inline(text: string, renderRef?: (ref: string) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const s = m[0];
    if (m[1]) out.push(<code key={k++}>{s.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k++}>{inline(s.slice(2, -2), renderRef)}</strong>);
    else if (m[3]) out.push(<em key={k++}>{inline(s.slice(1, -1), renderRef)}</em>);
    else if (m[4]) {
      const inner = s.slice(2, -2);
      out.push(<span key={k++} className="text-accent">{inner.includes('|') ? inner.split('|')[1] : inner.split('#')[0]}</span>);
    } else if (m[5]) out.push(<span key={k++} className="underline decoration-line underline-offset-2">{/^\[([^\]]+)\]/.exec(s)![1]}</span>);
    else if (m[6]) {
      const refs = s.slice(1, -1).split(/\s*,\s*/);
      out.push(<Fragment key={k++}>{refs.map((r) => (renderRef ? <Fragment key={r}>{renderRef(r)}</Fragment> : `[${r}]`))}</Fragment>);
    }
    last = m.index! + s.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
