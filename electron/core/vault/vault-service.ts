import fs from 'node:fs';
import path from 'node:path';
import type { DocumentView, IndexProgress, SearchHit, TreeNode, VaultStats } from '../../../shared/types';
import type { Db } from '../db/database';
import { parseMarkdown, parsePlainText, type ParsedDocument } from './markdown';
import { extractDocx, extractPdf } from './extract';
import { resolveInVault, toRel } from './paths';

export const INDEXED_EXT = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx']);
/** PDF y DOCX: su texto se extrae con unpdf / mammoth (sin módulos nativos). */
const BINARY_MAX_BYTES = 40 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '__pycache__']);
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const STOPWORDS = new Set(
  ('de la el que y en los las un una unos unas por para con sin del al es son como se lo su sus o u a ' +
    'mas pero si no ya le les me mi te tu qué que cómo como cuál cual cuáles cuando dónde donde explica explicame ' +
    'dime sobre entre este esta estos estas ese esa eso the of and to in is what how').split(/\s+/),
);

export interface ScannedFile {
  rel: string;
  abs: string;
  ext: string;
  size: number;
  mtimeMs: number;
}

export function scanVault(root: string): ScannedFile[] {
  const out: ScannedFile[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Ocultos (.obsidian, .git…) y archivos de bloqueo temporales de Office (~$…).
      if (e.name.startsWith('.') || e.name.startsWith('~$')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(abs);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!INDEXED_EXT.has(ext)) continue;
        const st = fs.statSync(abs);
        out.push({ rel: toRel(root, abs), abs, ext, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      }
    }
  };
  walk(root);
  return out;
}

