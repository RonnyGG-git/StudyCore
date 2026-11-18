import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Plus, Sparkles, Target, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Goal, GoalMetric, PlannedSession, Recommendation, TopicSummary } from '../../shared/learning';
import { ProgressBar } from '../components/charts';
import { TaskError, TaskProgress } from '../components/TaskProgress';
import { Button, Card, PageHeader } from '../components/ui';
import { useTask } from '../hooks/useTask';
import { routeFor, useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

export const METRIC_LABEL: Record<GoalMetric, string> = { xp: 'XP', lessons: 'lecciones', questions: 'preguntas', minutes: 'minutos de estudio', cards: 'tarjetas repasadas' };

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
function monday(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export function PlannerPage() {
  const { go } = useNav();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [claudeRecs, setClaudeRecs] = useState<Recommendation[] | null>(null);
  const [minutes, setMinutes] = useState(45);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof rpc.plannerStats>> | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [week, setWeek] = useState(() => monday(new Date()));
  const [sessions, setSessions] = useState<PlannedSession[]>([]);
  const [editing, setEditing] = useState<{ id?: number; date: string; title: string; minutes: number; topicId: number | null } | null>(null);
  const [newGoal, setNewGoal] = useState<{ period: 'daily' | 'weekly'; metric: GoalMetric; target: number }>({ period: 'daily', metric: 'minutes', target: 30 });
  const claude = useTask();

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(week); d.setDate(d.getDate() + i); return iso(d); }), [week]);
  const loadSessions = useCallback(() => void rpc.sessionsList(days[0], days[6]).then(setSessions), [days]);
  const loadAll = useCallback(() => {
    void rpc.goalsList().then(setGoals);
    void rpc.recommendations().then(setRecs);
    void rpc.plannerStats().then(setStats);
    loadSessions();
  }, [loadSessions]);
  useEffect(() => void rpc.topicsList().then(setTopics), []);
  useEffect(loadAll, [loadAll]);

  const saveSession = async () => {
    if (!editing) return;
    await rpc.sessionSave({ ...editing, title: editing.title || 'Sesión de estudio' });
    setEditing(null);
    loadAll();
  };
  const setStatus = async (s: PlannedSession, status: PlannedSession['status']) => {
    await rpc.sessionSave({ id: s.id, topicId: s.topicId, title: s.title, date: s.date, minutes: s.minutes, status, notes: s.notes });
    loadAll();
  };
  const askClaude = async () => {
    const r = await claude.run((rid) => rpc.recommendWithClaude(minutes, rid));
    if (r) setClaudeRecs(r);
  };
  const today = iso(new Date());

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1080px] mx-auto px-8 py-9">
        <PageHeader title="Planificador" subtitle="Objetivos medidos con tu actividad real, sesiones planificadas y qué estudiar ahora." />
        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 lg:col-span-7" title="¿Qué estudio ahora?">
            <div className="px-5 pb-5 pt-2">
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft/40 px-3 py-2.5">
                <Sparkles className="size-4 text-accent" />
                <span className="text-[13px]">Tengo</span>
                <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
                  {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutos</option>)}
                </select>
                <Button size="sm" variant="primary" className="ml-auto" disabled={claude.running} onClick={() => void askClaude()}>Planificar con Claude</Button>
              </div>
              <div className="mt-3 space-y-3">
                <TaskProgress task={claude} title="Planificando tu sesión" onCancel={claude.cancel} />
                <TaskError task={claude} onRetry={() => void askClaude()} onDismiss={claude.clearError} />
              </div>
              <ul className="mt-3 divide-y divide-line">
                {(claudeRecs ?? recs).map((r, i) => (
                  <li key={i}>
                    <button onClick={() => go(routeFor(r))} className="w-full flex items-center gap-3 py-2.5 text-left group">
                      <span className="size-7 rounded-lg bg-raised grid place-items-center text-[12px] font-semibold text-muted shrink-0">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] font-medium group-hover:text-accent truncate">{r.title}</span>
                        <span className="block text-[12px] text-faint truncate">{r.reason}</span>
                      </span>
                      <span className="text-[12px] text-faint flex items-center gap-1 shrink-0"><Clock className="size-3" /> {r.minutes} min</span>
                    </button>
                  </li>
                ))}
              </ul>
              {claudeRecs && <button className="text-[12px] text-faint hover:text-fg mt-1" onClick={() => setClaudeRecs(null)}>Ver las recomendaciones automáticas</button>}
            </div>
          </Card>

          <Card className="col-span-12 lg:col-span-5" title="Objetivos">
            <div className="px-5 pb-5 pt-2 space-y-3">
              {goals.map((g) => (
                <div key={g.id}>
                  <div className="flex items-center gap-2 text-[13px]">
                    {g.done ? <Check className="size-3.5 text-ok" /> : <Target className="size-3.5 text-muted" />}
                    <span>{g.period === 'daily' ? 'Hoy' : 'Esta semana'}: {g.target} {METRIC_LABEL[g.metric]}</span>
                    <span className="ml-auto text-faint tabular-nums text-[12px]">{g.current}/{g.target}</span>
                    <button onClick={async () => setGoals(await rpc.goalDelete(g.id))} className="text-faint hover:text-bad" aria-label="Eliminar objetivo"><X className="size-3.5" /></button>
                  </div>
                  <ProgressBar value={g.current / g.target} className="mt-1.5" tone={g.done ? 'ok' : 'accent'} />
                </div>
              ))}
              {!goals.length && <p className="text-faint text-[12.5px]">Define objetivos diarios o semanales; se miden solos con tu actividad.</p>}
              <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line">
                <select value={newGoal.period} onChange={(e) => setNewGoal({ ...newGoal, period: e.target.value as 'daily' | 'weekly' })} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px]">
                  <option value="daily">Diario</option><option value="weekly">Semanal</option>
                </select>
                <input type="number" min={1} value={newGoal.target} onChange={(e) => setNewGoal({ ...newGoal, target: Math.max(1, Number(e.target.value)) })} className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-[12.5px]" aria-label="Cantidad" />
                <select value={newGoal.metric} onChange={(e) => setNewGoal({ ...newGoal, metric: e.target.value as GoalMetric })} className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] flex-1 min-w-0">
                  {Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <Button size="sm" icon={Plus} onClick={async () => setGoals(await rpc.goalSave(newGoal))}>Añadir</Button>
              </div>
            </div>
          </Card>

          <Card
            className="col-span-12"
            title={<span className="flex items-center gap-2"><CalendarDays className="size-4" /> Semana del {new Date(`${days[0]}T12:00`).toLocaleDateString('es', { day: 'numeric', month: 'long' })}</span>}
            action={
              <div className="flex items-center gap-1">
                {stats && <span className="text-[12px] text-faint mr-3">{stats.weekMinutes} min estudiados{stats.weekGoalMinutes ? ` de ${stats.weekGoalMinutes}` : ''} · cumplimiento {stats.compliance == null ? '—' : `${Math.round(stats.compliance * 100)}%`}</span>}
                <Button size="sm" variant="ghost" onClick={() => setWeek((w) => { const d = new Date(w); d.setDate(d.getDate() - 7); return d; })} aria-label="Semana anterior"><ChevronLeft className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => setWeek(monday(new Date()))}>Hoy</Button>
                <Button size="sm" variant="ghost" onClick={() => setWeek((w) => { const d = new Date(w); d.setDate(d.getDate() + 7); return d; })} aria-label="Semana siguiente"><ChevronRight className="size-4" /></Button>
              </div>
            }
          >
            <div className="grid grid-cols-7 gap-2 p-4 pt-3">
              {days.map((d) => (
                <div key={d} className={`rounded-xl border min-h-[150px] p-2 flex flex-col ${d === today ? 'border-accent/50 bg-accent-soft/20' : 'border-line'}`}>
                  <div className="text-[11.5px] text-muted capitalize mb-1.5">{new Date(`${d}T12:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric' })}</div>
                  <div className="space-y-1.5 flex-1">
                    {sessions.filter((s) => s.date === d).map((s) => (
                      <div key={s.id} className={`group rounded-lg px-2 py-1.5 text-[12px] ${s.status === 'done' ? 'bg-ok/10' : s.status === 'skipped' ? 'bg-raised line-through text-faint' : 'bg-raised'}`}>
                        <div className="font-medium truncate">{s.title}</div>
                        <div className="text-faint text-[11px] truncate">{s.minutes} min{s.topicTitle ? ` · ${s.topicTitle}` : ''}</div>
                        <div className="hidden group-hover:flex gap-1 mt-1">
                          <button className="text-ok" title="Hecha" onClick={() => void setStatus(s, 'done')}><Check className="size-3.5" /></button>
                          <button className="text-warn" title="Omitida" onClick={() => void setStatus(s, 'skipped')}><X className="size-3.5" /></button>
                          <button className="text-faint hover:text-bad ml-auto" title="Eliminar" onClick={async () => { await rpc.sessionDelete(s.id); loadAll(); }}><Trash2 className="size-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setEditing({ date: d, title: '', minutes: 30, topicId: null })} className="mt-1.5 text-faint hover:text-accent text-[11.5px] flex items-center gap-1"><Plus className="size-3" /> Sesión</button>
                </div>
              ))}
            </div>
            {editing && (
              <div className="mx-4 mb-4 rounded-xl border border-line bg-raised/40 p-3 flex flex-wrap items-center gap-2 animate-rise">
                <span className="text-[12.5px] text-muted">{new Date(`${editing.date}T12:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric' })}</span>
                <input autoFocus value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Qué vas a estudiar" className="h-8 flex-1 min-w-[180px] rounded-lg border border-line bg-surface px-2 text-[13px]" />
                <select value={editing.topicId ?? ''} onChange={(e) => setEditing({ ...editing, topicId: e.target.value ? Number(e.target.value) : null })} className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px]">
                  <option value="">Sin tema</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
                <input type="number" min={5} max={600} value={editing.minutes} onChange={(e) => setEditing({ ...editing, minutes: Number(e.target.value) })} className="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-[13px]" aria-label="Minutos" />
                <Button size="sm" variant="primary" onClick={() => void saveSession()}>Guardar</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
