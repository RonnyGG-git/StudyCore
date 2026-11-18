import type { ContinueItem, Gen, Goal, GoalMetric, Home, PlannedSession, Recommendation } from '../../../shared/learning';
import type { QuizService } from '../assess/quiz-service';
import { fail, type ClaudeGateway, type TaskContext } from '../claude/gateway';
import type { Db } from '../db/database';
import { addDays, localDay, type GameService } from '../game/game-service';
import type { LearningService } from '../learning/learning-service';
import { RecommendSchema } from '../learning/schemas';
import type { CardsService } from '../memory/cards-service';

const METRIC_SQL: Record<GoalMetric, string> = {
  xp: "SELECT COALESCE(SUM(amount),0) v FROM xp_events WHERE date(created_at, 'localtime') BETWEEN ? AND ?",
  lessons: 'SELECT COALESCE(SUM(lessons),0) v FROM study_days WHERE day BETWEEN ? AND ?',
  questions: 'SELECT COALESCE(SUM(questions),0) v FROM study_days WHERE day BETWEEN ? AND ?',
  minutes: 'SELECT COALESCE(SUM(active_seconds),0) / 60 v FROM study_days WHERE day BETWEEN ? AND ?',
  cards: 'SELECT COALESCE(SUM(cards),0) v FROM study_days WHERE day BETWEEN ? AND ?',
};

export function weekStart(day: string): string {
  const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // lunes = 0
  return addDays(day, -dow);
}

export class PlannerService {
  constructor(
    private db: Db,
    private gateway: ClaudeGateway,
    private game: GameService,
    private learning: LearningService,
    private cards: CardsService,
    private quiz: QuizService,
  ) {}

  /* ───────── Objetivos ───────── */

  goals(): Goal[] {
    const today = localDay();
    return this.db.all<{ id: number; period: 'daily' | 'weekly'; metric: GoalMetric; target: number }>('SELECT id, period, metric, target FROM goals ORDER BY period, metric').map((g) => {
      const from = g.period === 'daily' ? today : weekStart(today);
      const current = Math.floor(Number(this.db.get<{ v: number }>(METRIC_SQL[g.metric], from, today)!.v));
      return { ...g, current, done: current >= g.target };
    });
  }

  saveGoal(g: { id?: number; period: 'daily' | 'weekly'; metric: GoalMetric; target: number }): Goal[] {
    this.db.run('INSERT INTO goals (period, metric, target) VALUES (?,?,?) ON CONFLICT(period, metric) DO UPDATE SET target = excluded.target', g.period, g.metric, Math.max(1, Math.round(g.target)));
    return this.goals();
  }

  deleteGoal(id: number): Goal[] {
    this.db.run('DELETE FROM goals WHERE id = ?', id);
    return this.goals();
  }

  /* ───────── Sesiones planificadas ───────── */

  sessions(from: string, to: string): PlannedSession[] {
    return this.db.all<PlannedSession>(
      `SELECT s.id, s.topic_id AS topicId, t.title AS topicTitle, s.title, s.date, s.minutes, s.status, s.notes
         FROM planned_sessions s LEFT JOIN topics t ON t.id = s.topic_id WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.id`, from, to,
    );
  }

