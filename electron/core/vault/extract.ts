import fs from 'node:fs';
import { countWords, parsePlainText, type ParsedDocument, type ParsedSection } from './markdown';

const MIN_WORDS_PER_SECTION = 60;

/**
 * PDF → una sección por página (o varias páginas cortas juntas), para que las citas digan
 * «documento › Página N». Un PDF sin texto extraíble (escaneado) devuelve null.
 */
export async function extractPdf(abs: string, title: string): Promise<ParsedDocument | null> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(abs)));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (Array.isArray(text) ? text : [text]).map((t) => t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim());
  const sections: ParsedSection[] = [];
  let buf: string[] = [];
  let from = 1;
  const flush = (to: number) => {
    const content = buf.join('\n\n').trim();
    if (content) {
      const heading = from === to ? `Página ${from}` : `Páginas ${from}-${to}`;
      sections.push({ heading, headingPath: heading, level: 2, content, startLine: from, wordCount: countWords(content) });
    }
    buf = [];
  };
  pages.forEach((p, i) => {
    if (!buf.length) from = i + 1;
    if (p) buf.push(p);
    if (countWords(buf.join(' ')) >= MIN_WORDS_PER_SECTION || i === pages.length - 1) flush(i + 1);
  });
  const words = sections.reduce((a, s) => a + s.wordCount, 0);
  if (words < 20) return null;
  return { title, tags: [], links: [], sections, wordCount: words };
}

export async function extractDocx(abs: string, title: string): Promise<ParsedDocument | null> {
  const mammoth = await import('mammoth');
  const { value } = await (mammoth.default ?? mammoth).extractRawText({ path: abs });
  const doc = parsePlainText(value.replace(/\n{3,}/g, '\n\n'), title);
  return doc.wordCount < 5 ? null : doc;
}
