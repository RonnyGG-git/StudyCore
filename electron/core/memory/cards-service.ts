import type { CardInput, CardRating, Flashcard, Gen, ReviewOverview } from '../../../shared/learning';
import { fold } from '../assess/questions';
import { fail, type ClaudeGateway, type TaskContext } from '../claude/gateway';
import type { Db } from '../db/database';
import { addDays, localDay, XP, type GameService } from '../game/game-service';
import type { ActivityLog } from '../log/activity-log';
import { findConcept } from '../learning/concepts';
import type { LearningService } from '../learning/learning-service';
import { CardsSchema, TEACHER_SYSTEM } from '../learning/schemas';
import { formatSources } from '../tutor/prompts';

const DAY_MS = 86_400_000;
const MIN_EASE = 1.3;

export interface Schedule {
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  dueAt: Date;
}

/**
 * Repetición espaciada (variante de SM-2):
 *  1 «Otra vez» → reaprender en 10 min, baja la facilidad y cuenta como olvido;
 *  2 «Difícil» → intervalo ×1.2; 3 «Bien» → 1 d, 3 d, luego ×facilidad; 4 «Fácil» → más largo y sube la facilidad.
 */
export function schedule(card: { intervalDays: number; ease: number; reps: number; lapses: number }, rating: CardRating, now = new Date()): Schedule {
  let { intervalDays, ease, reps, lapses } = card;
  if (rating === 1) {
    lapses += 1;
    reps = 0;
    ease = Math.max(MIN_EASE, ease - 0.2);
    intervalDays = 10 / 1440;
  } else if (rating === 2) {
    ease = Math.max(MIN_EASE, ease - 0.15);
    intervalDays = Math.max(1, intervalDays * 1.2);
    reps += 1;
  } else if (rating === 3) {
    intervalDays = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(intervalDays + 1, intervalDays * ease);
    reps += 1;
  } else {
    intervalDays = reps === 0 ? 3 : Math.max(intervalDays + 2, intervalDays * ease * 1.3);
    ease += 0.15;
    reps += 1;
  }
  intervalDays = Math.min(365, intervalDays);
  return { intervalDays, ease, reps, lapses, dueAt: new Date(now.getTime() + intervalDays * DAY_MS) };
}

const SELECT = `SELECT f.id, f.topic_id AS topicId, t.title AS topicTitle, f.concept_id AS conceptId, c.name AS conceptName, f.front, f.back, f.explanation,
  f.category, f.difficulty, f.source_path AS sourcePath, f.source_heading AS sourceHeading, f.origin, f.due_at AS dueAt, f.interval_days AS intervalDays,
  f.reps, f.lapses, f.ease, f.last_reviewed_at AS lastReviewedAt
  FROM flashcards f LEFT JOIN topics t ON t.id = f.topic_id LEFT JOIN concepts c ON c.id = f.concept_id`;

export class CardsService {
  constructor(private db: Db, private gateway: ClaudeGateway, private game: GameService, private log: ActivityLog, private learning: LearningService) {}

  get(id: number): Flashcard | null {
    return this.db.get<Flashcard>(`${SELECT} WHERE f.id = ?`, id) ?? null;
  }

  list(topicId?: number | null): Flashcard[] {
    return this.db.all<Flashcard>(`${SELECT} ${topicId ? 'WHERE f.topic_id = ?' : ''} ORDER BY f.due_at LIMIT 1000`, ...(topicId ? [topicId] : []));
  }

  due(topicId?: number | null, limit = 50): Flashcard[] {
    const args: (string | number)[] = [new Date().toISOString()];
    if (topicId) args.push(topicId);
    return this.db.all<Flashcard>(`${SELECT} WHERE f.due_at <= ? ${topicId ? 'AND f.topic_id = ?' : ''} ORDER BY f.due_at LIMIT ?`, ...args, limit);
  }

  private validate(input: CardInput): string | null {
    if (!input.front.trim() || !input.back.trim()) return 'La tarjeta necesita frente y reverso.';
    if (input.front.length > 2000 || input.back.length > 4000) return 'La tarjeta es demasiado larga.';
    if (input.topicId && !this.db.get('SELECT 1 FROM topics WHERE id = ?', input.topicId)) return 'Tema no encontrado.';
    return null;
  }

  create(input: CardInput): Gen<Flashcard> {
    const err = this.validate(input);
    if (err) return fail(err);
    const id = this.db.run(
      "INSERT INTO flashcards (topic_id, front, back, explanation, category, difficulty, origin) VALUES (?,?,?,?,?,?,'manual')",
      input.topicId, input.front.trim(), input.back.trim(), input.explanation?.trim() ?? '', input.category?.trim() ?? '', Math.max(1, Math.min(3, input.difficulty ?? 2)),
    ).lastId;
    return { ok: true, value: this.get(id)! };
  }

  update(id: number, input: CardInput): Gen<Flashcard> {
    const err = this.validate(input);
    if (err) return fail(err);
    if (!this.get(id)) return fail('Tarjeta no encontrada.');
    this.db.run(
      'UPDATE flashcards SET topic_id = ?, front = ?, back = ?, explanation = ?, category = ?, difficulty = ? WHERE id = ?',
      input.topicId, input.front.trim(), input.back.trim(), input.explanation?.trim() ?? '', input.category?.trim() ?? '', Math.max(1, Math.min(3, input.difficulty ?? 2)), id,
    );
    return { ok: true, value: this.get(id)! };
  }

  delete(id: number) {
    this.db.run('DELETE FROM flashcards WHERE id = ?', id);
  }