  saveSession(s: { id?: number; topicId: number | null; title: string; date: string; minutes: number; status?: PlannedSession['status']; notes?: string }): PlannedSession {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) throw new Error('Fecha no válida.');
    const title = s.title.trim().slice(0, 160) || 'Sesión de estudio';
    const minutes = Math.max(5, Math.min(600, Math.round(s.minutes)));
    let id = s.id;
    if (id) {
      this.db.run('UPDATE planned_sessions SET topic_id = ?, title = ?, date = ?, minutes = ?, status = ?, notes = ? WHERE id = ?', s.topicId, title, s.date, minutes, s.status ?? 'planned', s.notes ?? '', id);
    } else {
      id = this.db.run('INSERT INTO planned_sessions (topic_id, title, date, minutes, status, notes) VALUES (?,?,?,?,?,?)', s.topicId, title, s.date, minutes, s.status ?? 'planned', s.notes ?? '').lastId;
    }
    return this.sessions(s.date, s.date).find((x) => x.id === id)!;
  }

  deleteSession(id: number) {
    this.db.run('DELETE FROM planned_sessions WHERE id = ?', id);
  }

  stats() {
    const today = localDay();
    const r = this.db.get<{ planned: number; done: number; skipped: number; overdue: number }>(
      "SELECT SUM(status = 'planned' AND date >= ?) planned, SUM(status = 'done') done, SUM(status = 'skipped') skipped, SUM(status = 'planned' AND date < ?) overdue FROM planned_sessions",
      today, today,
    )!;
    const closed = (r.done ?? 0) + (r.skipped ?? 0) + (r.overdue ?? 0);
    const ws = weekStart(today);
    const weekGoal = this.db.get<{ target: number }>("SELECT target FROM goals WHERE period = 'weekly' AND metric = 'minutes'");
    return {
      planned: r.planned ?? 0,
      done: r.done ?? 0,
      skipped: (r.skipped ?? 0) + (r.overdue ?? 0),
      compliance: closed ? (r.done ?? 0) / closed : null,
      weekMinutes: Math.floor(Number(this.db.get<{ v: number }>(METRIC_SQL.minutes, ws, today)!.v)),
      weekGoalMinutes: weekGoal?.target ?? null,
    };
  }

  /* ───────── Recomendaciones ───────── */

  /** Recomendador determinista (sin coste): repasos vencidos, refuerzos respetando prerrequisitos, siguiente paso de la ruta. */
  recommendations(): Recommendation[] {
    const out: Recommendation[] = [];
    const db = this.db;
    for (const t of db.all<{ id: number; title: string; aid: number }>(
      "SELECT t.id, t.title, (SELECT id FROM assessments a WHERE a.topic_id = t.id AND a.kind = 'diagnostic' ORDER BY id DESC LIMIT 1) aid FROM topics t WHERE t.status = 'diagnosing'",
    )) {
      if (t.aid) out.push({ action: 'diagnostic', title: `Termina el diagnóstico de «${t.title}»`, reason: 'Sin diagnóstico no hay ruta personalizada.', minutes: 10, topicId: t.id, targetId: t.aid, source: 'sistema' });
    }
    const due = this.cards.overview().due;
    if (due) out.push({ action: 'review_cards', title: `Repasa ${due} tarjeta${due > 1 ? 's' : ''}`, reason: 'Toca repasarlas hoy para no olvidarlas.', minutes: Math.max(3, Math.ceil(due * 0.4)), topicId: null, targetId: null, source: 'sistema' });

    const weak = db.all<{ id: number; name: string; topic_id: number; mastery: number; fail_streak: number }>(
      'SELECT id, name, topic_id, mastery, fail_streak FROM concepts WHERE attempts >= 2 AND (fail_streak >= 2 OR mastery < 0.45) ORDER BY fail_streak DESC, mastery LIMIT 4',
    );
    const added = new Set<number>();
    for (const c of weak) {
      // No se recomienda lo avanzado si falla un fundamento: primero el prerrequisito.
      const pre = db.get<{ id: number; name: string }>(
        "SELECT p.id, p.name FROM concept_relations r JOIN concepts p ON p.id = r.related_id WHERE r.concept_id = ? AND r.kind = 'prerequisite' AND p.status IN ('not_studied','learning') ORDER BY p.mastery LIMIT 1", c.id,
      );
      const target = pre ?? c;
      if (added.has(target.id)) continue;
      added.add(target.id);
      out.push({
        action: 'reinforce_concept',
        title: `Refuerza «${target.name}»`,
        reason: pre ? `Fallas «${c.name}» y su base, «${pre.name}», aún no está consolidada.` : c.fail_streak >= 2 ? `Has fallado ${c.fail_streak} veces seguidas.` : `Tu dominio es del ${Math.round(c.mastery * 100)}%.`,
        minutes: 10,
        topicId: c.topic_id,
        targetId: target.id,
        source: 'sistema',
      });
    }
    for (const m of db.all<{ id: number; title: string; topic_id: number }>(
      `SELECT m.id, m.title, m.topic_id FROM modules m WHERE m.status <> 'completed' AND m.status <> 'locked'
         AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.module_id = m.id AND l.status <> 'completed') AND EXISTS (SELECT 1 FROM lessons l WHERE l.module_id = m.id)`,
    )) {
      out.push({ action: 'module_quiz', title: `Evaluación del módulo «${m.title}»`, reason: 'Ya completaste sus lecciones: apruébala para desbloquear el siguiente.', minutes: 15, topicId: m.topic_id, targetId: m.id, source: 'sistema' });
    }
    for (const l of db.all<{ id: number; title: string; topic_id: number; status: string; topic: string }>(
      `SELECT l.id, l.title, m.topic_id, l.status, t.title AS topic FROM lessons l JOIN modules m ON m.id = l.module_id JOIN topics t ON t.id = m.topic_id
        WHERE l.status IN ('in_progress','available') ORDER BY l.status = 'in_progress' DESC, COALESCE(l.opened_at, '') DESC, m.ord, l.ord LIMIT 3`,
    )) {
      out.push({ action: 'lesson', title: `${l.status === 'in_progress' ? 'Continúa' : 'Empieza'} «${l.title}»`, reason: `Siguiente paso de tu ruta de ${l.topic}.`, minutes: 15, topicId: l.topic_id, targetId: l.id, source: 'sistema' });
    }
    const ch = db.get<{ id: number; title: string; topic_id: number }>("SELECT id, title, topic_id FROM challenges WHERE status = 'open' AND solution <> '' ORDER BY id DESC LIMIT 1");
    if (ch) out.push({ action: 'challenge', title: `Intenta el reto «${ch.title}»`, reason: 'Aplicar lo aprendido a un problema consolida el conocimiento.', minutes: 25, topicId: ch.topic_id, targetId: ch.id, source: 'sistema' });
    if (!out.length) out.push({ action: 'new_topic', title: 'Empieza un tema nuevo', reason: 'No tienes nada pendiente: elige qué aprender a continuación.', minutes: 10, topicId: null, targetId: null, source: 'sistema' });
    return out.slice(0, 6);
  }

  /** Recomendación personalizada de Claude según debilidades, objetivos y el tiempo disponible. */
  async recommendWithClaude(minutes: number, ctx: TaskContext): Promise<Gen<Recommendation[]>> {
    const db = this.db;
    if (!db.get('SELECT 1 FROM topics')) return fail('Crea primero un tema de estudio.');
    const topics = this.learning.listTopics().map((t) => `- [topic ${t.id}] ${t.title}: ${Math.round(t.progress * 100)}% lecciones, nivel ${t.level ?? '-'}, estado ${t.status}`);
    const lessons = db.all<any>(
      "SELECT l.id, l.title, l.status, m.topic_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.status IN ('available','in_progress') LIMIT 15",
    ).map((l) => `- [lesson ${l.id}] (topic ${l.topic_id}) ${l.title} · ${l.status}`);
    const weak = db.all<any>('SELECT id, name, topic_id, mastery, fail_streak FROM concepts WHERE attempts > 0 ORDER BY mastery LIMIT 10').map(
      (c) => `- [concept ${c.id}] (topic ${c.topic_id}) ${c.name}: dominio ${Math.round(c.mastery * 100)}%, fallos seguidos ${c.fail_streak}`,
    );
    const modules = db.all<any>("SELECT id, title, topic_id FROM modules WHERE status IN ('available','in_progress')").map((m) => `- [module ${m.id}] (topic ${m.topic_id}) ${m.title}`);
    const challenges = db.all<any>("SELECT id, title, topic_id FROM challenges WHERE status = 'open'").map((c) => `- [challenge ${c.id}] (topic ${c.topic_id}) ${c.title}`);
    const goals = this.goals().map((g) => `- ${g.period} ${g.metric}: ${g.current}/${g.target}`);
    const r = await this.gateway.run(
      {
        task: 'recommend',
        schema: RecommendSchema,
        system: 'Eres el planificador de estudio de StudyCore. Recomiendas qué estudiar ahora con criterio pedagógico: primero lo que bloquea (prerrequisitos, repasos vencidos), luego avanzar. Responde en español.',
        label: 'Claude está planificando tu sesión…',
        prompt: [
          `TIEMPO DISPONIBLE: ${minutes} minutos. Reparte el tiempo en 1-4 acciones que sumen como máximo eso.`,
          `TARJETAS PARA REPASAR HOY: ${this.cards.overview().due}`,
          `RACHA: ${this.game.streak().current} días`,
          'TEMAS:', ...topics,
          'LECCIONES DISPONIBLES:', ...(lessons.length ? lessons : ['(ninguna)']),
          'CONCEPTOS EVALUADOS (menor dominio primero):', ...(weak.length ? weak : ['(ninguno)']),
          'MÓDULOS ABIERTOS:', ...(modules.length ? modules : ['(ninguno)']),
          'RETOS ABIERTOS:', ...(challenges.length ? challenges : ['(ninguno)']),
          'OBJETIVOS:', ...(goals.length ? goals : ['(sin objetivos)']),
          'Usa solo ids de las listas. target_id: lesson→id de lección, reinforce_concept→id de concepto, module_quiz→id de módulo, challenge→id de reto; review_cards y tutor sin target_id (tutor con topic_id).',
        ].join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    const exists = (table: string, id: number | null) => id != null && !!db.get(`SELECT 1 FROM ${table} WHERE id = ?`, id);
    const valid = r.value.recommendations.filter((x) => {
      switch (x.action) {
        case 'lesson': return exists('lessons', x.target_id);
        case 'reinforce_concept': return exists('concepts', x.target_id);
        case 'module_quiz': return exists('modules', x.target_id);
        case 'challenge': return exists('challenges', x.target_id);
        case 'tutor':
        case 'diagnostic': return exists('topics', x.topic_id);
        default: return true;
      }
    });
    if (!valid.length) return { ok: false, errorKind: 'invalid_output', error: 'La recomendación no hacía referencia a elementos reales. Inténtalo de nuevo.' };
    return { ok: true, value: valid.map((x) => ({ action: x.action, title: x.title, reason: x.reason, minutes: x.minutes, topicId: x.topic_id, targetId: x.target_id, source: 'claude' as const })) };
  }

  /* ───────── Dashboard ───────── */

  continueItem(): ContinueItem | null {
    const db = this.db;
    const cands: (ContinueItem & { at: string })[] = [];
    const l = db.get<any>(
      `SELECT l.id, l.title, l.current_unit, l.content, l.opened_at, t.title AS topic FROM lessons l JOIN modules m ON m.id = l.module_id JOIN topics t ON t.id = m.topic_id
        WHERE l.status = 'in_progress' AND l.opened_at IS NOT NULL ORDER BY l.opened_at DESC LIMIT 1`,
    );
    if (l) {
      const n = l.content ? JSON.parse(l.content).length : 1;
      cands.push({ kind: 'lesson', id: l.id, title: l.title, subtitle: `${l.topic} · unidad ${l.current_unit + 1} de ${n}`, progress: (l.current_unit + 1) / n, at: l.opened_at });
    }
    const a = db.get<any>(
      `SELECT a.id, a.title, a.kind, a.created_at, (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id) n,
              (SELECT COUNT(*) FROM questions q JOIN answers x ON x.question_id = q.id WHERE q.assessment_id = a.id) done
         FROM assessments a WHERE a.status = 'in_progress' AND a.kind NOT IN ('lesson_check') ORDER BY a.id DESC LIMIT 1`,
    );
    if (a) cands.push({ kind: a.kind === 'diagnostic' ? 'diagnostic' : 'assessment', id: a.id, title: a.title, subtitle: `${a.done} de ${a.n} preguntas respondidas`, progress: a.n ? a.done / a.n : 0, at: a.created_at });
    const c = db.get<any>("SELECT id, title, updated_at, kind FROM conversations WHERE kind IN ('ask','tutor') ORDER BY updated_at DESC LIMIT 1");
    if (c && !cands.length) cands.push({ kind: 'conversation', id: c.id, title: c.title, subtitle: c.kind === 'tutor' ? 'Conversación con el tutor' : 'Consulta al vault', progress: 1, at: c.updated_at });
    cands.sort((x, y) => (x.at < y.at ? 1 : -1));
    if (!cands.length) return null;
    const { at: _at, ...item } = cands[0];
    return item;
  }

  home(): Home {
    const today = localDay();
    const week = this.game.daily(7);
    const t = week[week.length - 1];
    return {
      game: this.game.state(),
      continue: this.continueItem(),
      topics: this.learning.listTopics().filter((x) => x.status !== 'mastered').slice(0, 4),
      review: this.cards.overview(),
      goals: this.goals(),
      recommendations: this.recommendations().slice(0, 4),
      recentAssessments: this.quiz.list().filter((a) => a.finishedAt).slice(0, 4),
      today: { minutes: t?.day === today ? t.minutes : 0, xp: t?.day === today ? t.xp : 0, questions: t?.day === today ? t.questions : 0 },
      week,
    };
  }
}
