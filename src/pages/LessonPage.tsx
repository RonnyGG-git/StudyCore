import { ArrowLeft, ArrowRight, BookMarked, Check, ClipboardCheck, Dumbbell, GitCompare, Lightbulb, MessageSquare, Microscope, RefreshCw, Sparkles, Wand2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { LessonAction, LessonView, UnitKind } from '../../shared/learning';
import type { ClaudeStatus } from '../../shared/types';
import { Chat, SourceCard } from '../components/Chat';
import { ProgressBar } from '../components/charts';
import { QuestionCard } from '../components/QuestionCard';
import { TaskError, TaskProgress } from '../components/TaskProgress';
import { Button, ErrorBanner, Skeleton } from '../components/ui';
import { useStudyTimer } from '../hooks/useStudyTimer';
import { useTask } from '../hooks/useTask';
import { Markdown } from '../lib/markdown';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

const KIND_LABEL: Record<UnitKind, string> = {
  intro: 'Introducción', definition: 'Definición', explanation: 'Explicación', example: 'Ejemplo práctico', analogy: 'Analogía',
  application: 'Aplicación real', mistakes: 'Errores comunes', related: 'Conceptos relacionados', check: 'Comprobación', summary: 'Resumen',
};

const ACTIONS: { action: LessonAction; label: string; icon: typeof Wand2 }[] = [
  { action: 'simpler', label: 'Más sencillo', icon: Wand2 },
  { action: 'example', label: 'Otro ejemplo', icon: Lightbulb },
  { action: 'technical', label: 'Técnicamente', icon: Microscope },
  { action: 'exercise', label: 'Ponme un ejercicio', icon: Dumbbell },
];

export function LessonPage({ id, claude }: { id: number; claude: ClaudeStatus | null }) {
  const { go } = useNav();
  const [lesson, setLesson] = useState<LessonView | null | undefined>(undefined);
  const [unit, setUnit] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [relateTo, setRelateTo] = useState('');
  const [completeError, setCompleteError] = useState<string | null>(null);
  const gen = useTask();
  const action = useTask();
  const check = useTask();
  useStudyTimer(lesson?.units.length ? 'lesson' : null);

  const load = useCallback(async () => {
    const l = await rpc.lessonGet(id);
    setLesson(l);
    if (l) setUnit(Math.min(l.currentUnit, Math.max(0, l.units.length - 1)));
    if (l?.conversationId) setChatOpen(true);
  }, [id]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    // El chat de la lección es una conversación propia (con el contexto de la lección), no una consulta suelta.
    if (chatOpen && lesson && lesson.units.length && !lesson.conversationId) {
      void rpc.lessonConversation(lesson.id).then((cid) => setLesson((l) => (l ? { ...l, conversationId: cid } : l)));
    }
  }, [chatOpen, lesson]);

  const generate = async (regenerate = false) => {
    const l = await gen.run((rid) => rpc.lessonGenerate(id, rid, regenerate));
    if (l) {
      setLesson(l);
      setUnit(0);
    }
  };

  const goUnit = (n: number) => {
    setUnit(n);
    void rpc.lessonSetUnit(id, n);
  };

  const runAction = async (a: LessonAction, extra?: string) => {
    setChatOpen(true);
    const r = await action.run((rid) => rpc.lessonAction(id, a, rid, extra));
    if (r) {
      setLesson((l) => (l ? { ...l, conversationId: r.conversationId } : l));
      setChatKey((k) => k + 1);
    }
  };

  const complete = async () => {
    setCompleteError(null);
    const r = await rpc.lessonComplete(id);
    if (r.ok) setLesson(r.value);
    else setCompleteError(r.error);
  };

  if (lesson === undefined) return <div className="p-10 max-w-[760px] mx-auto space-y-4"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-48" /></div>;
  if (lesson === null) return <div className="p-10"><ErrorBanner>Lección no encontrada.</ErrorBanner></div>;

  const units = lesson.units;
  const current = units[unit];
  const pendingCheck = !!current?.check && !current.check.answer;
  const isLast = unit === units.length - 1;
  const byRef = new Map(lesson.sources.map((s) => [s.ref.toUpperCase(), s]));
  const chip = (ref: string) => {
    const s = byRef.get(ref.toUpperCase());
    return (
      <button
        onClick={() => s && go({ page: 'library', doc: s.path })}
        title={s ? `${s.path} › ${s.heading}${s.verified ? '' : ' (sin verificar)'}` : 'Fuente no declarada'}
        className={`inline-flex items-center align-[1px] mx-0.5 px-1.5 h-[18px] rounded-md text-[10.5px] font-semibold font-mono ${!s ? 'bg-bad/10 text-bad' : s.verified ? 'bg-accent-soft text-accent' : 'bg-warn/15 text-warn'}`}
      >
        {ref}
      </button>
    );
  };

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-8 py-7">
          <button onClick={() => go({ page: 'topic', id: lesson.topicId })} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> {lesson.topicTitle} · {lesson.moduleTitle}</button>
          <h1 className="font-display text-[26px] font-semibold tracking-tight mt-2 leading-tight">{lesson.title}</h1>
          <p className="text-muted mt-1">{lesson.summary}</p>

          {!units.length ? (
            <div className="mt-8 space-y-4">
              {!gen.running && (
                <div className="rounded-2xl border border-line bg-surface p-6 text-center">
                  <Sparkles className="size-6 text-accent mx-auto" />
                  <p className="mt-3 text-muted text-[13.5px] max-w-md mx-auto">Claude preparará la lección en unidades cortas (definición, ejemplos, analogías, errores comunes y comprobaciones) a partir de tus documentos y adaptada a tu nivel.</p>
                  <Button variant="primary" className="mt-5" disabled={lesson.status === 'locked'} onClick={() => void generate()}>{lesson.status === 'locked' ? 'Lección bloqueada' : 'Preparar lección'}</Button>
                </div>
              )}
              <TaskProgress task={gen} title="Preparando tu lección" onCancel={gen.cancel} />
              <TaskError task={gen} onRetry={() => void generate()} onDismiss={gen.clearError} />
            </div>
          ) : (
            <>
              <div className="mt-6 flex items-center gap-3">
                <ProgressBar value={(unit + 1) / units.length} className="flex-1" tone={lesson.status === 'completed' ? 'ok' : 'accent'} />
                <span className="text-[12px] text-faint tabular-nums">{unit + 1}/{units.length}</span>
              </div>
              <div className="flex gap-1 mt-2" role="tablist" aria-label="Unidades">
                {units.map((u, i) => (
                  <button
                    key={i}
                    role="tab"
                    aria-selected={i === unit}
                    title={`${KIND_LABEL[u.kind]}: ${u.title}`}
                    onClick={() => goUnit(i)}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${i === unit ? 'bg-accent' : u.check?.answer ? 'bg-ok/50' : i < unit ? 'bg-accent/30' : 'bg-line'}`}
                  />
                ))}
              </div>

              <article key={unit} className="mt-6 rounded-2xl border border-line bg-surface p-7 animate-rise min-h-[260px]">
                <div className="text-[11.5px] font-semibold uppercase tracking-wider text-accent">{KIND_LABEL[current.kind]}</div>
                <h2 className="font-display text-[21px] font-semibold tracking-tight mt-1">{current.title}</h2>
                <Markdown text={current.body} renderRef={chip} className="mt-3" />
                {current.check && (
                  <div className="mt-5">
                    <QuestionCard
                      q={current.check}
                      mode="practice"
                      busy={check.running}
                      onCheck={async (resp) => {
                        const r = await check.run((rid) => rpc.answerCheck(current.check!.id, resp, rid));
                        if (r) setLesson((l) => l && { ...l, units: l.units.map((u, i) => (i === unit ? { ...u, check: r } : u)) });
                      }}
                    />
                    <div className="mt-2"><TaskError task={check} onDismiss={check.clearError} /></div>
                  </div>
                )}
                {current.kind === 'summary' && (lesson.sources.length > 0 || lesson.complementary.trim()) && (
                  <div className="mt-6 pt-5 border-t border-line space-y-4">
                    {lesson.sources.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-muted mb-2"><BookMarked className="size-3.5" /> Documentos que respaldan esta lección</div>
                        <div className="grid grid-cols-1 gap-2">{lesson.sources.map((s, i) => <SourceCard key={i} s={s} />)}</div>
                      </div>
                    )}
                    {lesson.complementary.trim() && (
                      <div className="rounded-xl border border-dashed border-line bg-raised/40 px-4 py-3">
                        <div className="text-[12px] font-semibold text-muted mb-1 flex items-center gap-2"><Lightbulb className="size-3.5" /> Conocimiento general de Claude · no está en tus notas</div>
                        <Markdown text={lesson.complementary} className="!text-[13.5px] text-muted" />
                      </div>
                    )}
                  </div>
                )}
              </article>

              <div className="mt-4 flex items-center gap-2">
                <Button variant="ghost" icon={ArrowLeft} disabled={unit === 0} onClick={() => goUnit(unit - 1)}>Anterior</Button>
                <div className="ml-auto flex items-center gap-2">
                  {pendingCheck && <span className="text-[12px] text-faint">Responde la comprobación para continuar</span>}
                  {!isLast ? (
                    <Button variant="primary" disabled={pendingCheck} onClick={() => goUnit(unit + 1)}>Siguiente <ArrowRight className="size-4" /></Button>
                  ) : lesson.status === 'completed' ? (
                    lesson.isLastInModule ? (
                      <Button variant="primary" icon={ClipboardCheck} onClick={() => go({ page: 'topic', id: lesson.topicId })}>Ir a la evaluación del módulo</Button>
                    ) : lesson.nextLessonId ? (
                      <Button variant="primary" onClick={() => go({ page: 'lesson', id: lesson.nextLessonId! })}>Siguiente lección <ArrowRight className="size-4" /></Button>
                    ) : null
                  ) : (
                    <Button variant="primary" icon={Check} disabled={pendingCheck} onClick={() => void complete()}>Completar lección · +20 XP</Button>
                  )}
                </div>
              </div>
              {completeError && <div className="mt-3"><ErrorBanner>{completeError}</ErrorBanner></div>}
              {lesson.status === 'completed' && isLast && <p className="mt-3 text-[13px] text-ok flex items-center gap-1.5"><Check className="size-4" /> Lección completada.</p>}

              <div className="mt-8 rounded-2xl border border-line bg-surface p-4">
                <div className="text-[12px] font-semibold text-muted mb-2.5">¿Necesitas otra forma de verlo? Sobre «{current.title}»</div>
                <div className="flex flex-wrap gap-2">
                  {ACTIONS.map((a) => (
                    <Button key={a.action} size="sm" icon={a.icon} disabled={action.running} onClick={() => void runAction(a.action)}>{a.label}</Button>
                  ))}
                  <Button size="sm" icon={ClipboardCheck} onClick={() => go({ page: 'assessment', create: { topicId: lesson.topicId, kind: 'lesson_quiz', mode: 'practice', lessonId: lesson.id } })}>
                    Comprueba si lo entendí
                  </Button>
                </div>
                <form
                  className="mt-2.5 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runAction('relate', relateTo);
                  }}
                >
                  <GitCompare className="size-4 text-muted shrink-0" />
                  <input value={relateTo} onChange={(e) => setRelateTo(e.target.value)} placeholder="Relaciónalo con… (otro concepto, o vacío para que elija Claude)" className="flex-1 h-8 bg-transparent outline-none text-[13px] border-b border-line focus:border-accent/60" />
                  <Button size="sm" type="submit" disabled={action.running}>Relacionar</Button>
                </form>
                <div className="mt-3"><TaskError task={action} onDismiss={action.clearError} /></div>
              </div>
              <button onClick={() => void generate(true)} disabled={gen.running} className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-faint hover:text-fg">
                <RefreshCw className="size-3" /> Volver a generar la lección
              </button>
              <div className="mt-3"><TaskProgress task={gen} title="Regenerando la lección" onCancel={gen.cancel} /></div>
            </>
          )}
        </div>
      </div>

      {units.length > 0 && (
        chatOpen ? (
          <aside className="w-[420px] shrink-0 border-l border-line flex flex-col">
            <div className="h-12 px-4 flex items-center gap-2 border-b border-line">
              <MessageSquare className="size-4 text-accent" />
              <span className="font-medium text-[13.5px]">Profesor de la lección</span>
              <button onClick={() => setChatOpen(false)} className="ml-auto text-faint hover:text-fg" aria-label="Cerrar panel"><X className="size-4" /></button>
            </div>
            {action.running && <div className="p-4 border-b border-line"><TaskProgress task={action} title="Claude está respondiendo" onCancel={action.cancel} /></div>}
            <div className="flex-1 min-h-0">
              <Chat
                compact
                conversationId={lesson.conversationId}
                refreshKey={chatKey}
                claude={claude}
                onConversation={(cid) => setLesson((l) => (l ? { ...l, conversationId: cid } : l))}
                placeholder="Pregunta sobre esta lección…"
                empty={{ icon: MessageSquare, title: 'Pregunta lo que no te quede claro', text: 'Usa los botones de la lección o escribe tu duda. El profesor conoce la lección y tu nivel.' }}
              />
            </div>
          </aside>
        ) : (
          <button onClick={() => setChatOpen(true)} className="w-11 shrink-0 border-l border-line grid place-items-center text-muted hover:text-accent" aria-label="Abrir profesor de la lección" title="Profesor de la lección">
            <MessageSquare className="size-4" />
          </button>
        )
      )}
    </div>
  );
}
