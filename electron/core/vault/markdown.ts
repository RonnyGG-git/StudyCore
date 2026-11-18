export interface ParsedSection {
  heading: string;
  headingPath: string;
  level: number;
  content: string;
  startLine: number;
  wordCount: number;
}

export interface ParsedDocument {
  title: string;
  tags: string[];
  links: string[];
  sections: ParsedSection[];
  wordCount: number;
}

const MAX_SECTION_WORDS = 900;

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}_]+/gu);
  return m ? m.length : 0;
}

/**
 * Trocea un Markdown por encabezados (ignorando los que están dentro de bloques de código),
 * conservando la ruta de encabezados para poder citar "documento › apartado".
 * Secciones muy largas se dividen por párrafos para que cada fragmento sea citable.
 */
export function parseMarkdown(text: string, fallbackTitle: string): ParsedDocument {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const tags = new Set<string>();
  let i = 0;

  // Variante habitual en el vault: "# Título" y justo debajo un bloque --- clave: valor ---.
  // Se trata como propiedades (no como texto), dejando las líneas en blanco para no mover la numeración.
  const h1 = lines.findIndex((l) => l.trim() !== '');
  if (h1 >= 0 && /^#\s/.test(lines[h1])) {
    let start = h1 + 1;
    while (start < lines.length && !lines[start].trim()) start++;
    if (lines[start]?.trim() === '---') {
      const end = lines.findIndex((l, idx) => idx > start && l.trim() === '---');
      const body = end > 0 ? lines.slice(start + 1, end) : [];
      if (body.length && body.every((l) => !l.trim() || /^[\p{L}\p{N}_ -]+:\s*/u.test(l) || /^\s*-\s+/.test(l))) {
        for (const t of frontmatterTags(body)) tags.add(t);
        for (let k = start; k <= end; k++) lines[k] = '';
      }
    }
  }

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === '---');
    if (end > 0) {
      for (const t of frontmatterTags(lines.slice(1, end))) tags.add(t);
      i = end + 1;
    }
  }

  const stack: { level: number; text: string }[] = [];
  const raw: { heading: string; path: string; level: number; startLine: number; body: string[] }[] = [];
  let current = { heading: '', path: '', level: 0, startLine: i + 1, body: [] as string[] };
  let fence: string | null = null;
  let firstH1: string | null = null;

  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      current.body.push(line);
      continue;
    }
    const h = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      raw.push(current);
      const level = h[1].length;
      const heading = cleanInline(h[2]);
      if (level === 1 && !firstH1) firstH1 = heading;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: heading });
      current = { heading, path: stack.map((s) => s.text).join(' › '), level, startLine: i + 1, body: [] };
      continue;
    }
    if (!fence) for (const m of line.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]*\p{L}[\p{L}\p{N}_/-]*)/gu)) tags.add(m[1].toLowerCase());
    current.body.push(line);
  }
  raw.push(current);

  const links = new Set<string>();
  for (const m of text.matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const target = m[1].trim();
    if (target && !m[0].startsWith('!')) links.add(target);
  }

  const sections: ParsedSection[] = [];
  for (const r of raw) {
    const body = r.body.join('\n').trim();
    if (!body && !r.heading) continue;
    if (!body) continue;
    const words = countWords(body);
    if (words <= MAX_SECTION_WORDS) {
      sections.push({ heading: r.heading || fallbackTitle, headingPath: r.path, level: r.level, content: body, startLine: r.startLine, wordCount: words });
      continue;
    }
    let part = 1;
    for (const chunk of splitByParagraphs(body, MAX_SECTION_WORDS)) {
      const label = `${r.heading || fallbackTitle} (parte ${part++})`;
      sections.push({ heading: label, headingPath: r.path, level: r.level, content: chunk, startLine: r.startLine, wordCount: countWords(chunk) });
    }
  }

  return {
    title: firstH1 ?? fallbackTitle,
    tags: [...tags],
    links: [...links],
    sections,
    wordCount: sections.reduce((a, s) => a + s.wordCount, 0),
  };
}

export function parsePlainText(text: string, title: string): ParsedDocument {
  const body = text.replace(/^﻿/, '').trim();
  const words = countWords(body);
  const chunks = words > MAX_SECTION_WORDS ? splitByParagraphs(body, MAX_SECTION_WORDS) : body ? [body] : [];
  return {
    title,
    tags: [],
    links: [],
    sections: chunks.map((c, idx) => ({
      heading: chunks.length > 1 ? `${title} (parte ${idx + 1})` : title,
      headingPath: '',
      level: 0,
      content: c,
      startLine: 1,
      wordCount: countWords(c),
    })),
    wordCount: words,
  };
}

function splitByParagraphs(body: string, maxWords: number): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  let n = 0;
  for (const p of body.split(/\n\s*\n/)) {
    const w = countWords(p);
    if (n + w > maxWords && buf.length) {
      out.push(buf.join('\n\n'));
      buf = [];
      n = 0;
    }
    buf.push(p);
    n += w;
  }
  if (buf.length) out.push(buf.join('\n\n'));
  return out;
}

function frontmatterTags(lines: string[]): string[] {
  const out: string[] = [];
  for (let j = 0; j < lines.length; j++) {
    const m = /^(tags|tag)\s*:\s*(.*)$/i.exec(lines[j]);
    if (!m) continue;
    const inline = m[2].trim();
    if (inline) {
      out.push(...inline.replace(/^\[|\]$/g, '').split(',').map(cleanTag));
    } else {
      for (let k = j + 1; k < lines.length && /^\s*-\s+/.test(lines[k]); k++) out.push(cleanTag(lines[k].replace(/^\s*-\s+/, '')));
    }
  }
  return out.filter(Boolean).map((t) => t.toLowerCase());
}

function cleanTag(t: string): string {
  return t.trim().replace(/^['"]|['"]$/g, '').replace(/^#/, '').trim();
}

function cleanInline(s: string): string {
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}