/** Términos de búsqueda: cortos (siglas como OSI, SQL) exactos; largos por prefijo y sin plural. */
export function queryTerms(input: string): { text: string; prefix: boolean }[] {
  const terms = (input.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return [...new Set(terms)].slice(0, 16).map((t) => (t.length < 5 ? { text: t, prefix: false } : { text: t.replace(/(?<=[^s])s$/, ''), prefix: true }));
}

/** Convierte texto libre en una consulta FTS5 segura (sin operadores inyectables). */
export function buildFtsQuery(input: string): string | null {
  const terms = queryTerms(input);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.text}"${t.prefix ? '*' : ''}`).join(' OR ');
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export class VaultService {
  constructor(private db: Db, private getRoot: () => string) {}

  get root(): string {
    return this.getRoot();
  }

  /** Indexado incremental: solo procesa archivos nuevos o modificados y elimina los borrados. */
  async reindex(onProgress: (p: IndexProgress) => void = () => {}): Promise<IndexProgress> {
    const root = this.root;
    if (!root || !fs.existsSync(root)) throw new Error('La carpeta del vault no existe. Revísala en Ajustes.');
    onProgress({ phase: 'scanning', processed: 0, total: 0 });
    const files = scanVault(root);
    const known = new Map(
      this.db.all<{ id: number; rel_path: string; size: number; mtime_ms: number }>('SELECT id, rel_path, size, mtime_ms FROM vault_documents').map((r) => [r.rel_path, r]),
    );
    const changed = files.filter((f) => {
      const k = known.get(f.rel);
      return !k || k.size !== f.size || k.mtime_ms !== f.mtimeMs;
    });
    const present = new Set(files.map((f) => f.rel));
    const removed = [...known.values()].filter((k) => !present.has(k.rel_path));

    let added = 0;
    let updated = 0;
    this.db.tx(() => {
      for (const r of removed) this.deleteDocument(r.id);
    });

    for (let idx = 0; idx < changed.length; idx++) {
      const f = changed[idx];
      if (idx % 20 === 0) {
        onProgress({ phase: 'indexing', processed: idx, total: changed.length, current: f.rel });
        // Cede el hilo para que la interfaz siga respondiendo durante indexados largos.
        await new Promise((r) => setImmediate(r));
      }
      const existing = known.get(f.rel);
      // La extracción (asíncrona en PDF/DOCX) va fuera de la transacción; la escritura, dentro.
      const parsed = await this.parse(f);
      this.db.tx(() => {
        if (existing) this.deleteDocument(existing.id);
        this.insertDocument(f, parsed);
      });
      if (existing) updated++;
      else added++;
    }

    const done: IndexProgress = { phase: 'done', processed: changed.length, total: changed.length, added, updated, removed: removed.length };
    onProgress(done);
    return done;
  }

  private deleteDocument(id: number) {
    this.db.run('DELETE FROM vault_fts WHERE section_id IN (SELECT id FROM vault_sections WHERE document_id = ?)', id);
    this.db.run('DELETE FROM vault_documents WHERE id = ?', id);
  }

  private async parse(f: ScannedFile): Promise<{ parsed: ParsedDocument | null; status: 'indexed' | 'unsupported' | 'error'; error: string | null }> {
    const stem = path.basename(f.rel, path.extname(f.rel));
    const binary = f.ext === '.pdf' || f.ext === '.docx';
    if (f.size > (binary ? BINARY_MAX_BYTES : MAX_FILE_BYTES)) return { parsed: null, status: 'error', error: `Archivo demasiado grande para indexar (>${binary ? 40 : 4} MB).` };
    try {
      if (f.ext === '.pdf') {
        const parsed = await extractPdf(f.abs, stem);
        return parsed ? { parsed, status: 'indexed', error: null } : { parsed: null, status: 'unsupported', error: 'PDF sin texto extraíble (probablemente escaneado).' };
      }
      if (f.ext === '.docx') {
        const parsed = await extractDocx(f.abs, stem);
        return parsed ? { parsed, status: 'indexed', error: null } : { parsed: null, status: 'unsupported', error: 'DOCX sin texto.' };
      }
      const text = fs.readFileSync(f.abs, 'utf8');
      return { parsed: f.ext === '.txt' ? parsePlainText(text, stem) : parseMarkdown(text, stem), status: 'indexed', error: null };
    } catch (e) {
      return { parsed: null, status: 'error', error: `No se pudo extraer el texto: ${(e as Error).message}`.slice(0, 300) };
    }
  }

  private insertDocument(f: ScannedFile, r: { parsed: ParsedDocument | null; status: 'indexed' | 'unsupported' | 'error'; error: string | null }) {
    const stem = path.basename(f.rel, path.extname(f.rel));
    const { parsed, status, error } = r;

    const { lastId: docId } = this.db.run(
      'INSERT INTO vault_documents (rel_path, title, ext, size, mtime_ms, word_count, status, error) VALUES (?,?,?,?,?,?,?,?)',
      f.rel, parsed?.title ?? stem, f.ext, f.size, f.mtimeMs, parsed?.wordCount ?? 0, status, error,
    );
    if (!parsed) return;
    parsed.sections.forEach((s, ord) => {
      const { lastId } = this.db.run(
        'INSERT INTO vault_sections (document_id, ord, heading, heading_path, level, content, start_line, word_count) VALUES (?,?,?,?,?,?,?,?)',
        docId, ord, s.heading, s.headingPath, s.level, s.content, s.startLine, s.wordCount,
      );
      this.db.run('INSERT INTO vault_fts (section_id, title, heading_path, content) VALUES (?,?,?,?)', lastId, `${parsed!.title} ${stem}`, s.headingPath || s.heading, s.content);
    });
    for (const t of parsed.tags) this.db.run('INSERT OR IGNORE INTO vault_tags (document_id, tag) VALUES (?,?)', docId, t);
    for (const l of parsed.links) this.db.run('INSERT OR IGNORE INTO vault_links (document_id, target) VALUES (?,?)', docId, l.toLowerCase());
  }

  stats(): VaultStats {
    const root = this.root;
    const d = this.db.get<{ n: number; idx: number; words: number; pending: number; last: string | null }>(
      `SELECT COUNT(*) n, SUM(status='indexed') idx, COALESCE(SUM(word_count),0) words,
              SUM(status<>'indexed') pending, MAX(indexed_at) last FROM vault_documents`,
    )!;
    const sections = this.db.get<{ n: number }>('SELECT COUNT(*) n FROM vault_sections')!.n;
    const folders = new Map<string, number>();
    for (const r of this.db.all<{ rel_path: string }>("SELECT rel_path FROM vault_documents WHERE status='indexed'")) {
      const top = r.rel_path.includes('/') ? r.rel_path.split('/')[0] : '(raíz)';
      folders.set(top, (folders.get(top) ?? 0) + 1);
    }
    return {
      configured: !!root && fs.existsSync(root),
      vaultPath: root,
      documents: d.n,
      indexedDocuments: d.idx ?? 0,
      sections,
      words: d.words,
      pending: d.pending ?? 0,
      lastIndexedAt: d.last,
      topFolders: [...folders.entries()].map(([folder, documents]) => ({ folder, documents })).sort((a, b) => b.documents - a.documents).slice(0, 8),
    };
  }

  tree(): TreeNode | null {
    if (!this.root) return null;
    const rootNode: TreeNode = { name: path.basename(this.root), path: '', type: 'dir', children: [], documents: 0 };
    const rows = this.db.all<{ rel_path: string; ext: string; status: string }>('SELECT rel_path, ext, status FROM vault_documents ORDER BY rel_path');
    for (const r of rows) {
      const parts = r.rel_path.split('/');
      let node = rootNode;
      node.documents!++;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts.slice(0, i + 1).join('/');
        let next = node.children!.find((c) => c.type === 'dir' && c.path === p);
        if (!next) {
          next = { name: parts[i], path: p, type: 'dir', children: [], documents: 0 };
          node.children!.push(next);
        }
        next.documents!++;
        node = next;
      }
      node.children!.push({ name: parts[parts.length - 1], path: r.rel_path, type: 'file', ext: r.ext, indexed: r.status === 'indexed' });
    }
    const sort = (n: TreeNode) => {
      n.children?.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'es', { numeric: true }) : a.type === 'dir' ? -1 : 1));
      n.children?.forEach(sort);
    };
    sort(rootNode);
    return rootNode;
  }

  document(relPath: string): DocumentView {
    resolveInVault(this.root, relPath);
    const doc = this.db.get<{ id: number; rel_path: string; title: string; ext: string; word_count: number; status: string; error: string | null }>(
      'SELECT id, rel_path, title, ext, word_count, status, error FROM vault_documents WHERE rel_path = ?', relPath,
    );
    if (!doc) throw new Error('El documento no está en el índice. Reindexa el vault.');
    const stem = path.basename(relPath, path.extname(relPath)).toLowerCase();
    return {
      path: doc.rel_path,
      title: doc.title,
      ext: doc.ext,
      words: doc.word_count,
      status: doc.status === 'indexed' ? 'indexed' : 'unsupported',
      error: doc.error,
      tags: this.db.all<{ tag: string }>('SELECT tag FROM vault_tags WHERE document_id = ? ORDER BY tag', doc.id).map((r) => r.tag),
      links: this.db.all<{ target: string }>('SELECT target FROM vault_links WHERE document_id = ? ORDER BY target', doc.id).map((r) => r.target),
      backlinks: this.db
        .all<{ rel_path: string }>(
          'SELECT DISTINCT d.rel_path FROM vault_links l JOIN vault_documents d ON d.id = l.document_id WHERE l.target IN (?, ?) AND d.id <> ? ORDER BY d.rel_path',
          stem, relPath.replace(/\.[^.]+$/, '').toLowerCase(), doc.id,
        )
        .map((r) => r.rel_path),
      sections: this.db
        .all<{ id: number; heading: string; heading_path: string; level: number; content: string; start_line: number }>(
          'SELECT id, heading, heading_path, level, content, start_line FROM vault_sections WHERE document_id = ? ORDER BY ord', doc.id,
        )
        .map((s) => ({ id: s.id, heading: s.heading, headingPath: s.heading_path, level: s.level, content: s.content, startLine: s.start_line })),
    };
  }

  /**
   * BM25 de FTS5 y luego reordenado por cobertura: un fragmento que contiene todos los términos
   * de la pregunta (sobre todo en título o encabezado) gana a uno que repite mucho un solo término.
   */
  search(query: string, limit = 20): SearchHit[] {
    const fts = buildFtsQuery(query);
    if (!fts) return [];
    const terms = queryTerms(query).map((t) => ({ ...t, text: fold(t.text) }));
    const has = (text: string, t: { text: string; prefix: boolean }) =>
      t.prefix ? text.includes(t.text) : new RegExp(`(^|[^\p{L}\p{N}])${t.text}($|[^\p{L}\p{N}])`, 'u').test(text);
    const rows = this.db.all<{ section_id: number; rel_path: string; title: string; heading_path: string; heading: string; snip: string; score: number; content: string }>(
      `SELECT f.section_id, d.rel_path, d.title, s.heading_path, s.heading, s.content,
              snippet(vault_fts, 3, '«', '»', '…', 18) AS snip,
              bm25(vault_fts, 0.0, 6.0, 3.0, 1.0) AS score
         FROM vault_fts f
         JOIN vault_sections s ON s.id = f.section_id
         JOIN vault_documents d ON d.id = s.document_id
        WHERE vault_fts MATCH ?
        ORDER BY score
        LIMIT ?`,
      fts, Math.min(300, Math.max(60, limit * 8)),
    );
    return rows
      .map((r) => {
        const head = fold(`${r.rel_path} ${r.title} ${r.heading_path || r.heading}`);
        const body = fold(r.content);
        const inHead = terms.filter((t) => has(head, t)).length;
        const covered = terms.filter((t) => has(head, t) || has(body, t)).length;
        const coverage = terms.length ? covered / terms.length : 0;
        const score = -r.score * (0.35 + 0.65 * coverage) + 3 * inHead;
        return { sectionId: r.section_id, path: r.rel_path, title: r.title, headingPath: r.heading_path || r.heading, snippet: r.snip, score };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, limit);
  }

  /** Fragmentos completos para dar contexto a Claude, sin repetir demasiado el mismo documento. */
  retrieve(query: string, maxSections = 8, maxPerDocument = 3, scope: string[] = []) {
    const inScope = (p: string) => !scope.length || scope.some((s) => p === s || p.startsWith(`${s.replace(/\/$/, '')}/`));
    let hits = this.search(query, scope.length ? 120 : 40).filter((h) => inScope(h.path));
    // Ámbito elegido pero sin coincidencias suficientes: se completa con el inicio de los documentos del ámbito.
    if (scope.length && hits.length < maxSections) {
      const seen = new Set(hits.map((h) => h.sectionId));
      const extra = this.db
        .all<{ id: number; rel_path: string; title: string; heading_path: string; heading: string }>(
          "SELECT s.id, d.rel_path, d.title, s.heading_path, s.heading FROM vault_sections s JOIN vault_documents d ON d.id = s.document_id WHERE d.status = 'indexed' ORDER BY d.rel_path, s.ord",
        )
        .filter((r) => inScope(r.rel_path) && !seen.has(r.id))
        .map((r) => ({ sectionId: r.id, path: r.rel_path, title: r.title, headingPath: r.heading_path || r.heading, snippet: '', score: 0 }));
      hits = [...hits, ...extra];
    }
    const perDoc = new Map<string, number>();
    const chosen: SearchHit[] = [];
    for (const h of hits) {
      const n = perDoc.get(h.path) ?? 0;
      if (n >= maxPerDocument) continue;
      perDoc.set(h.path, n + 1);
      chosen.push(h);
      if (chosen.length >= maxSections) break;
    }
    return chosen.map((h, i) => {
      const s = this.db.get<{ content: string; heading: string }>('SELECT content, heading FROM vault_sections WHERE id = ?', h.sectionId)!;
      return { ref: `S${i + 1}`, sectionId: h.sectionId, path: h.path, heading: h.headingPath || s.heading, content: s.content };
    });
  }

  section(id: number) {
    return this.db.get<{ id: number; content: string; heading: string; heading_path: string; rel_path: string; document_id: number }>(
      'SELECT s.id, s.content, s.heading, s.heading_path, d.rel_path, s.document_id FROM vault_sections s JOIN vault_documents d ON d.id = s.document_id WHERE s.id = ?', id,
    );
  }

  /** Secciones de un documento por ruta relativa (para verificar citas a documentos que Claude leyó por su cuenta). */
  sectionsOf(relPath: string) {
    return this.db.all<{ id: number; content: string; heading: string; heading_path: string }>(
      'SELECT s.id, s.content, s.heading, s.heading_path FROM vault_sections s JOIN vault_documents d ON d.id = s.document_id WHERE d.rel_path = ?', relPath,
    );
  }
}