  review(id: number, rating: CardRating): Flashcard {
    const c = this.get(id);
    if (!c) throw new Error('Tarjeta no encontrada.');
    const s = schedule(c, rating);
    this.db.tx(() => {
      this.db.run(
        `UPDATE flashcards SET interval_days = ?, ease = ?, reps = ?, lapses = ?, due_at = ?, last_reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
        s.intervalDays, s.ease, s.reps, s.lapses, s.dueAt.toISOString(), id,
      );
      this.db.run('INSERT INTO card_reviews (card_id, rating, interval_days) VALUES (?,?,?)', id, rating, s.intervalDays);
    });
    this.game.markActivity('card', { correct: rating >= 3 });
    // Bonificación por sesión real de repaso: 10 tarjetas repasadas en el día (una vez al día).
    const day = localDay();
    const today = this.db.get<{ n: number }>("SELECT COUNT(*) n FROM card_reviews WHERE date(reviewed_at, 'localtime') = ?", day)!.n;
    if (today >= 10) this.game.award('cards_session', 'cards_day', day, XP.cards_session, 'Sesión de repaso: 10 tarjetas en el día');
    return this.get(id)!;
  }

  overview(): ReviewOverview {
    const nowIso = new Date().toISOString();
    const today = localDay();
    const upcoming: { day: string; count: number }[] = [];
    const byDay = new Map(
      this.db.all<{ day: string; n: number }>("SELECT date(due_at, 'localtime') day, COUNT(*) n FROM flashcards WHERE due_at > ? GROUP BY 1", nowIso).map((r) => [r.day, r.n]),
    );
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i);
      upcoming.push({ day: d, count: byDay.get(d) ?? 0 });
    }
    return {
      due: this.db.get<{ n: number }>('SELECT COUNT(*) n FROM flashcards WHERE due_at <= ?', nowIso)!.n,
      total: this.db.get<{ n: number }>('SELECT COUNT(*) n FROM flashcards')!.n,
      learning: this.db.get<{ n: number }>('SELECT COUNT(*) n FROM flashcards WHERE reps < 2')!.n,
      // Lo que se está olvidando: conceptos con más «Otra vez» en los últimos 30 días.
      forgetting: this.db.all<any>(
        `SELECT f.concept_id AS conceptId, COALESCE(c.name, substr(f.front, 1, 60)) AS name, COUNT(*) AS lapses
           FROM card_reviews r JOIN flashcards f ON f.id = r.card_id LEFT JOIN concepts c ON c.id = f.concept_id
          WHERE r.rating = 1 AND r.reviewed_at >= datetime('now', '-30 days')
          GROUP BY COALESCE(f.concept_id, f.id) ORDER BY lapses DESC LIMIT 6`,
      ),
      upcoming,
    };
  }

  async generate(input: { topicId: number; lessonId?: number | null; count?: number }, ctx: TaskContext): Promise<Gen<{ created: number }>> {
    const t = this.db.get<{ id: number; title: string }>('SELECT id, title FROM topics WHERE id = ?', input.topicId);
    if (!t) return fail('Tema no encontrado.');
    const count = Math.max(3, Math.min(25, input.count ?? 10));
    const concepts = input.lessonId
      ? this.db.all<{ name: string; short_definition: string }>('SELECT c.name, c.short_definition FROM lesson_concepts lc JOIN concepts c ON c.id = lc.concept_id WHERE lc.lesson_id = ?', input.lessonId)
      : this.db.all<{ name: string; short_definition: string }>("SELECT name, short_definition FROM concepts WHERE topic_id = ? ORDER BY (status = 'not_studied'), mastery LIMIT 25", t.id);
    if (!concepts.length) return fail('Este tema aún no tiene conceptos. Completa el diagnóstico primero.');
    const existing = this.db.all<{ front: string }>('SELECT front FROM flashcards WHERE topic_id = ?', t.id).map((r) => r.front);
    const provided = this.learning.provided(t.id, `${concepts.map((c) => c.name).join(' ')} ${t.title}`, 8);
    const r = await this.gateway.run(
      {
        task: 'cards',
        schema: CardsSchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está creando tarjetas de memoria…',
        prompt: [
          `TEMA: ${t.title}. Crea ${count} tarjetas de memoria (pregunta en el frente, respuesta breve en el reverso, explicación adicional).`,
          'Una idea por tarjeta. Preguntas que obliguen a recordar activamente (no de sí/no). Indica el concepto exacto y el documento del vault que la respalda.',
          'CONCEPTOS:',
          ...concepts.map((c) => `- ${c.name}: ${c.short_definition}`),
          existing.length ? `YA EXISTEN (no las repitas):\n${existing.slice(0, 60).map((f) => `- ${f.slice(0, 100)}`).join('\n')}` : '',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].filter(Boolean).join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    const seen = new Set(existing.map(fold));
    let created = 0;
    this.db.tx(() => {
      for (const c of r.value.cards) {
        const key = fold(c.front);
        if (!c.front.trim() || !c.back.trim() || seen.has(key)) continue;
        seen.add(key);
        const indexed = c.path && this.db.get('SELECT 1 FROM vault_documents WHERE rel_path = ?', c.path.replace(/\\/g, '/'));
        this.db.run(
          "INSERT INTO flashcards (topic_id, concept_id, lesson_id, front, back, explanation, category, difficulty, source_path, source_heading, origin) VALUES (?,?,?,?,?,?,?,?,?,?,'claude')",
          t.id, findConcept(this.db, t.id, c.concept), input.lessonId ?? null, c.front.trim(), c.back.trim(), c.explanation, c.category || c.concept, c.difficulty,
          indexed ? c.path.replace(/\\/g, '/') : null, indexed ? c.heading : null,
        );
        created++;
      }
    });
    this.log.info('memoria', `${created} tarjetas creadas para «${t.title}»`);
    return { ok: true, value: { created } };
  }
}
