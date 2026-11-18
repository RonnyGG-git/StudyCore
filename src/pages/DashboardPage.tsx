import { ArrowRight, ArrowUpRight, BookOpen, Brain, CircleAlert, ClipboardCheck, Clock, Flame, GraduationCap, MessagesSquare, Play, Plus, RefreshCw, Sparkles, Target, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ContinueItem, Home } from '../../shared/learning';
import type { ClaudeStatus, DashboardData } from '../../shared/types';
import { Bars, ProgressBar, Ring } from '../components/charts';
import { Button, Card, EmptyState, Skeleton } from '../components/ui';
import { describeProgress, useIndexer } from '../hooks/useIndexer';
import { api } from '../lib/api';
import { compact, greeting, num, relativeTime } from '../lib/format';
import { routeFor, useNav, type Route } from '../lib/nav';
import { rpc } from '../lib/rpc';
import { METRIC_LABEL } from './PlannerPage';

function continueRoute(c: ContinueItem): Route {
  switch (c.kind) {
    case 'lesson': return { page: 'lesson', id: c.id };
    case 'assessment':
    case 'diagnostic': return { page: 'assessment', id: c.id };
    case 'conversation': return { page: 'ask', conversationId: c.id };
  }
}

export function DashboardPage({ claude }: { claude: ClaudeStatus | null }) {
  const { go } = useNav();
  const [home, setHome] = useState<Home | null>(null);
  const [sys, setSys] = useState<DashboardData | null>(null);
  const [question, setQuestion] = useState('');
  const load = useCallback(() => {
    void rpc.home().then(setHome);
    void api.dashboard().then(setSys);
  }, []);
  const indexer = useIndexer(load);
  useEffect(load, [load]);
  useEffect(() => api.onReward(() => void rpc.home().then(setHome)), []);
  useEffect(() => {
    if (sys && sys.vault.configured && sys.vault.documents === 0 && !indexer.running) void indexer.run();
  }, [sys]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = home?.game;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1120px] mx-auto px-8 py-8">
        <section className="grid grid-cols-12 gap-4 items-stretch">
          <div className="col-span-12 lg:col-span-8 animate-rise flex flex-col justify-center">
            <p className="text-muted text-[13.5px]">{greeting()}</p>
            <h1 className="font-display text-[30px] font-semibold tracking-tight leading-tight mt-0.5">¿Qué quieres aprender hoy?</h1>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (question.trim()) go({ page: 'ask', conversationId: null, draft: question.trim() });
              }}
              className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-surface p-1.5 pl-4 focus-within:border-accent/60 transition-colors"
            >
              <Sparkles className="size-[18px] text-accent shrink-0" />
              <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pregunta algo a tu vault…" className="flex-1 bg-transparent outline-none h-9 text-[14.5px] placeholder:text-faint" />
              <Button variant="primary" type="submit" size="sm" disabled={!question.trim() || !sys?.vault.indexedDocuments}>Consultar <ArrowRight className="size-3.5" /></Button>
            </form>
          </div>
          <Card className="col-span-12 lg:col-span-4 animate-rise [animation-delay:60ms]">
            {!g ? (
              <div className="p-5"><Skeleton className="h-20" /></div>
            ) : (
              <button onClick={() => go({ page: 'progress' })} className="w-full text-left p-5 flex items-center gap-4">
                <Ring value={g.progressToNext} size={72} stroke={7}>
                  <span className="font-display font-semibold text-[20px]">{g.level.n}</span>
                </Ring>
                <div className="min-w-0 flex-1">
                  <div className="font-display font-semibold">{g.level.name}</div>
                  <div className="text-[12.5px] text-muted tabular-nums">{num(g.xp)} XP{g.level.next ? ` · faltan ${num(g.level.next - g.xp)}` : ''}</div>
                  <div className="flex items-center gap-3 mt-2 text-[12.5px]">
                    <span className="flex items-center gap-1"><Flame className={`size-3.5 ${g.streak.activeToday ? 'text-warn' : 'text-faint'}`} />{g.streak.current} día{g.streak.current !== 1 ? 's' : ''}</span>
                    <span className="flex items-center gap-1 text-muted"><Clock className="size-3.5" />{home!.today.minutes} min hoy</span>
                    <span className="flex items-center gap-1 text-muted"><Zap className="size-3.5" />+{home!.today.xp}</span>
                  </div>
                </div>
              </button>
            )}
          </Card>
        </section>

        <div className="grid grid-cols-12 gap-4 mt-5">
          <Card className="col-span-12 lg:col-span-7 animate-rise [animation-delay:100ms]" title="Continuar aprendiendo">
            {!home ? (
              <div className="p-5"><Skeleton className="h-16" /></div>
            ) : home.continue ? (
              <div className="p-5 pt-3">
                <button onClick={() => go(continueRoute(home.continue!))} className="group w-full text-left rounded-xl bg-accent-soft/60 hover:bg-accent-soft px-5 py-4 transition-colors">
                  <div className="flex items-center gap-2 text-accent text-[12px] font-medium">
                    <Play className="size-3.5" /> {home.continue.kind === 'lesson' ? 'Lección en curso' : home.continue.kind === 'conversation' ? 'Última conversación' : home.continue.kind === 'diagnostic' ? 'Diagnóstico pendiente' : 'Evaluación sin terminar'}
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-1">
                    <span className="font-display font-semibold text-[17px] truncate">{home.continue.title}</span>
                    <ArrowUpRight className="size-4 text-accent shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </div>
                  <div className="text-[12.5px] text-muted mt-0.5">{home.continue.subtitle}</div>
                  {home.continue.kind !== 'conversation' && <ProgressBar value={home.continue.progress} className="mt-3" />}
                </button>
              </div>
            ) : (
              <EmptyState icon={GraduationCap} title="Empieza tu primer tema" action={<Button variant="primary" icon={Plus} onClick={() => go({ page: 'topics', create: true })}>Nuevo tema</Button>}>
                Elige un tema de tus notas: Claude hará un diagnóstico y creará tu ruta.
              </EmptyState>
            )}
          </Card>

          <Card className="col-span-12 lg:col-span-5 animate-rise [animation-delay:140ms]" title="Recomendado ahora" action={<Button size="sm" variant="ghost" onClick={() => go({ page: 'planner' })}>Planificar con Claude</Button>}>
            {!home ? <div className="p-5"><Skeleton className="h-24" /></div> : (
              <ul className="px-5 pb-4 pt-1 divide-y divide-line">
                {home.recommendations.map((r, i) => (
                  <li key={i}>
                    <button onClick={() => go(routeFor(r))} className="w-full flex items-center gap-3 py-2.5 text-left group">
                      <RecIcon action={r.action} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium truncate group-hover:text-accent">{r.title}</span>
                        <span className="block text-[12px] text-faint truncate">{r.reason}</span>
                      </span>
                      <span className="text-[11.5px] text-faint shrink-0">{r.minutes} min</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="col-span-12 lg:col-span-7" title="Temas en progreso" action={<Button size="sm" variant="ghost" onClick={() => go({ page: 'topics' })}>Ver todos</Button>}>
            {!home ? <div className="p-5"><Skeleton className="h-20" /></div> : home.topics.length ? (
              <div className="px-5 pb-5 pt-2 grid sm:grid-cols-2 gap-3">
                {home.topics.map((t) => (
                  <button key={t.id} onClick={() => go({ page: 'topic', id: t.id })} className="text-left rounded-xl border border-line px-4 py-3 hover:border-accent/50 transition-colors">
                    <div className="font-medium text-[14px] truncate">{t.title}</div>
                    <div className="text-[11.5px] text-faint">{t.status === 'diagnosing' ? 'Diagnóstico pendiente' : `${t.completedLessons}/${t.lessonCount} lecciones · ${t.masteredConcepts} dominados`}</div>
                    <ProgressBar value={t.progress} className="mt-2.5" />
                  </button>
                ))}
              </div>
            ) : <p className="px-5 pb-5 pt-1 text-faint text-[13px]">Sin temas activos.</p>}
          </Card>

          <Card className="col-span-12 sm:col-span-6 lg:col-span-5" title="Objetivos" action={<Button size="sm" variant="ghost" onClick={() => go({ page: 'planner' })}>Editar</Button>}>
            {!home ? <div className="p-5"><Skeleton className="h-16" /></div> : home.goals.length ? (
              <div className="px-5 pb-5 pt-2 space-y-3">
                {home.goals.map((x) => (
                  <div key={x.id}>
                    <div className="flex justify-between text-[13px]"><span>{x.period === 'daily' ? 'Hoy' : 'Semana'} · {METRIC_LABEL[x.metric]}</span><span className="tabular-nums text-faint">{x.current}/{x.target}</span></div>
                    <ProgressBar value={x.current / x.target} className="mt-1.5" tone={x.done ? 'ok' : 'accent'} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-5 pb-5 pt-1">
                <p className="text-faint text-[13px]">Sin objetivos. Ponte uno pequeño y alcanzable.</p>
                <Button size="sm" className="mt-3" icon={Target} onClick={async () => { await rpc.goalSave({ period: 'daily', metric: 'minutes', target: 20 }); load(); }}>20 minutos al día</Button>
              </div>
            )}
          </Card>

          <Card className="col-span-12 sm:col-span-6 lg:col-span-4" title="Próximos repasos" action={<Button size="sm" variant="ghost" onClick={() => go({ page: 'cards' })}>Repasar</Button>}>
            {!home ? <div className="p-5"><Skeleton className="h-16" /></div> : (
              <div className="px-5 pb-4 pt-2">
                <div className="flex items-baseline gap-2"><span className="font-display text-[28px] font-semibold tabular-nums">{home.review.due}</span><span className="text-muted text-[13px]">tarjetas para hoy</span></div>
                <Bars label="Repasos próximos" height={48} data={home.review.upcoming.map((u, i) => ({ label: i === 0 ? 'Hoy' : new Date(`${u.day}T12:00`).toLocaleDateString('es', { weekday: 'narrow' }), hint: u.day, value: u.count + (i === 0 ? home.review.due : 0) }))} />
              </div>
            )}
          </Card>

          <Card className="col-span-12 sm:col-span-6 lg:col-span-4" title="Últimas evaluaciones">
            {!home ? <div className="p-5"><Skeleton className="h-16" /></div> : home.recentAssessments.length ? (
              <ul className="px-5 pb-4 pt-1">
                {home.recentAssessments.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => go({ page: 'assessment', id: a.id })} className="w-full flex items-center gap-3 py-1.5 text-left hover:text-accent">
                      <ClipboardCheck className={`size-4 shrink-0 ${a.passed ? 'text-ok' : a.passed === false ? 'text-warn' : 'text-muted'}`} />
                      <span className="truncate text-[13px] flex-1">{a.title}</span>
                      <span className="tabular-nums text-[12.5px] font-medium">{a.score != null ? `${Math.round(a.score * 100)}%` : '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 pb-5 pt-1 text-faint text-[13px]">Aún no hay evaluaciones terminadas.</p>}
          </Card>

          <Card className="col-span-12 sm:col-span-6 lg:col-span-4" title="Esta semana">
            {!home ? <div className="p-5"><Skeleton className="h-16" /></div> : (
              <div className="px-5 pb-4 pt-3"><Bars label="XP por día de la semana" height={64} data={home.week.map((d) => ({ label: new Date(`${d.day}T12:00`).toLocaleDateString('es', { weekday: 'narrow' }), hint: `${d.day} · ${d.minutes} min`, value: d.xp }))} format={(v) => `${v} XP`} /></div>
            )}
          </Card>

          <Card className="col-span-12 lg:col-span-8" title="Actividad reciente">
            {!sys ? <div className="p-5"><Skeleton className="h-16" /></div> : sys.activity.length ? (
              <ul className="px-5 pb-4 pt-1">
                {sys.activity.slice(0, 7).map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-1.5 text-[13px]">
                    <span className={`mt-[7px] size-1.5 rounded-full shrink-0 ${a.level === 'error' ? 'bg-bad' : a.level === 'warn' ? 'bg-warn' : 'bg-accent/70'}`} />
                    <span className="flex-1 min-w-0 truncate" title={a.message}>{a.message}</span>
                    <span className="text-faint text-[12px] shrink-0">{relativeTime(a.at)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={BookOpen} title="Sin actividad todavía" />}
          </Card>
          <Card className="col-span-12 lg:col-span-4" title="Vault y motor" action={<Button size="sm" variant="ghost" icon={RefreshCw} loading={indexer.running} onClick={() => void indexer.run()}>Reindexar</Button>}>
            {sys && (
              <div className="px-5 pb-4 pt-2 text-[13px] space-y-2">
                <div className="flex justify-between"><span className="text-muted">Documentos</span><span className="tabular-nums">{num(sys.vault.indexedDocuments)} · {compact(sys.vault.words)} palabras</span></div>
                <div className="flex justify-between"><span className="text-muted">Índice</span><span className="text-faint">{indexer.running || indexer.progress?.phase === 'done' ? describeProgress(indexer.progress) : relativeTime(sys.vault.lastIndexedAt)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Claude Code</span><span className={claude?.loggedIn ? 'text-ok' : claude ? 'text-bad' : 'text-faint'}>{claude ? (claude.loggedIn ? 'Conectado' : 'No disponible') : '…'}</span></div>
                <div className="flex justify-between"><span className="text-muted">Llamadas</span><span className="tabular-nums">{sys.usage.runs} · {sys.usage.failed} fallidas · ~{sys.usage.avgSeconds} s</span></div>
                {sys.vault.pending > 0 && <p className="text-faint text-[12px] flex gap-1.5"><CircleAlert className="size-3.5 mt-0.5 shrink-0" />{sys.vault.pending} archivos sin texto extraíble (PDF escaneados o dañados).</p>}
                {indexer.error && <p className="text-bad text-[12px]">{indexer.error}</p>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function RecIcon({ action }: { action: string }) {
  const map: Record<string, typeof Zap> = { lesson: Play, review_cards: Brain, reinforce_concept: Zap, module_quiz: ClipboardCheck, challenge: Target, diagnostic: Sparkles, tutor: MessagesSquare, new_topic: Plus };
  const Icon = map[action] ?? Sparkles;
  return <span className="size-8 rounded-lg bg-accent-soft text-accent grid place-items-center shrink-0"><Icon className="size-4" /></span>;
}
