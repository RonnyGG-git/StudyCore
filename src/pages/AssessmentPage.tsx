import { ArrowLeft, Award, ClipboardCheck, GraduationCap, Lightbulb, RotateCcw, Send, Timer, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AssessmentView, QuizRequest } from '../../shared/learning';
import { Ring } from '../components/charts';
import { QuestionCard } from '../components/QuestionCard';
import { TaskError, TaskProgress } from '../components/TaskProgress';
import { Button, ErrorBanner, Skeleton } from '../components/ui';
import { useStudyTimer } from '../hooks/useStudyTimer';
import { useTask } from '../hooks/useTask';
import { Markdown } from '../lib/markdown';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

const KIND_LABEL: Record<AssessmentView['kind'], string> = {
  diagnostic: 'Diagnóstico inicial', lesson_check: 'Comprobación', lesson_quiz: 'Comprobación de lección', module_quiz: 'Evaluación de módulo',
  practice: 'Práctica', reinforcement: 'Refuerzo', exam: 'Examen',
};

/** Evaluaciones: práctica (corrección inmediata), examen (corrección al entregar) y diagnóstico. */
export function AssessmentPage({ id, create }: { id?: number; create?: QuizRequest }) {
  const { go } = useNav();
  const [a, setA] = useState<AssessmentView | null | undefined>(undefined);
  const gen = useTask();
  const submit = useTask();
  const checking = useTask();
  const [busyQ, setBusyQ] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const started = useRef(false);
  useStudyTimer(a && a.status === 'in_progress' ? 'assessment' : null);

  const generate = async () => {
    if (!create) return;
    const r = await gen.run((rid) => rpc.quizCreate(create, rid));
    if (r) setA(r);
    else setA(null);
  };

  useEffect(() => {
    if (id) void rpc.assessmentGet(id).then(setA);
    else if (create && !started.current) {
      started.current = true;
      void generate();
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-8 py-10 space-y-4">
          {a === undefined && !gen.running && !gen.error && <Skeleton className="h-40" />}
          <TaskProgress task={gen} title={create?.kind === 'reinforcement' ? 'Preparando un refuerzo a tu medida' : 'Preparando tus preguntas'} onCancel={gen.cancel} />
          <TaskError task={gen} onRetry={() => void generate()} onDismiss={() => history.length && go({ page: 'dashboard' })} />
          {a === null && !gen.error && !gen.running && <ErrorBanner>Evaluación no encontrada.</ErrorBanner>}
        </div>
      </div>
    );
  }

  const isDiag = a.kind === 'diagnostic';
  const mode = a.mode;
  const answered = a.questions.filter((q) => q.answer).length;
  const graded = a.status === 'graded';
  const pct = a.score != null ? Math.round(a.score * 100) : null;

  const save = async (qid: number, resp: unknown) => {
    setSaveError(null);
    const r = await rpc.answerSave(qid, resp);
    if (r.ok) setA((cur) => cur && { ...cur, questions: cur.questions.map((q) => (q.id === qid ? r.value : q)) });
    else setSaveError(r.error);
  };
  const check = async (qid: number, resp: unknown) => {
    setBusyQ(qid);
    const r = await checking.run((rid) => rpc.answerCheck(qid, resp, rid));
    setBusyQ(null);
    if (r) {
      const fresh = await rpc.assessmentGet(a.id);
      if (fresh) setA(fresh);
    }
  };
  const doSubmit = async () => {
    setConfirm(false);
    if (isDiag) {
      const t = await submit.run((rid) => rpc.topicSubmitDiagnostic(a.id, rid));
      if (t) go({ page: 'topic', id: t.id });
      return;
    }
    const r = await submit.run((rid) => rpc.assessmentSubmit(a.id, rid));
    if (r) setA(r);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[780px] mx-auto px-8 py-7">
        {a.topicId && <button onClick={() => go({ page: 'topic', id: a.topicId! })} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg"><ArrowLeft className="size-3.5" /> {a.topicTitle}</button>}
        <div className="flex items-center gap-2 mt-3 text-[12px]">
          <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent">{KIND_LABEL[a.kind]}</span>
          <span className="px-2 py-0.5 rounded-full bg-raised text-muted">{mode === 'exam' ? (isDiag ? 'Sin corrección hasta el final' : 'Modo examen · corrección al entregar') : 'Práctica · corrección inmediata'}</span>
          <span className="text-faint">Dificultad {a.difficulty}/5</span>
        </div>
        <h1 className="font-display text-[26px] font-semibold tracking-tight mt-2 leading-tight">{a.title}</h1>
        {isDiag && !graded && <p className="text-muted mt-1">Responde con honestidad: si no sabes algo, pulsa «No lo sé». No se trata de aprobar, sino de saber desde dónde empezar.</p>}

        {graded && !isDiag && (
          <div className="mt-6 rounded-2xl border border-line bg-surface p-6 flex items-center gap-6 animate-rise">
            <Ring value={a.score ?? 0} size={96} stroke={8} tone={a.passed ? 'ok' : 'warn'}>
              <span className="font-display font-semibold text-[22px] tabular-nums">{pct}%</span>
            </Ring>
            <div className="flex-1 min-w-0">
              <div className={`font-display font-semibold text-[19px] ${a.passed ? 'text-ok' : 'text-warn'}`}>
                {a.passed ? (pct! >= 90 ? '¡Excelente!' : 'Aprobada') : 'Aún no: sigue practicando'}
              </div>
              <p className="text-muted text-[13px] mt-0.5">
                {a.passed ? (a.kind === 'module_quiz' ? 'Módulo superado: el siguiente queda desbloqueado.' : 'Buen trabajo.') : 'Se necesita un 70 % para aprobar. Repasa lo indicado y vuelve a intentarlo.'}
              </p>
              {a.review.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {a.review.map((r) => <li key={r} className="text-[13px] flex items-center gap-2"><Lightbulb className="size-3.5 text-warn shrink-0" />{r}</li>)}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {a.topicId && !a.passed && (
                <Button icon={Zap} onClick={() => go({ page: 'assessment', create: { topicId: a.topicId!, kind: 'practice', mode: 'practice' } })}>Practicar lo débil</Button>
              )}
              {a.topicId && <Button variant="ghost" icon={RotateCcw} onClick={() => go({ page: 'topic', id: a.topicId! })}>Volver a la ruta</Button>}
            </div>
          </div>
        )}

        {a.intro && (
          <div className="mt-6 rounded-2xl border border-accent/30 bg-accent-soft/30 p-6 animate-rise">
            <div className="text-[12px] font-semibold text-accent flex items-center gap-1.5 mb-2"><GraduationCap className="size-4" /> Otra forma de entenderlo</div>
            <Markdown text={a.intro} />
          </div>
        )}

        <div className="mt-6 space-y-4">
          {a.questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              q={q}
              index={i}
              mode={mode}
              allowUnknown={isDiag || mode === 'practice'}
              locked={graded || submit.running}
              busy={busyQ === q.id}
              onSave={(resp) => save(q.id, resp)}
              onCheck={(resp) => check(q.id, resp)}
            />
          ))}
        </div>
        {saveError && <div className="mt-3"><ErrorBanner>{saveError}</ErrorBanner></div>}
        <div className="mt-3 space-y-3">
          <TaskProgress task={checking} title="Claude está analizando tu respuesta" onCancel={checking.cancel} />
          <TaskError task={checking} onDismiss={checking.clearError} />
        </div>

        {!graded && mode === 'exam' && (
          <div className="sticky bottom-0 mt-6 -mx-2 px-2 pb-5 pt-3 bg-gradient-to-t from-bg via-bg to-transparent">
            <div className="rounded-2xl border border-line bg-surface px-5 py-3.5 flex items-center gap-3 shadow-[0_-8px_24px_-16px_rgb(0_0_0/0.3)]">
              <Timer className="size-4 text-muted" />
              <span className="text-[13px] text-muted">{answered} de {a.questions.length} respondidas</span>
              {confirm ? (
                <>
                  <span className="ml-auto text-[13px]">{answered < a.questions.length ? `Quedan ${a.questions.length - answered} sin responder (contarán como 0).` : '¿Entregar?'}</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Seguir</Button>
                  <Button variant="primary" size="sm" icon={Send} onClick={() => void doSubmit()}>Entregar</Button>
                </>
              ) : (
                <Button variant="primary" className="ml-auto" icon={isDiag ? ClipboardCheck : Send} disabled={submit.running || !answered} onClick={() => setConfirm(true)}>
                  {isDiag ? 'Terminar diagnóstico y crear mi ruta' : 'Entregar examen'}
                </Button>
              )}
            </div>
            <div className="mt-3 space-y-3">
              <TaskProgress task={submit} title={isDiag ? 'Claude está evaluando tu diagnóstico y diseñando tu ruta' : 'Corrigiendo tu examen'} onCancel={submit.cancel} />
              <TaskError task={submit} onRetry={() => void doSubmit()} onDismiss={submit.clearError} />
            </div>
          </div>
        )}
        {graded && isDiag && a.topicId && (
          <div className="mt-6 flex justify-end"><Button variant="primary" icon={Award} onClick={() => go({ page: 'topic', id: a.topicId! })}>Ver mi ruta</Button></div>
        )}
      </div>
    </div>
  );
}
