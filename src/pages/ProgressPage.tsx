import { Award, Download, Flame, Lock, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GameState, Stats } from '../../shared/learning';
import { Bars, Line, ProgressBar, Ring } from '../components/charts';
import { TYPE_LABEL } from '../components/QuestionCard';
import { Button, Card, PageHeader, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { num, relativeTime } from '../lib/format';
import { rpc } from '../lib/rpc';

const dayLabel = (d: string) => String(Number(d.slice(8)));
const dayHint = (d: string) => new Date(`${d}T12:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });

export function ProgressPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [exported, setExported] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void rpc.stats().then(setStats);
    void rpc.game().then(setGame);
  }, []);

  if (!stats || !game) return <div className="p-10 max-w-[1080px] mx-auto grid grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  const t = stats.totals;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1080px] mx-auto px-8 py-9">
        <PageHeader
          title="Progreso"
          subtitle="Todo lo que ves aquí sale de actividad real: lecciones, respuestas, repasos y retos."
          actions={
            <Button icon={Download} onClick={async () => { const r = await rpc.exportData(); setExported(r.ok ? { ok: true, text: r.value } : { ok: false, text: r.error }); }}>Exportar resultados</Button>
          }
        />
        {exported && (
          <p className={`-mt-3 mb-5 text-[12.5px] ${exported.ok ? 'text-ok' : 'text-bad'}`}>
            {exported.ok ? <button className="hover:underline" onClick={() => void api.revealPath(exported.text)}>Exportado (JSON + informe Markdown): {exported.text}</button> : exported.text}
          </p>
        )}

        <div className="grid grid-cols-12 gap-4">
          <Card className="col-span-12 md:col-span-5">
            <div className="p-6 flex items-center gap-5">
              <Ring value={game.progressToNext} size={92} stroke={8}>
                <div className="text-center leading-tight">
                  <div className="text-[10.5px] text-faint">Nivel</div>
                  <div className="font-display font-semibold text-[24px]">{game.level.n}</div>
                </div>
              </Ring>
              <div className="min-w-0">
                <div className="font-display font-semibold text-[19px]">{game.level.name}</div>
                <div className="text-muted text-[13px]">{num(game.xp)} XP{game.level.next ? ` · ${num(game.level.next - game.xp)} para el nivel ${game.level.n + 1}` : ' · nivel máximo'}</div>
                <div className="flex items-center gap-1.5 mt-3 text-[13px]"><Flame className={`size-4 ${game.streak.activeToday ? 'text-warn' : 'text-faint'}`} /> Racha {game.streak.current} día{game.streak.current !== 1 ? 's' : ''} · mejor {game.streak.best}</div>
              </div>
            </div>
          </Card>
          <div className="col-span-12 md:col-span-7 grid grid-cols-3 gap-3">
            <Metric label="Tiempo de estudio" value={t.minutes >= 60 ? `${(t.minutes / 60).toFixed(1)} h` : `${t.minutes} min`} />
            <Metric label="Lecciones" value={num(t.lessons)} />
            <Metric label="Preguntas" value={num(t.questions)} />
            <Metric label="Acierto" value={t.correctPct == null ? '—' : `${t.correctPct}%`} />
            <Metric label="Conceptos dominados" value={num(t.conceptsMastered)} />
            <Metric label="Temas dominados" value={`${t.topicsMastered}/${t.topicsMastered + t.topicsPending}`} />
          </div>

          <Card className="col-span-12 lg:col-span-6" title="Experiencia por día · 30 días">
            <div className="px-5 pb-4 pt-3"><Bars label="XP por día" data={stats.daily.map((d) => ({ label: dayLabel(d.day), hint: dayHint(d.day), value: d.xp }))} format={(v) => `${v} XP`} /></div>
          </Card>
          <Card className="col-span-12 lg:col-span-6" title="Minutos de estudio efectivo · 30 días">
            <div className="px-5 pb-4 pt-3"><Bars label="Minutos por día" data={stats.daily.map((d) => ({ label: dayLabel(d.day), hint: dayHint(d.day), value: d.minutes }))} format={(v) => `${v} min`} /></div>
          </Card>
          <Card className="col-span-12 lg:col-span-7" title="Evolución del rendimiento · % de acierto diario">
            <div className="px-5 pb-5 pt-4"><Line label="Acierto diario" data={stats.daily.map((d) => ({ label: dayHint(d.day), value: d.questions ? Math.round((d.correct / d.questions) * 100) : null }))} /></div>
          </Card>
          <Card className="col-span-12 lg:col-span-5" title="Acierto por tipo de pregunta">
            <div className="px-5 pb-4 pt-2 space-y-2.5">
              {stats.questionTypes.length ? stats.questionTypes.map((q) => (
                <div key={q.type}>
                  <div className="flex justify-between text-[12.5px]"><span>{TYPE_LABEL[q.type]}</span><span className="text-faint tabular-nums">{Math.round(q.accuracy * 100)}% · {q.answered}</span></div>
                  <ProgressBar value={q.accuracy} className="mt-1" />
                </div>
              )) : <p className="text-faint text-[12.5px]">Responde preguntas para ver tus fortalezas por tipo.</p>}
            </div>
          </Card>

          <Card className="col-span-12 lg:col-span-6" title="Temas">
            <div className="px-5 pb-4 pt-2 space-y-3">
              {stats.topics.length ? stats.topics.map((x) => (
                <div key={x.id}>
                  <div className="flex justify-between text-[13px]"><span className="font-medium truncate">{x.title}</span><span className="text-faint text-[12px] shrink-0">dominio {Math.round(x.mastery * 100)}%{x.accuracy != null ? ` · acierto ${Math.round(x.accuracy * 100)}%` : ''}</span></div>
                  <ProgressBar value={x.progress} className="mt-1" />
                </div>
              )) : <p className="text-faint text-[12.5px]">Sin temas todavía.</p>}
            </div>
          </Card>
          <Card className="col-span-12 lg:col-span-6" title="Historial de experiencia">
            <ul className="px-5 pb-4 pt-1 max-h-[260px] overflow-y-auto">
              {stats.xpLog.length ? stats.xpLog.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-1.5 text-[13px] border-b border-line last:border-0">
                  <Zap className="size-3.5 text-accent shrink-0" />
                  <span className="truncate flex-1">{e.reason}</span>
                  <span className="text-accent font-medium tabular-nums">+{e.amount}</span>
                  <span className="text-faint text-[11.5px] w-24 text-right shrink-0">{relativeTime(e.createdAt)}</span>
                </li>
              )) : <li className="text-faint text-[12.5px]">La experiencia llega al completar lecciones, aprobar evaluaciones y superar retos.</li>}
            </ul>
          </Card>

          <section className="col-span-12">
            <h2 className="font-display font-semibold text-[17px] mb-3 mt-2">Logros</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {game.achievements.map((a) => (
                <div key={a.code} className={`rounded-2xl border p-4 ${a.unlockedAt ? 'border-warn/40 bg-warn/[0.06]' : 'border-line bg-surface'}`}>
                  <div className={`size-9 rounded-xl grid place-items-center ${a.unlockedAt ? 'bg-warn/20 text-warn' : 'bg-raised text-faint'}`}>{a.unlockedAt ? <Award className="size-5" /> : <Lock className="size-4" />}</div>
                  <div className="font-medium text-[13.5px] mt-2.5">{a.name}</div>
                  <div className="text-faint text-[12px] leading-snug">{a.description}</div>
                  {a.unlockedAt ? (
                    <div className="text-[11.5px] text-warn mt-2">Desbloqueado {relativeTime(a.unlockedAt)}</div>
                  ) : (
                    <>
                      <ProgressBar value={a.progress.value / a.progress.target} className="mt-2.5" />
                      <div className="text-[11px] text-faint mt-1 tabular-nums">{num(a.progress.value)}/{num(a.progress.target)}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="font-display text-[22px] font-semibold tabular-nums leading-tight">{value}</div>
      <div className="text-faint text-[12px] mt-0.5">{label}</div>
    </div>
  );
}
