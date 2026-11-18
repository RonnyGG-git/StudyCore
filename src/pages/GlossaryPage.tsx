import { BookOpenCheck, Search, Sparkles, Star, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ConceptStatus, ConceptSummary, ConceptView, TopicSummary } from '../../shared/learning';
import { SourceCard } from '../components/Chat';
import { ProgressBar } from '../components/charts';
import { TaskError, TaskProgress } from '../components/TaskProgress';
import { Button, EmptyState, Skeleton } from '../components/ui';
import { useTask } from '../hooks/useTask';
import { Markdown } from '../lib/markdown';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

export const CONCEPT_STATUS: Record<ConceptStatus, { label: string; cls: string }> = {
  not_studied: { label: 'No estudiado', cls: 'bg-raised text-muted' },
  learning: { label: 'En aprendizaje', cls: 'bg-warn/15 text-warn' },
  understood: { label: 'Comprendido', cls: 'bg-accent-soft text-accent' },
  mastered: { label: 'Dominado', cls: 'bg-ok/15 text-ok' },
};

export function GlossaryPage({ conceptId, topicId }: { conceptId?: number; topicId?: number | null }) {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topic, setTopic] = useState<number | null>(topicId ?? null);
  const [status, setStatus] = useState<ConceptStatus | ''>('');
  const [favorites, setFavorites] = useState(false);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ConceptSummary[] | null>(null);
  const [selected, setSelected] = useState<number | null>(conceptId ?? null);
  const gen = useTask();

  const load = useCallback(() => void rpc.conceptsList({ topicId: topic, status: status || null, favorites, query }).then(setList), [topic, status, favorites, query]);
  useEffect(() => void rpc.topicsList().then(setTopics), []);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const generate = async () => {
    if (!topic) return;
    const r = await gen.run((rid) => rpc.glossaryGenerate(topic, rid));
    if (r) load();
  };

  return (
    <div className="h-full flex">
      <aside className="w-[330px] shrink-0 border-r border-line flex flex-col">
        <div className="p-3 space-y-2 border-b border-line">
          <div className="flex items-center gap-2 h-9 rounded-lg border border-line bg-surface px-2.5 focus-within:border-accent/60">
            <Search className="size-4 text-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar concepto…" className="flex-1 bg-transparent outline-none text-[13.5px]" />
          </div>
          <div className="flex gap-1.5">
            <select value={topic ?? ''} onChange={(e) => setTopic(e.target.value ? Number(e.target.value) : null)} className="flex-1 min-w-0 h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px]">
              <option value="">Todos los temas</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as ConceptStatus | '')} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px]">
              <option value="">Estado</option>
              {Object.entries(CONCEPT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button onClick={() => setFavorites(!favorites)} className={`size-8 grid place-items-center rounded-lg border ${favorites ? 'border-warn/50 text-warn bg-warn/10' : 'border-line text-faint'}`} aria-pressed={favorites} title="Solo favoritos"><Star className="size-3.5" /></button>
          </div>
          {topic && <Button size="sm" icon={Sparkles} className="w-full" disabled={gen.running} onClick={() => void generate()}>Generar glosario desde el vault</Button>}
          <TaskProgress task={gen} title="Construyendo el glosario" onCancel={gen.cancel} />
          <TaskError task={gen} onRetry={() => void generate()} onDismiss={gen.clearError} />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {!list ? (
            <div className="space-y-2 p-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : list.length ? (
            list.map((c) => (
              <button key={c.id} onClick={() => setSelected(c.id)} className={`w-full text-left rounded-lg px-3 py-2 mb-0.5 transition-colors ${c.id === selected ? 'bg-raised' : 'hover:bg-raised/60'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-medium truncate">{c.name}</span>
                  {c.favorite && <Star className="size-3 text-warn fill-current shrink-0" />}
                  <span className={`ml-auto text-[10.5px] px-1.5 py-0.5 rounded-full shrink-0 ${CONCEPT_STATUS[c.status].cls}`}>{CONCEPT_STATUS[c.status].label}</span>
                </div>
                <div className="text-[12px] text-faint truncate">{c.shortDefinition || c.topicTitle}</div>
              </button>
            ))
          ) : (
            <p className="text-faint text-[12.5px] px-3 py-2">Sin conceptos con estos filtros. Los conceptos aparecen al crear la ruta de un tema o al generar su glosario.</p>
          )}
        </div>
      </aside>
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selected ? <ConceptDetail key={selected} id={selected} onChanged={load} onOpen={setSelected} /> : <EmptyState icon={BookOpenCheck} title="Glosario de tus temas">Elige un concepto para ver su definición, ejemplos, relaciones y los documentos de tu vault que lo respaldan.</EmptyState>}
      </div>
    </div>
  );
}

function ConceptDetail({ id, onChanged, onOpen }: { id: number; onChanged: () => void; onOpen: (id: number) => void }) {
  const { go } = useNav();
  const [c, setC] = useState<ConceptView | null>(null);
  const expand = useTask();
  useEffect(() => void rpc.conceptGet(id).then(setC), [id]);
  if (!c) return <div className="p-10 max-w-[760px] mx-auto"><Skeleton className="h-40" /></div>;

  const doExpand = async () => {
    const r = await expand.run((rid) => rpc.conceptExpand(id, rid));
    if (r) setC(r);
  };
  const incomplete = !c.explanation && !c.example && !c.application;

  return (
    <div className="max-w-[780px] mx-auto px-8 py-8 animate-rise">
      <div className="flex items-center gap-2 text-[12px]">
        <button className="text-muted hover:text-accent" onClick={() => go({ page: 'topic', id: c.topicId })}>{c.topicTitle}</button>
      </div>
      <div className="flex items-start gap-3 mt-1">
        <h1 className="font-display text-[28px] font-semibold tracking-tight leading-tight flex-1">{c.name}</h1>
        <button onClick={async () => { const f = await rpc.conceptToggleFavorite(c.id); setC({ ...c, favorite: f }); onChanged(); }} className={`mt-2 ${c.favorite ? 'text-warn' : 'text-faint hover:text-warn'}`} aria-pressed={c.favorite} title="Favorito">
          <Star className={`size-5 ${c.favorite ? 'fill-current' : ''}`} />
        </button>
      </div>
      {c.shortDefinition && <p className="text-[16px] text-muted mt-2">{c.shortDefinition}</p>}

      <div className="mt-5 rounded-2xl border border-line bg-surface p-4 flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[180px]">
          <div className="flex justify-between text-[12px] mb-1"><span className="text-muted">Dominio medido</span><span className="tabular-nums">{c.attempts ? `${Math.round(c.mastery * 100)}% · ${c.correct}/${c.attempts} aciertos` : 'sin evaluar'}</span></div>
          <ProgressBar value={c.mastery} tone={c.status === 'mastered' ? 'ok' : 'accent'} />
        </div>
        <div className="inline-flex rounded-lg bg-raised p-0.5" role="radiogroup" aria-label="Estado">
          {(Object.keys(CONCEPT_STATUS) as ConceptStatus[]).map((s) => (
            <button key={s} role="radio" aria-checked={c.status === s} onClick={async () => { await rpc.conceptSetStatus(c.id, s); setC({ ...c, status: s }); onChanged(); }} className={`h-7 px-2 rounded-md text-[11.5px] ${c.status === s ? 'bg-surface shadow-sm font-medium' : 'text-muted'}`}>
              {CONCEPT_STATUS[s].label}
            </button>
          ))}
        </div>
        <Button size="sm" icon={Zap} onClick={() => go({ page: 'assessment', create: { topicId: c.topicId, kind: 'reinforcement', mode: 'practice', conceptIds: [c.id] } })}>Practicar</Button>
      </div>

      {incomplete && !expand.running && (
        <div className="mt-5 rounded-2xl border border-dashed border-line p-5 text-center">
          <p className="text-muted text-[13.5px]">Esta ficha solo tiene la definición corta.</p>
          <Button className="mt-3" icon={Sparkles} onClick={() => void doExpand()}>Completar con Claude</Button>
        </div>
      )}
      <div className="mt-4 space-y-3">
        <TaskProgress task={expand} title={`Completando «${c.name}»`} onCancel={expand.cancel} />
        <TaskError task={expand} onRetry={() => void doExpand()} onDismiss={expand.clearError} />
      </div>

      {[['Explicación', c.explanation], ['Ejemplo', c.example], ['Aplicación', c.application]].map(([t, v]) =>
        v ? (
          <section key={t} className="mt-6">
            <h2 className="font-display font-semibold text-[15px] mb-1.5">{t}</h2>
            <Markdown text={v} />
          </section>
        ) : null,
      )}

      {(c.prerequisites.length > 0 || c.related.length > 0) && (
        <section className="mt-6 grid md:grid-cols-2 gap-3">
          {c.prerequisites.length > 0 && (
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <div className="text-[12px] font-semibold text-muted mb-2">Necesitas antes</div>
              <div className="flex flex-wrap gap-1.5">
                {c.prerequisites.map((p) => (
                  <button key={p.id} onClick={() => onOpen(p.id)} className={`text-[12.5px] px-2 py-1 rounded-lg ${CONCEPT_STATUS[p.status].cls}`}>{p.name}</button>
                ))}
              </div>
            </div>
          )}
          {c.related.length > 0 && (
            <div className="rounded-xl border border-line bg-surface px-4 py-3">
              <div className="text-[12px] font-semibold text-muted mb-2">Relacionado con</div>
              <div className="flex flex-wrap gap-1.5">{c.related.map((p) => <button key={p.id} onClick={() => onOpen(p.id)} className="text-[12.5px] px-2 py-1 rounded-lg bg-raised hover:text-accent">{p.name}</button>)}</div>
            </div>
          )}
        </section>
      )}
      {c.lessons.length > 0 && (
        <section className="mt-5">
          <div className="text-[12px] font-semibold text-muted mb-1.5">Se estudia en</div>
          <div className="flex flex-wrap gap-1.5">{c.lessons.map((l) => <button key={l.id} onClick={() => go({ page: 'lesson', id: l.id })} className="text-[12.5px] px-2 py-1 rounded-lg border border-line hover:border-accent/50">{l.title}</button>)}</div>
        </section>
      )}
      {c.sources.length > 0 && (
        <section className="mt-6">
          <div className="text-[12px] font-semibold text-muted mb-2">Documento de origen</div>
          <div className="grid grid-cols-1 gap-2">{c.sources.map((s, i) => <SourceCard key={i} s={s} />)}</div>
        </section>
      )}
    </div>
  );
}
