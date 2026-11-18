import type { AchievementView, DailyStat, GameState, LevelInfo, QuestionType, Reward, Stats } from '../../../shared/learning';
import type { Db } from '../db/database';
import type { ActivityLog } from '../log/activity-log';

/** Recompensas: cada una ligada a un evento real y verificable, cobrable una sola vez. */
export const XP = {
  diagnostic_complete: 15,
  lesson_complete: 20,
  quiz_pass: 30,
  quiz_excellent: 50,
  module_complete: 100,
  topic_mastered: 200,
  challenge_complete: 75,
  cards_session: 15,
} as const;

export const STREAK_BONUS: Record<number, number> = { 3: 25, 7: 60, 14: 120, 30: 250 };

/** Progresión creciente (~×1.6–2 por nivel): los primeros niveles llegan pronto, los últimos exigen constancia. */
export const LEVELS: { n: number; name: string; min: number }[] = [
  { n: 1, name: 'Principiante', min: 0 },
  { n: 2, name: 'Aprendiz', min: 150 },
  { n: 3, name: 'Explorador', min: 450 },
  { n: 4, name: 'Estudiante avanzado', min: 1000 },
  { n: 5, name: 'Especialista', min: 2000 },
  { n: 6, name: 'Experto', min: 3500 },
  { n: 7, name: 'Maestro', min: 6000 },
];

export function levelFor(xp: number): LevelInfo {
  let i = 0;
  while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1].min) i++;
  return { ...LEVELS[i], next: LEVELS[i + 1]?.min ?? null };
}

interface AchievementDef {
  code: string;
  name: string;
  description: string;
  target: number;
  sql: string;
}

const ACHIEVEMENTS: AchievementDef[] = [
  { code: 'first_lesson', name: 'Primer paso', description: 'Completa tu primera lección.', target: 1, sql: "SELECT COUNT(*) v FROM lessons WHERE status = 'completed'" },
  { code: 'first_exam', name: 'Examen superado', description: 'Aprueba tu primer examen o evaluación de módulo.', target: 1, sql: "SELECT COUNT(*) v FROM assessments WHERE passed = 1 AND (mode = 'exam' OR kind = 'module_quiz')" },
  { code: 'concepts_10', name: 'Diez conceptos dominados', description: 'Lleva 10 conceptos al estado «Dominado».', target: 10, sql: "SELECT COUNT(*) v FROM concepts WHERE status = 'mastered'" },
  { code: 'streak_5', name: 'Constancia', description: 'Estudia 5 días seguidos.', target: 5, sql: '' },
  { code: 'first_module', name: 'Módulo completo', description: 'Completa tu primer módulo.', target: 1, sql: "SELECT COUNT(*) v FROM modules WHERE status = 'completed'" },
  { code: 'questions_100', name: 'Cien respuestas', description: 'Responde 100 preguntas.', target: 100, sql: "SELECT COUNT(*) v FROM answers WHERE verdict <> 'pendiente'" },
  { code: 'first_topic', name: 'Tema dominado', description: 'Domina tu primer tema completo.', target: 1, sql: "SELECT COUNT(*) v FROM topics WHERE status = 'mastered'" },
  { code: 'xp_1000', name: 'Mil de experiencia', description: 'Acumula 1000 XP.', target: 1000, sql: 'SELECT COALESCE(SUM(amount),0) v FROM xp_events' },
  { code: 'first_challenge', name: 'Reto superado', description: 'Supera tu primer reto práctico.', target: 1, sql: "SELECT COUNT(*) v FROM challenges WHERE status = 'completed'" },
  { code: 'cards_100', name: 'Memoria entrenada', description: 'Repasa 100 tarjetas.', target: 100, sql: 'SELECT COUNT(*) v FROM card_reviews' },
];

export type ActivityKind = 'lesson' | 'question' | 'card' | 'challenge';

