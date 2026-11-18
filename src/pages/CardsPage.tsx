import { BookMarked, Brain, Layers, Pencil, Plus, RotateCw, Sparkles, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { CardRating, Flashcard, ReviewOverview, TopicSummary } from '../../shared/learning';
import { Bars } from '../components/charts';
import { TaskError, TaskProgress } from '../components/TaskProgress';
import { Button, Card, EmptyState, ErrorBanner, Kbd, PageHeader } from '../components/ui';
import { useStudyTimer } from '../hooks/useStudyTimer';
import { useTask } from '../hooks/useTask';
import { relativeTime } from '../lib/format';
import { Markdown } from '../lib/markdown';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

const RATINGS: { r: CardRating; label: string; hint: string; cls: string }[] = [
  { r: 1, label: 'Otra vez', hint: '10 min', cls: 'text-bad' },
  { r: 2, label: 'Difícil', hint: 'poco', cls: 'text-warn' },
  { r: 3, label: 'Bien', hint: 'normal', cls: 'text-accent' },
  { r: 4, label: 'Fácil', hint: 'más tarde', cls: 'text-ok' },
];

export function CardsPage({ topicId }: { topicId?: number | null }) {
  const [tab, setTab] = useState<'review' | 'manage'>('review');
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [filter, setFilter] = useState<number | null>(topicId ?? null);
  const [overview, setOverview] = useState<ReviewOverview | null>(null);
  const refresh = useCallback(() => void rpc.cardsOverview().then(setOverview), []);
  useEffect(() => {
    void rpc.topicsList().then(setTopics);
    refresh();
  }, [refresh]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[920px] mx-auto px-8 py-9">
        <PageHeader
          title="Repasar"
          subtitle="Tarjetas con repetición espaciada: cada una vuelve justo antes de que la olvides."
          actions={
            <div className="inline-flex rounded-lg bg-raised p-0.5">
              {(['review', 'manage'] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={`h-8 px-3 rounded-md text-[13px] ${tab === t ? 'bg-surface shadow-sm font-medium' : 'text-muted'}`}>{t === 'review' ? 'Repaso' : 'Mis tarjetas'}</button>
              ))}
            </div>
          }
        />
        <div className="flex items-center gap-2 mb-5">
          <span className="text-[12.5px] text-muted">Tema:</span>
          <select value={filter ?? ''} onChange={(e) => setFilter(e.target.value ? Number(e.target.value) : null)} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
            <option value="">Todos</option>
            {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
        {tab === 'review' ? <Review topicId={filter} overview={overview} onChange={refresh} onManage={() => setTab('manage')} /> : <Manage topicId={filter} topics={topics} onChange={refresh} />}
      </div>
    </div>
  );
}

function Review({ topicId, overview, onChange, onManage }: { topicId: number | null; overview: ReviewOverview | null; onChange: () => void; onManage: () => void }) {
  const { go } = useNav();
  const [queue, setQueue] = useState<Flashcard[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);
  useStudyTimer(queue?.length ? 'cards' : null);
  useEffect(() => {
    setDone(0);
    void rpc.cardsDue(topicId, 100).then(setQueue);
  }, [topicId]);

  const card = queue?.[0];
  const rate = async (r: CardRating) => {
    if (!card) return;
    await rpc.cardReview(card.id, r);
    setFlipped(false);
    setDone((n) => n + 1);
    // «Otra vez» la vuelve a poner al final de la sesión de hoy.
    setQueue((q) => (q ? (r === 1 ? [...q.slice(1), card] : q.slice(1)) : q));
    onChange();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) void rate(Number(e.key) as CardRating);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="grid lg:grid-cols-[1fr_260px] gap-6">
      <div>
        {!queue ? null : card ? (
          <>
            <div className="text-[12px] text-faint mb-2">{queue.length} pendiente{queue.length > 1 ? 's' : ''} · {done} repasada{done !== 1 ? 's' : ''} hoy en esta sesión</div>
            <button
              onClick={() => setFlipped(!flipped)}
              className="w-full text-left rounded-2xl border border-line bg-surface p-8 min-h-[280px] flex flex-col transition-shadow hover:shadow-[0_12px_32px_-18px_rgb(0_0_0/0.35)]"
              aria-label={flipped ? 'Ver la pregunta' : 'Ver la respuesta'}
            >
              <div className="flex items-center gap-2 text-[11.5px] text-faint">
                {card.topicTitle && <span>{card.topicTitle}</span>}
                {card.category && <span className="px-1.5 py-0.5 rounded bg-raised">{card.category}</span>}
                <span className="ml-auto">{card.origin === 'claude' ? 'Creada por Claude' : 'Manual'}</span>
              </div>
              <div key={`${card.id}-${flipped}`} className="flex-1 grid place-items-center text-center animate-rise">
                {!flipped ? (
                  <p className="font-display text-[21px] font-medium leading-snug">{card.front}</p>
                ) : (
                  <div>
                    <p className="text-[12px] text-muted mb-1.5">{card.front}</p>
                    <p className="font-display text-[20px] font-semibold text-accent leading-snug">{card.back}</p>
                    {card.explanation && <Markdown text={card.explanation} className="!text-[13.5px] text-muted mt-3 max-w-lg mx-auto" />}
                    {card.sourcePath && <p className="text-[11.5px] text-faint mt-3 flex items-center gap-1 justify-center"><BookMarked className="size-3" />{card.sourcePath}{card.sourceHeading ? ` › ${card.sourceHeading}` : ''}</p>}
                  </div>
                )}
              </div>
              {!flipped && <p className="text-center text-faint text-[12px]">Recuérdalo antes de girar · <Kbd>Espacio</Kbd></p>}
            </button>
            {flipped && (
              <div className="grid grid-cols-4 gap-2 mt-3 animate-rise">
                {RATINGS.map((x) => (
                  <button key={x.r} onClick={() => void rate(x.r)} className="rounded-xl border border-line bg-surface py-2.5 hover:border-accent/50 transition-colors">
                    <div className={`font-semibold text-[13.5px] ${x.cls}`}>{x.label}</div>
                    <div className="text-[11px] text-faint">{x.hint} · <Kbd>{x.r}</Kbd></div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <Card>
            <EmptyState icon={Brain} title={done ? '¡Repaso terminado!' : 'Nada que repasar ahora'} action={<Button icon={Layers} onClick={onManage}>Crear o generar tarjetas</Button>}>
              {done ? `Has repasado ${done} tarjeta${done > 1 ? 's' : ''}. Volverán cuando toque.` : 'Las tarjetas aparecerán aquí cuando les toque repaso.'}
            </EmptyState>
          </Card>
        )}
      </div>
      <aside className="space-y-4">
        {overview && (
          <>
            <Card title="Próximos 7 días">
              <div className="px-5 pb-4 pt-2"><Bars label="Tarjetas por día" data={overview.upcoming.map((u, i) => ({ label: i === 0 ? 'Hoy' : new Date(`${u.day}T12:00`).toLocaleDateString('es', { weekday: 'narrow' }), hint: u.day, value: u.count + (i === 0 ? overview.due : 0) }))} height={70} /></div>
            </Card>
            <Card title="Lo que se te olvida">
              <div className="px-5 pb-4 pt-1">
                {overview.forgetting.length ? (
                  <ul className="space-y-1.5">
                    {overview.forgetting.map((f) => (
                      <li key={`${f.conceptId}-${f.name}`} className="flex items-center gap-2 text-[13px]">
                        {f.conceptId ? <button className="truncate text-left hover:text-accent" onClick={() => go({ page: 'glossary', conceptId: f.conceptId! })}>{f.name}</button> : <span className="truncate">{f.name}</span>}
                        <span className="ml-auto text-bad text-[12px] shrink-0">{f.lapses}×</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-faint text-[12.5px]">Sin olvidos en los últimos 30 días.</p>}
              </div>
            </Card>
            <p className="text-faint text-[12px] px-1">{overview.total} tarjetas · {overview.learning} en aprendizaje</p>
          </>
        )}
      </aside>
    </div>
  );
}

function Manage({ topicId, topics, onChange }: { topicId: number | null; topics: TopicSummary[]; onChange: () => void }) {
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [editing, setEditing] = useState<Partial<Flashcard> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [genTopic, setGenTopic] = useState<number | null>(topicId);
  const [count, setCount] = useState(10);
  const gen = useTask();
  const load = useCallback(() => void rpc.cardsList(topicId).then(setCards), [topicId]);
  useEffect(load, [load]);
  useEffect(() => setGenTopic(topicId ?? topics.find((t) => t.status !== 'diagnosing')?.id ?? null), [topicId, topics]);

  const save = async () => {
    if (!editing) return;
    setError(null);
    const input = { topicId: editing.topicId ?? null, front: editing.front ?? '', back: editing.back ?? '', explanation: editing.explanation ?? '', category: editing.category ?? '', difficulty: editing.difficulty ?? 2 };
    const r = editing.id ? await rpc.cardUpdate(editing.id, input) : await rpc.cardCreate(input);
    if (!r.ok) return setError(r.error);
    setEditing(null);
    load();
    onChange();
  };
  const generate = async () => {
    if (!genTopic) return;
    const r = await gen.run((rid) => rpc.cardsGenerate({ topicId: genTopic, count }, rid));
    if (r) {
      load();
      onChange();
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <div className="p-5 flex flex-wrap items-center gap-3">
          <Sparkles className="size-4 text-accent" />
          <span className="text-[13.5px] font-medium">Generar con Claude</span>
          <select value={genTopic ?? ''} onChange={(e) => setGenTopic(Number(e.target.value) || null)} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
            <option value="">Elige tema…</option>
            {topics.filter((t) => t.status !== 'diagnosing').map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
            {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} tarjetas</option>)}
          </select>
          <Button size="sm" variant="primary" disabled={!genTopic || gen.running} onClick={() => void generate()}>Generar</Button>
          <Button size="sm" icon={Plus} className="ml-auto" onClick={() => setEditing({ topicId, difficulty: 2 })}>Nueva tarjeta</Button>
        </div>
        <div className="px-5 pb-4 space-y-3 empty:hidden">
          <TaskProgress task={gen} title="Creando tarjetas" onCancel={gen.cancel} />
          <TaskError task={gen} onRetry={() => void generate()} onDismiss={gen.clearError} />
        </div>
      </Card>

      {editing && (
        <Card className="animate-rise">
          <div className="p-5 space-y-3">
            <div className="flex items-center"><span className="font-medium">{editing.id ? 'Editar tarjeta' : 'Nueva tarjeta'}</span><button className="ml-auto text-faint hover:text-fg" onClick={() => setEditing(null)} aria-label="Cerrar"><X className="size-4" /></button></div>
            <div className="grid md:grid-cols-2 gap-3">
              <textarea value={editing.front ?? ''} onChange={(e) => setEditing({ ...editing, front: e.target.value })} placeholder="Frente: la pregunta" rows={3} className="rounded-lg border border-line bg-bg/40 px-3 py-2 outline-none focus:border-accent/60 resize-none" />
              <textarea value={editing.back ?? ''} onChange={(e) => setEditing({ ...editing, back: e.target.value })} placeholder="Reverso: la respuesta" rows={3} className="rounded-lg border border-line bg-bg/40 px-3 py-2 outline-none focus:border-accent/60 resize-none" />
            </div>
            <textarea value={editing.explanation ?? ''} onChange={(e) => setEditing({ ...editing, explanation: e.target.value })} placeholder="Explicación adicional (opcional)" rows={2} className="w-full rounded-lg border border-line bg-bg/40 px-3 py-2 outline-none focus:border-accent/60 resize-none" />
            <div className="flex flex-wrap items-center gap-2">
              <select value={editing.topicId ?? ''} onChange={(e) => setEditing({ ...editing, topicId: e.target.value ? Number(e.target.value) : null })} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
                <option value="">Sin tema</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
              <input value={editing.category ?? ''} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="Categoría" className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] w-40" />
              <select value={editing.difficulty ?? 2} onChange={(e) => setEditing({ ...editing, difficulty: Number(e.target.value) })} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
                <option value={1}>Fácil</option><option value={2}>Media</option><option value={3}>Difícil</option>
              </select>
              <Button size="sm" variant="primary" className="ml-auto" onClick={() => void save()}>Guardar</Button>
            </div>
            {error && <ErrorBanner>{error}</ErrorBanner>}
          </div>
        </Card>
      )}

      {cards.length === 0 ? (
        <Card><EmptyState icon={Layers} title="Sin tarjetas">Crea tarjetas a mano o pide a Claude que las genere desde tus documentos.</EmptyState></Card>
      ) : (
        <div className="rounded-2xl border border-line bg-surface divide-y divide-line">
          {cards.map((c) => (
            <div key={c.id} className="flex items-center gap-4 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium truncate">{c.front}</div>
                <div className="text-[12.5px] text-muted truncate">{c.back}</div>
              </div>
              <div className="text-right text-[11.5px] text-faint shrink-0 w-32">
                <div className="flex items-center gap-1 justify-end"><RotateCw className="size-3" /> {new Date(c.dueAt) <= new Date() ? 'para hoy' : relativeTime(c.dueAt)}</div>
                <div>{c.reps} repasos · {c.lapses} olvidos</div>
              </div>
              <button className="text-faint hover:text-fg" onClick={() => setEditing(c)} aria-label="Editar"><Pencil className="size-3.5" /></button>
              <button className="text-faint hover:text-bad" onClick={async () => { await rpc.cardDelete(c.id); load(); onChange(); }} aria-label="Eliminar"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
