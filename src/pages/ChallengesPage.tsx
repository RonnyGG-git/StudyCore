import { CheckCircle2, Circle, Eye, Flag, Lightbulb, Plus, Send, Sparkles, Swords, Trophy, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChallengeSummary, ChallengeView, TopicSummary } from '../../shared/learning';
import { TaskError, TaskProgress } from '../components/TaskProgress';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { useStudyTimer } from '../hooks/useStudyTimer';
import { useTask } from '../hooks/useTask';
import { Markdown } from '../lib/markdown';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

export function ChallengesPage({ id, create }: { id?: number; create?: { topicId: number; moduleId?: number | null } }) {
  const { go } = useNav();
  const [list, setList] = useState<ChallengeSummary[]>([]);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [newTopic, setNewTopic] = useState<number | null>(create?.topicId ?? null);
  const [focus, setFocus] = useState('');
  const gen = useTask();
  const load = useCallback(() => void rpc.challengesList(null).then(setList), []);
  useEffect(() => {
    load();
    void rpc.topicsList().then((t) => {
      setTopics(t);
      setNewTopic((cur) => cur ?? t.find((x) => x.status !== 'diagnosing')?.id ?? null);
    });
  }, [load]);

  const generate = async () => {
    if (!newTopic) return;
    const c = await gen.run((rid) => rpc.challengeCreate({ topicId: newTopic, moduleId: create?.moduleId ?? null, focus: focus || undefined }, rid));
    if (c) {
      load();
      go({ page: 'challenges', id: c.id });
    }
  };

  return (
    <div className="h-full flex">
      <aside className="w-[290px] shrink-0 border-r border-line flex flex-col">
        <div className="p-3 border-b border-line space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-medium"><Sparkles className="size-4 text-accent" /> Nuevo reto</div>
          <select value={newTopic ?? ''} onChange={(e) => setNewTopic(Number(e.target.value) || null)} className="w-full h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
            <option value="">Elige tema…</option>
            {topics.filter((t) => t.status !== 'diagnosing').map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Enfoque (opcional): p. ej. subconsultas" className="w-full h-8 rounded-lg border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent/60" />
          <Button size="sm" variant="primary" icon={Plus} className="w-full" disabled={!newTopic || gen.running} onClick={() => void generate()}>Generar reto</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {list.map((c) => (
            <button key={c.id} onClick={() => go({ page: 'challenges', id: c.id })} className={`w-full text-left rounded-lg px-3 py-2 mb-0.5 transition-colors ${c.id === id ? 'bg-raised' : 'hover:bg-raised/60'}`}>
              <div className="flex items-center gap-2 text-[13px]">
                {c.status === 'completed' ? <CheckCircle2 className="size-3.5 text-ok shrink-0" /> : c.isFinalProject ? <Flag className="size-3.5 text-warn shrink-0" /> : <Circle className="size-3.5 text-faint shrink-0" />}
                <span className="truncate">{c.title}</span>
              </div>
              <div className="text-faint text-[11.5px] pl-5.5 ml-[22px]">{c.topicTitle} · nivel {c.level} · {c.attempts} intento{c.attempts !== 1 ? 's' : ''}</div>
            </button>
          ))}
          {!list.length && <p className="text-faint text-[12.5px] px-3 py-2">Aún no tienes retos.</p>}
        </div>
      </aside>
      <div className="flex-1 min-w-0 overflow-y-auto">
        {gen.running || gen.error ? (
          <div className="max-w-[760px] mx-auto px-8 py-10 space-y-3">
            <TaskProgress task={gen} title="Diseñando tu reto" onCancel={gen.cancel} />
            <TaskError task={gen} onRetry={() => void generate()} onDismiss={gen.clearError} />
          </div>
        ) : id ? (
          <ChallengeDetail key={id} id={id} onChanged={load} />
        ) : (
          <div className="max-w-[760px] mx-auto px-8 py-9">
            <PageHeader title="Retos prácticos" subtitle="Aprendizaje basado en problemas: aplica lo aprendido, con pistas progresivas y evaluación por criterios." />
            <Card><EmptyState icon={Swords} title="Elige o genera un reto">Cada reto vale +75 XP si lo superas sin mirar la solución.</EmptyState></Card>
          </div>
        )}
      </div>
    </div>
  );
}

function ChallengeDetail({ id, onChanged }: { id: number; onChanged: () => void }) {
  const [c, setC] = useState<ChallengeView | null | undefined>(undefined);
  const [response, setResponse] = useState('');
  const submit = useTask();
  const prep = useTask();
  const prepared = useRef(false);
  useStudyTimer(c && c.status === 'open' ? 'challenge' : null);

  useEffect(() => {
    void rpc.challengeGet(id).then(async (v) => {
      setC(v);
      // El proyecto final se completa (pistas, criterios, solución) la primera vez que se abre.
      if (v && v.isFinalProject && v.hintsTotal === 0 && !prepared.current) {
        prepared.current = true;
        const r = await prep.run((rid) => rpc.challengePrepare(id, rid));
        if (r) setC(r);
      }
    });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (c === undefined) return <div className="p-10 max-w-[760px] mx-auto"><Skeleton className="h-48" /></div>;
  if (!c) return null;
  const send = async () => {
    const r = await submit.run((rid) => rpc.challengeSubmit(c.id, response, rid));
    if (r) {
      setC(r);
      onChanged();
    }
  };

  return (
    <div className="max-w-[780px] mx-auto px-8 py-8 animate-rise">
      <div className="flex items-center gap-2 text-[12px]">
        {c.isFinalProject && <span className="px-2 py-0.5 rounded-full bg-warn/15 text-warn flex items-center gap-1"><Flag className="size-3" /> Proyecto final</span>}
        <span className="px-2 py-0.5 rounded-full bg-raised text-muted">{c.topicTitle}</span>
        <span className="text-faint">Nivel {c.level}/5 · +{c.xp} XP</span>
        {c.status === 'completed' && <span className="ml-auto text-ok flex items-center gap-1"><Trophy className="size-3.5" /> Superado</span>}
      </div>
      <h1 className="font-display text-[26px] font-semibold tracking-tight mt-2">{c.title}</h1>
      <div className="mt-4 space-y-3">
        <TaskProgress task={prep} title="Preparando el proyecto final" onCancel={prep.cancel} />
        <TaskError task={prep} onRetry={async () => { const r = await prep.run((rid) => rpc.challengePrepare(id, rid)); if (r) setC(r); }} onDismiss={prep.clearError} />
      </div>
      <Markdown text={c.description} className="mt-4" />

      <div className="grid md:grid-cols-2 gap-3 mt-6">
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <div className="text-[12px] font-semibold text-muted mb-1.5">Objetivos</div>
          <ul className="space-y-1 text-[13px]">{c.objectives.map((o) => <li key={o}>· {o}</li>)}</ul>
        </div>
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <div className="text-[12px] font-semibold text-muted mb-1.5">Criterios de evaluación</div>
          <ul className="space-y-1 text-[13px]">{c.criteria.map((o) => <li key={o}>· {o}</li>)}</ul>
        </div>
      </div>

      {c.hintsTotal > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="size-4 text-warn" />
            <span className="text-[13px] font-medium">Pistas ({c.hints.length}/{c.hintsTotal})</span>
            {c.hints.length < c.hintsTotal && c.status === 'open' && <Button size="sm" className="ml-auto" onClick={async () => setC(await rpc.challengeHint(c.id))}>Ver siguiente pista</Button>}
          </div>
          {c.hints.length > 0 && <ol className="mt-2 space-y-1.5 text-[13.5px] list-decimal pl-5">{c.hints.map((h, i) => <li key={i} className="animate-rise"><Markdown text={h} className="!text-[13.5px]" /></li>)}</ol>}
        </div>
      )}

      {c.attempts.length > 0 && (
        <div className="mt-6 space-y-3">
          <h2 className="font-display font-semibold text-[16px]">Tus intentos</h2>
          {c.attempts.slice().reverse().map((a) => (
            <div key={a.id} className={`rounded-xl border px-4 py-3 ${a.passed ? 'border-ok/30 bg-ok/[0.05]' : 'border-line bg-surface'}`}>
              <div className="flex items-center gap-2 text-[13px] font-medium">
                {a.passed ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-warn" />}
                {a.passed ? 'Superado' : 'Todavía no'} <span className="ml-auto text-faint tabular-nums">{Math.round(a.score * 100)}%</span>
              </div>
              <ul className="mt-2 space-y-0.5 text-[12.5px]">
                {a.criteria.map((k) => <li key={k.criterion} className="flex gap-2"><span className={k.met ? 'text-ok' : 'text-bad'}>{k.met ? '✓' : '✗'}</span><span><b>{k.criterion}</b> — {k.comment}</span></li>)}
              </ul>
              <Markdown text={a.feedback} className="!text-[13.5px] mt-2" />
              {a.nextSteps.length > 0 && <p className="text-[12.5px] text-muted mt-1">Siguiente: {a.nextSteps.join(' · ')}</p>}
            </div>
          ))}
        </div>
      )}

      {c.status === 'open' && c.hintsTotal > 0 && (
        <div className="mt-6">
          <label className="text-[13px] font-medium" htmlFor="resp">Tu solución</label>
          <textarea id="resp" value={response} onChange={(e) => setResponse(e.target.value)} rows={10} placeholder="Código, consultas, diseño o razonamiento…" className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-3 font-mono text-[13px] outline-none focus:border-accent/60 resize-y" />
          <div className="flex items-center gap-2 mt-2">
            {c.canRevealSolution && <Button variant="ghost" size="sm" icon={Eye} onClick={async () => setC(await rpc.challengeRevealSolution(c.id))}>Rendirme y ver la solución (sin XP)</Button>}
            <Button variant="primary" icon={Send} className="ml-auto" disabled={response.trim().length < 10} loading={submit.running} onClick={() => void send()}>Enviar para evaluar</Button>
          </div>
          <div className="mt-3 space-y-3">
            <TaskProgress task={submit} title="Claude está evaluando tu solución" onCancel={submit.cancel} />
            <TaskError task={submit} onRetry={() => void send()} onDismiss={submit.clearError} />
          </div>
        </div>
      )}

      {c.solution && (
        <div className="mt-6 rounded-2xl border border-accent/30 bg-accent-soft/30 p-5">
          <div className="text-[12px] font-semibold text-accent mb-2">Solución explicada{c.solutionRevealed && c.status !== 'completed' ? ' (consultada: este reto ya no da XP)' : ''}</div>
          <Markdown text={c.solution} />
        </div>
      )}
    </div>
  );
}
