import { ArrowLeft, BookOpenCheck, Check, ClipboardCheck, Flag, Layers, Lock, MessageCircleQuestion, Play, Sparkles, Swords, Target, Trash2, Trophy, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ModuleView, TopicDetail } from '../../shared/learning';
import { ProgressBar, Ring } from '../components/charts';
import { ConceptMap } from '../components/ConceptMap';
import { Button, Card, ErrorBanner, Skeleton } from '../components/ui';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';
import { LEVEL_LABEL, STATUS_LABEL } from './TopicsPage';

export function TopicPage({ id }: { id: number }) {
  const { go } = useNav();
  const [t, setT] = useState<TopicDetail | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const load = useCallback(() => void rpc.topicGet(id).then(setT), [id]);
  useEffect(load, [load]);

  if (t === undefined) return <div className="p-10 max-w-[1000px] mx-auto space-y-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40" /></div>;
  if (t === null) return <div className="p-10"><ErrorBanner>Tema no encontrado.</ErrorBanner></div>;

  const openTutor = async () => go({ page: 'tutor', topicId: t.id });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1040px] mx-auto px-8 py-8">
        <button onClick={() => go({ page: 'topics' })} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg mb-4"><ArrowLeft className="size-3.5" /> Temas</button>
        <header className="flex items-start gap-6 animate-rise">
          <Ring value={t.progress} size={84} stroke={7} tone={t.status === 'mastered' ? 'ok' : 'accent'}>
            <span className="font-display font-semibold text-[18px] tabular-nums">{Math.round(t.progress * 100)}%</span>
          </Ring>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-[12px]">
              <span className={`px-2 py-0.5 rounded-full ${t.status === 'mastered' ? 'bg-ok/10 text-ok' : t.status === 'diagnosing' ? 'bg-warn/15 text-warn' : 'bg-accent-soft text-accent'}`}>{STATUS_LABEL[t.status]}</span>
              {t.level && <span className="text-muted">Nivel {LEVEL_LABEL[t.level]}</span>}
            </div>
            <h1 className="font-display text-[28px] font-semibold tracking-tight leading-tight mt-1.5">{t.title}</h1>
            {t.objective && <p className="text-muted mt-1 flex items-start gap-1.5"><Target className="size-4 mt-0.5 shrink-0 text-accent" />{t.objective}</p>}
          </div>
          {t.status !== 'diagnosing' && (
            <div className="flex flex-col gap-2 shrink-0">
              <Button variant="primary" icon={MessageCircleQuestion} onClick={openTutor}>Tutor</Button>
              <Button icon={ClipboardCheck} onClick={() => go({ page: 'assessment', create: { topicId: t.id, kind: 'practice', mode: 'practice' } })}>Practicar</Button>
            </div>
          )}
        </header>

        {t.status === 'diagnosing' ? (
          <Card className="mt-8 animate-rise">
            <div className="p-6 flex items-center gap-5">
              <div className="size-12 rounded-xl bg-warn/15 text-warn grid place-items-center"><Sparkles className="size-6" /></div>
              <div className="flex-1">
                <h2 className="font-display font-semibold text-[17px]">Primero, tu diagnóstico</h2>
                <p className="text-muted text-[13.5px] mt-0.5">{t.summary || 'Responde unas preguntas para medir lo que ya sabes. Con eso Claude diseña tu ruta.'}</p>
              </div>
              {t.diagnosticAssessmentId && <Button variant="primary" icon={Play} onClick={() => go({ page: 'assessment', id: t.diagnosticAssessmentId! })}>Hacer el diagnóstico</Button>}
            </div>
          </Card>
        ) : (
          <>
            {t.diagnosis && (
              <div className="grid md:grid-cols-3 gap-3 mt-7 animate-rise [animation-delay:60ms]">
                <InfoList title="Ya dominas" items={t.diagnosis.known} tone="ok" />
                <InfoList title="Por aprender" items={t.diagnosis.gaps} tone="accent" />
                <InfoList title="Prerrequisitos a reforzar" items={t.diagnosis.missingPrerequisites} tone="warn" />
              </div>
            )}
            {t.weakConcepts.length > 0 && (
              <div className="mt-4 rounded-xl border border-warn/30 bg-warn/[0.06] px-4 py-3 flex items-center gap-3 flex-wrap animate-rise">
                <span className="text-[13px] font-medium">Conceptos que necesitan refuerzo:</span>
                {t.weakConcepts.map((c) => (
                  <Button key={c.id} size="sm" icon={Zap} onClick={() => go({ page: 'assessment', create: { topicId: t.id, kind: 'reinforcement', mode: 'practice', conceptIds: [c.id] } })}>
                    {c.name} · {Math.round(c.mastery * 100)}%
                  </Button>
                ))}
              </div>
            )}

            <h2 className="font-display font-semibold text-[18px] mt-9 mb-4">Tu ruta</h2>
            <ol className="relative">
              {t.modules.map((m, i) => <ModuleStage key={m.id} m={m} topicId={t.id} index={i} />)}
              <li className="relative pl-14 pb-2">
                <span className={`absolute left-0 top-0 size-10 rounded-xl grid place-items-center ${t.status === 'mastered' ? 'bg-ok text-white' : 'bg-raised text-faint'}`}><Trophy className="size-5" /></span>
                <div className="pt-1.5 flex items-center gap-3 flex-wrap">
                  <div>
                    <div className="font-display font-semibold">Proyecto final</div>
                    <div className="text-muted text-[13px]">Aplica todo lo aprendido. Al superarlo y completar los módulos dominarás el tema (+200 XP).</div>
                  </div>
                  {t.finalChallengeId && (
                    <Button size="sm" icon={Flag} className="ml-auto" disabled={t.modules.some((m) => m.status !== 'completed')} onClick={() => go({ page: 'challenges', id: t.finalChallengeId! })}>
                      {t.modules.some((m) => m.status !== 'completed') ? 'Se desbloquea al completar los módulos' : 'Abrir proyecto'}
                    </Button>
                  )}
                </div>
              </li>
            </ol>

            <h2 className="font-display font-semibold text-[18px] mt-6 mb-3">Mapa de conocimientos</h2>
            <ConceptMap topicId={t.id} />

            <div className="grid sm:grid-cols-3 gap-3 mt-8">
              <Shortcut icon={BookOpenCheck} title="Glosario" text={`${t.concepts} conceptos · ${t.masteredConcepts} dominados`} onClick={() => go({ page: 'glossary', topicId: t.id })} />
              <Shortcut icon={Layers} title="Tarjetas" text="Repaso espaciado del tema" onClick={() => go({ page: 'cards', topicId: t.id })} />
              <Shortcut icon={Swords} title="Retos prácticos" text="Problemas reales con pistas" onClick={() => go({ page: 'challenges', create: { topicId: t.id } })} />
            </div>
          </>
        )}

        <div className="mt-12 pt-6 border-t border-line flex items-center gap-3">
          {confirmDelete ? (
            <>
              <span className="text-[13px] text-bad">Se borrará el tema con su ruta, evaluaciones, tarjetas y retos. Tu vault no se toca.</span>
              <Button size="sm" variant="danger" onClick={async () => { await rpc.topicDelete(t.id); go({ page: 'topics' }); }}>Eliminar definitivamente</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmDelete(true)}>Eliminar tema</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ModuleStage({ m, topicId, index }: { m: ModuleView; topicId: number; index: number }) {
  const { go } = useNav();
  const done = m.lessons.filter((l) => l.status === 'completed').length;
  const allLessons = done === m.lessons.length;
  const locked = m.status === 'locked';
  return (
    <li className="relative pl-14 pb-8 animate-rise" style={{ animationDelay: `${index * 60}ms` }}>
      <span className={`absolute left-[19px] top-11 bottom-0 w-[2px] ${m.status === 'completed' ? 'bg-ok/60' : 'bg-line'}`} />
      <span className={`absolute left-0 top-0 size-10 rounded-xl grid place-items-center font-display font-semibold ${m.status === 'completed' ? 'bg-ok text-white' : locked ? 'bg-raised text-faint' : 'bg-accent text-accent-fg'}`}>
        {m.status === 'completed' ? <Check className="size-5" /> : locked ? <Lock className="size-4" /> : index + 1}
      </span>
      <div className={`rounded-2xl border bg-surface ${locked ? 'border-line opacity-60' : 'border-line'}`}>
        <div className="px-5 pt-4 pb-3 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-[16px]">{m.title}</div>
            <div className="text-muted text-[12.5px]">{m.objective}</div>
          </div>
          <span className="text-[12px] text-faint shrink-0">{done}/{m.lessons.length}</span>
        </div>
        <ProgressBar value={m.lessons.length ? done / m.lessons.length : 0} className="mx-5" tone={m.status === 'completed' ? 'ok' : 'accent'} />
        <ul className="p-2 mt-1">
          {m.lessons.map((l) => {
            const lLocked = l.status === 'locked';
            return (
              <li key={l.id}>
                <button
                  disabled={lLocked}
                  onClick={() => go({ page: 'lesson', id: l.id })}
                  className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-raised/60 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                >
                  <span className={`size-6 rounded-full grid place-items-center shrink-0 ${l.status === 'completed' ? 'bg-ok/15 text-ok' : lLocked ? 'bg-raised text-faint' : 'bg-accent-soft text-accent'}`}>
                    {l.status === 'completed' ? <Check className="size-3.5" /> : lLocked ? <Lock className="size-3" /> : <Play className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13.5px] ${lLocked ? 'text-faint' : 'font-medium'}`}>{l.title}</span>
                    <span className="block text-[12px] text-faint truncate">{l.summary}</span>
                  </span>
                  {l.status === 'in_progress' && l.unitCount > 0 && <span className="text-[11.5px] text-accent shrink-0">Unidad {l.currentUnit + 1}/{l.unitCount}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-5 py-3 border-t border-line flex items-center gap-3 text-[12.5px]">
          <ClipboardCheck className="size-4 text-muted" />
          <span className="text-muted">
            Evaluación del módulo{m.quiz.attempts ? ` · mejor nota ${Math.round((m.quiz.bestScore ?? 0) * 100)}%` : ''}{m.quiz.passed ? ' · aprobada' : ''}
          </span>
          <Button
            size="sm"
            className="ml-auto"
            variant={allLessons && !m.quiz.passed ? 'primary' : 'secondary'}
            disabled={!allLessons || locked}
            onClick={() => go({ page: 'assessment', create: { topicId, kind: 'module_quiz', mode: 'exam', moduleId: m.id } })}
          >
            {!allLessons ? 'Completa las lecciones' : m.quiz.passed ? 'Repetir' : 'Hacer evaluación (≥70 %)'}
          </Button>
        </div>
      </div>
    </li>
  );
}

function InfoList({ title, items, tone }: { title: string; items: string[]; tone: 'ok' | 'accent' | 'warn' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-accent';
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className={`text-[12px] font-semibold ${color}`}>{title}</div>
      {items.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[13px]">{items.slice(0, 6).map((x) => <li key={x} className="truncate">· {x}</li>)}</ul>
      ) : (
        <p className="text-faint text-[12.5px] mt-1.5">—</p>
      )}
    </div>
  );
}

function Shortcut({ icon: Icon, title, text, onClick }: { icon: typeof Layers; title: string; text: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left rounded-2xl border border-line bg-surface p-4 hover:border-accent/50 transition-colors">
      <Icon className="size-5 text-accent" />
      <div className="font-medium mt-2">{title}</div>
      <div className="text-faint text-[12.5px]">{text}</div>
    </button>
  );
}