export function localDay(d = new Date()): string {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export class GameService {
  /** El proceso principal lo conecta para mostrar las recompensas en la interfaz. */
  onReward: (r: Reward) => void = () => {};

  constructor(private db: Db, private log: ActivityLog, private today: () => string = () => localDay()) {}

  xp(): number {
    return this.db.get<{ v: number }>('SELECT COALESCE(SUM(amount),0) v FROM xp_events')!.v;
  }

  /** Otorga XP si ese evento concreto no se había premiado ya. Devuelve la recompensa o null. */
  award(kind: keyof typeof XP | 'streak', refType: string, refId: string | number, amount: number, reason: string): Reward | null {
    const before = levelFor(this.xp());
    const r = this.db.run('INSERT OR IGNORE INTO xp_events (kind, ref_type, ref_id, amount, reason) VALUES (?,?,?,?,?)', kind, refType, String(refId), amount, reason);
    if (!r.changes) return null;
    const after = levelFor(this.xp());
    const reward: Reward = {
      xp: amount,
      reason,
      levelUp: after.n > before.n ? { n: after.n, name: after.name } : null,
      achievements: this.checkAchievements(),
    };
    this.log.info('progreso', `+${amount} XP · ${reason}`);
    if (reward.levelUp) this.log.info('progreso', `¡Nivel ${after.n}: ${after.name}!`);
    this.onReward(reward);
    return reward;
  }

  /** Registra actividad de estudio real del día (no el tiempo con la app abierta). */
  markActivity(kind: ActivityKind, opts: { correct?: boolean } = {}) {
    const day = this.today();
    const col = { lesson: 'lessons', question: 'questions', card: 'cards', challenge: 'challenges' }[kind];
    this.db.run(`INSERT INTO study_days (day, ${col}, correct, qualified) VALUES (?, 1, ?, 1)
                 ON CONFLICT(day) DO UPDATE SET ${col} = ${col} + 1, correct = correct + excluded.correct, qualified = 1`, day, opts.correct ? 1 : 0);
    this.checkStreakBonus();
    const ach = this.checkAchievements();
    if (ach.length) this.onReward({ xp: 0, reason: 'Logro desbloqueado', levelUp: null, achievements: ach });
  }

  addStudyTime(seconds: number) {
    const s = Math.max(0, Math.min(120, Math.round(seconds)));
    if (!s) return;
    this.db.run('INSERT INTO study_days (day, active_seconds) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET active_seconds = active_seconds + excluded.active_seconds', this.today(), s);
  }

  streak(): GameState['streak'] {
    const days = new Set(this.db.all<{ day: string }>('SELECT day FROM study_days WHERE qualified = 1').map((r) => r.day));
    const today = this.today();
    const activeToday = days.has(today);
    let current = 0;
    for (let d = activeToday ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) current++;
    let best = 0;
    for (const d of days) {
      if (days.has(addDays(d, -1))) continue;
      let n = 0;
      for (let x = d; days.has(x); x = addDays(x, 1)) n++;
      best = Math.max(best, n);
    }
    return { current, best, activeToday };
  }

  private checkStreakBonus() {
    const { current } = this.streak();
    const start = addDays(this.today(), -(current - 1));
    for (const [milestone, amount] of Object.entries(STREAK_BONUS)) {
      if (current >= Number(milestone)) this.award('streak', `streak:${start}`, milestone, amount, `Racha de ${milestone} días de estudio`);
    }
  }

  private achievementValue(a: AchievementDef): number {
    if (a.code === 'streak_5') return this.streak().best;
    return Number(this.db.get<{ v: number }>(a.sql)!.v ?? 0);
  }

  checkAchievements(): { code: string; name: string }[] {
    const unlocked = new Set(this.db.all<{ code: string }>('SELECT code FROM user_achievements').map((r) => r.code));
    const fresh: { code: string; name: string }[] = [];
    for (const a of ACHIEVEMENTS) {
      if (unlocked.has(a.code) || this.achievementValue(a) < a.target) continue;
      this.db.run('INSERT OR IGNORE INTO user_achievements (code) VALUES (?)', a.code);
      fresh.push({ code: a.code, name: a.name });
      this.log.info('progreso', `Logro desbloqueado: ${a.name}`);
    }
    return fresh;
  }

  achievements(): AchievementView[] {
    const unlocked = new Map(this.db.all<{ code: string; unlocked_at: string }>('SELECT code, unlocked_at FROM user_achievements').map((r) => [r.code, r.unlocked_at]));
    return ACHIEVEMENTS.map((a) => ({
      code: a.code,
      name: a.name,
      description: a.description,
      unlockedAt: unlocked.get(a.code) ?? null,
      progress: { value: Math.min(a.target, this.achievementValue(a)), target: a.target },
    }));
  }

  state(): GameState {
    const xp = this.xp();
    const level = levelFor(xp);
    return {
      xp,
      level,
      progressToNext: level.next == null ? 1 : (xp - level.min) / (level.next - level.min),
      streak: this.streak(),
      achievements: this.achievements(),
    };
  }

  daily(days: number): DailyStat[] {
    const from = addDays(this.today(), -(days - 1));
    const rows = new Map(this.db.all<any>('SELECT * FROM study_days WHERE day >= ?', from).map((r) => [r.day, r]));
    const xp = new Map(
      this.db.all<{ day: string; xp: number }>("SELECT date(created_at, 'localtime') day, SUM(amount) xp FROM xp_events GROUP BY 1 HAVING day >= ?", from).map((r) => [r.day, r.xp]),
    );
    const out: DailyStat[] = [];
    for (let i = 0; i < days; i++) {
      const day = addDays(from, i);
      const r = rows.get(day);
      out.push({ day, xp: xp.get(day) ?? 0, minutes: Math.round((r?.active_seconds ?? 0) / 60), questions: r?.questions ?? 0, correct: r?.correct ?? 0, lessons: r?.lessons ?? 0, cards: r?.cards ?? 0 });
    }
    return out;
  }

  stats(): Stats {
    const one = <T = number>(sql: string): T => Object.values(this.db.get(sql) ?? { v: 0 })[0] as T;
    const answered = one<number>("SELECT COUNT(*) FROM answers WHERE verdict <> 'pendiente'");
    const correct = one<number>("SELECT COALESCE(SUM(score),0) FROM answers WHERE verdict <> 'pendiente'");
    const topics = this.db.all<{ id: number; title: string; lessons: number; done: number; mastery: number | null; acc: number | null }>(
      `SELECT t.id, t.title,
              (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.topic_id = t.id) lessons,
              (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.topic_id = t.id AND l.status = 'completed') done,
              (SELECT AVG(mastery) FROM concepts c WHERE c.topic_id = t.id) mastery,
              (SELECT AVG(a.score) FROM answers a JOIN questions q ON q.id = a.question_id JOIN assessments s ON s.id = q.assessment_id
                WHERE s.topic_id = t.id AND a.verdict <> 'pendiente') acc
         FROM topics t ORDER BY t.updated_at DESC`,
    );
    return {
      totals: {
        xp: this.xp(),
        minutes: Math.round(one<number>('SELECT COALESCE(SUM(active_seconds),0) FROM study_days') / 60),
        lessons: one("SELECT COUNT(*) FROM lessons WHERE status = 'completed'"),
        questions: answered,
        correctPct: answered ? Math.round((correct / answered) * 100) : null,
        topicsMastered: one("SELECT COUNT(*) FROM topics WHERE status = 'mastered'"),
        topicsPending: one("SELECT COUNT(*) FROM topics WHERE status <> 'mastered'"),
        cardsReviewed: one('SELECT COUNT(*) FROM card_reviews'),
        challengesCompleted: one("SELECT COUNT(*) FROM challenges WHERE status = 'completed'"),
        conceptsMastered: one("SELECT COUNT(*) FROM concepts WHERE status = 'mastered'"),
      },
      streak: this.streak(),
      daily: this.daily(30),
      topics: topics.map((t) => ({ id: t.id, title: t.title, progress: t.lessons ? t.done / t.lessons : 0, mastery: t.mastery ?? 0, accuracy: t.acc })),
      questionTypes: this.db
        .all<{ type: QuestionType; n: number; acc: number }>("SELECT q.type, COUNT(*) n, AVG(a.score) acc FROM answers a JOIN questions q ON q.id = a.question_id WHERE a.verdict <> 'pendiente' GROUP BY q.type ORDER BY n DESC")
        .map((r) => ({ type: r.type, answered: r.n, accuracy: r.acc })),
      xpLog: this.db.all<any>('SELECT id, kind, reason, amount, created_at AS createdAt FROM xp_events ORDER BY id DESC LIMIT 25'),
    };
  }
}
