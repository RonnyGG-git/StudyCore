import { ChevronRight, FileText, FileWarning, Folder, FolderOpen, Hash, Link2, MessagesSquare, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentView, SearchHit, TreeNode } from '../../shared/types';
import { Button, EmptyState, ErrorBanner, Skeleton } from '../components/ui';
import { describeProgress, useIndexer } from '../hooks/useIndexer';
import { api } from '../lib/api';
import { num } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { useNav } from '../lib/nav';

export function LibraryPage({ initialDoc, initialQuery }: { initialDoc?: string; initialQuery?: string }) {
  const [tree, setTree] = useState<TreeNode | null | undefined>(undefined);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [docPath, setDocPath] = useState<string | null>(initialDoc ?? null);
  const [focusSection, setFocusSection] = useState<number | null>(null);
  const loadTree = useCallback(() => void api.vaultTree().then(setTree), []);
  const indexer = useIndexer(loadTree);

  useEffect(loadTree, [loadTree]);
  useEffect(() => {
    const q = query.trim();
    if (!q) return setHits(null);
    const t = setTimeout(() => void api.search(q, 30).then(setHits), 160);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="h-full flex">
      <aside className="w-[320px] shrink-0 border-r border-line flex flex-col">
        <div className="p-3 space-y-2">
          <div className="flex items-center gap-2 h-9 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent/60 transition-colors">
            <Search className="size-4 text-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en el vault…" className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:text-faint" />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Limpiar búsqueda" className="text-faint hover:text-fg"><X className="size-3.5" /></button>
            )}
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-faint px-1">
            <span className="truncate">{indexer.running || indexer.progress?.phase === 'done' ? describeProgress(indexer.progress) : tree ? `${num(tree.documents ?? 0)} documentos` : ''}</span>
            <button onClick={() => void indexer.run()} disabled={indexer.running} className="inline-flex items-center gap-1 hover:text-accent disabled:opacity-50">
              <RefreshCw className={`size-3 ${indexer.running ? 'animate-spin' : ''}`} /> Reindexar
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {hits ? (
            hits.length ? (
              <ul className="space-y-0.5">
                {hits.map((h) => (
                  <li key={h.sectionId}>
                    <button
                      onClick={() => {
                        setDocPath(h.path);
                        setFocusSection(h.sectionId);
                      }}
                      className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${docPath === h.path ? 'bg-raised' : 'hover:bg-raised/60'}`}
                    >
                      <div className="text-[13px] font-medium truncate">{h.title}</div>
                      <div className="text-[11.5px] text-accent truncate">{h.headingPath}</div>
                      <div className="text-[12px] text-muted line-clamp-2 mt-0.5"><Snippet text={h.snippet} /></div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-faint text-[12.5px] px-3 py-2">Sin resultados para «{query}».</p>
            )
          ) : tree === undefined ? (
            <div className="space-y-2 px-2">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : tree && tree.children?.length ? (
            <TreeView node={tree} selected={docPath} onSelect={(p) => { setDocPath(p); setFocusSection(null); }} />
          ) : (
            <p className="text-faint text-[12.5px] px-3 py-2">El índice está vacío. Pulsa «Reindexar».</p>
          )}
        </div>
      </aside>

      <section className="flex-1 min-w-0 overflow-y-auto">
        {indexer.error && <div className="p-6 pb-0"><ErrorBanner>{indexer.error}</ErrorBanner></div>}
        {docPath ? (
          <DocumentPane key={docPath} path={docPath} focusSection={focusSection} />
        ) : (
          <EmptyState icon={FolderOpen} title="Explora tu conocimiento">
            Elige un documento del árbol o busca un concepto. Cada resultado indica el documento y el apartado exactos.
          </EmptyState>
        )}
      </section>
    </div>
  );
}

function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('«') ? <mark key={i} className="bg-accent/20 text-fg rounded px-0.5">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}
    </>
  );
}

function TreeView({ node, selected, onSelect, depth = 0 }: { node: TreeNode; selected: string | null; onSelect: (p: string) => void; depth?: number }) {
  return (
    <ul>
      {node.children!.map((c) => (c.type === 'dir' ? <DirNode key={c.path} node={c} selected={selected} onSelect={onSelect} depth={depth} /> : (
        <li key={c.path}>
          <button
            onClick={() => onSelect(c.path)}
            style={{ paddingLeft: 10 + depth * 14 + 18 }}
            className={`w-full flex items-center gap-2 h-7 pr-2 rounded-md text-left text-[13px] transition-colors ${selected === c.path ? 'bg-accent-soft text-accent' : 'hover:bg-raised/60'} ${c.indexed ? '' : 'text-faint'}`}
          >
            {c.indexed ? <FileText className="size-3.5 shrink-0 opacity-60" /> : <FileWarning className="size-3.5 shrink-0" />}
            <span className="truncate">{c.name.replace(/\.(md|markdown)$/i, '')}</span>
          </button>
        </li>
      )))}
    </ul>
  );
}

function DirNode({ node, selected, onSelect, depth }: { node: TreeNode; selected: string | null; onSelect: (p: string) => void; depth: number }) {
  const [open, setOpen] = useState(!!selected && selected.startsWith(`${node.path}/`));
  return (
    <li>
      <button onClick={() => setOpen(!open)} style={{ paddingLeft: 10 + depth * 14 }} className="w-full flex items-center gap-1.5 h-7 pr-2 rounded-md text-left text-[13px] hover:bg-raised/60 transition-colors">
        <ChevronRight className={`size-3.5 shrink-0 text-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
        <Folder className="size-3.5 shrink-0 text-accent/80" />
        <span className="truncate font-medium">{node.name}</span>
        <span className="ml-auto text-faint text-[11px] tabular-nums">{node.documents}</span>
      </button>
      {open && <TreeView node={node} selected={selected} onSelect={onSelect} depth={depth + 1} />}
    </li>
  );
}

function DocumentPane({ path, focusSection }: { path: string; focusSection: number | null }) {
  const { go } = useNav();
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.openDocument(path).then((r) => (r.ok ? setDoc(r.value) : setError(r.error)));
  }, [path]);
  useEffect(() => {
    if (doc && focusSection) document.getElementById(`sec-${focusSection}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [doc, focusSection]);

  const outline = useMemo(() => doc?.sections.filter((s, i, all) => s.level > 0 && all.findIndex((x) => x.headingPath === s.headingPath) === i) ?? [], [doc]);

  if (error) return <div className="p-8"><ErrorBanner>{error}</ErrorBanner></div>;
  if (!doc) return <div className="p-10 max-w-[760px] mx-auto space-y-3"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-4" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-4/6" /></div>;

  return (
    <div ref={container} className="flex gap-8 px-10 py-9 animate-rise">
      <article className="flex-1 min-w-0 max-w-[760px]">
        <div className="text-faint text-[12px] mb-1.5 truncate">{doc.path}</div>
        <h1 className="font-display text-[28px] font-semibold tracking-tight leading-tight">{doc.title}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[12px] text-muted">{num(doc.words)} palabras</span>
          {doc.tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-0.5 text-[11.5px] px-2 h-5 rounded-full bg-raised text-muted"><Hash className="size-3" />{t}</span>
          ))}
          <Button size="sm" variant="secondary" icon={MessagesSquare} className="ml-auto" disabled={doc.status !== 'indexed'} onClick={() => go({ page: 'ask', conversationId: null, draft: `Explícame las ideas principales del documento «${doc.path}», de lo básico a lo avanzado.` })}>
            Preguntar sobre este documento
          </Button>
        </div>

        {doc.status !== 'indexed' ? (
          <div className="mt-8"><ErrorBanner>{doc.error ?? 'No se pudo extraer el texto de este archivo.'}</ErrorBanner></div>
        ) : (
          <div className="mt-6 space-y-1">
            {doc.sections.map((s, i) => {
              const showHeading = s.level > 0 && (i === 0 || doc.sections[i - 1].headingPath !== s.headingPath);
              return (
                <div key={s.id} id={`sec-${s.id}`} className={`scroll-mt-6 rounded-xl transition-colors ${focusSection === s.id ? 'bg-accent-soft/40 -mx-4 px-4 py-2' : ''}`}>
                  {showHeading && <HeadingTag level={s.level}>{s.heading.replace(/ \(parte \d+\)$/, '')}</HeadingTag>}
                  <Markdown text={s.content} />
                </div>
              );
            })}
          </div>
        )}
      </article>

      <aside className="hidden xl:block w-[220px] shrink-0">
        <div className="sticky top-0 space-y-6 text-[12.5px]">
          {outline.length > 1 && (
            <div>
              <div className="font-semibold text-muted mb-2">En este documento</div>
              <ul className="space-y-1 border-l border-line">
                {outline.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth' })} style={{ paddingLeft: 10 + Math.max(0, s.level - 2) * 10 }} className="text-left text-muted hover:text-accent leading-snug">
                      {s.heading.replace(/ \(parte \d+\)$/, '')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <LinkList title="Enlaza a" items={doc.links} />
          <LinkList title="Mencionado en" items={doc.backlinks} onOpen={(p) => go({ page: 'library', doc: p })} />
        </div>
      </aside>
    </div>
  );
}

function HeadingTag({ level, children }: { level: number; children: string }) {
  const cls = level <= 1 ? 'hidden' : level === 2 ? 'text-[19px] mt-8' : 'text-[16px] mt-6';
  return <h2 className={`font-display font-semibold tracking-tight mb-1 ${cls}`}>{children}</h2>;
}

function LinkList({ title, items, onOpen }: { title: string; items: string[]; onOpen?: (p: string) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="font-semibold text-muted mb-2 flex items-center gap-1.5"><Link2 className="size-3.5" />{title}</div>
      <ul className="space-y-1">
        {items.slice(0, 20).map((l) => (
          <li key={l} className="truncate">
            {onOpen ? <button onClick={() => onOpen(l)} className="text-accent hover:underline truncate max-w-full text-left">{l.replace(/\.md$/i, '').split('/').pop()}</button> : <span className="text-muted">{l}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
