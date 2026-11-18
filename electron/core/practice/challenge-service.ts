import type { ChallengeAttempt, ChallengeSummary, ChallengeView, Gen, Level } from '../../../shared/learning';
import { fail, type ClaudeGateway, type TaskContext } from '../claude/gateway';
import type { Db } from '../db/database';
import type { GameService } from '../game/game-service';
import type { ActivityLog } from '../log/activity-log';
import type { LearningService } from '../learning/learning-service';
import { ChallengeEvalSchema, ChallengeSchema, LEVEL_GUIDE, TEACHER_SYSTEM } from '../learning/schemas';
import { formatSources } from '../tutor/prompts';

const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export class ChallengeService {
  constructor(private db: Db, private gateway: ClaudeGateway, private game: GameService, private log: ActivityLog, private learning: LearningService) {}

  list(topicId?: number | null): ChallengeSummary[] {
    return this.db
      .all<any>(
        `SELECT c.id, t.title AS topicTitle, c.title, c.level, c.xp, c.status, c.is_final AS isFinalProject,
                (SELECT COUNT(*) FROM challenge_attempts a WHERE a.challenge_id = c.id) AS attempts
           FROM challenges c JOIN topics t ON t.id = c.topic_id ${topicId ? 'WHERE c.topic_id = ?' : ''} ORDER BY c.status = 'completed', c.id DESC`,
        ...(topicId ? [topicId] : []),
      )
      .map((r) => ({ ...r, isFinalProject: !!r.isFinalProject }));
  }

  get(id: number): ChallengeView | null {
    const c = this.db.get<any>('SELECT c.*, t.title AS topic_title FROM challenges c JOIN topics t ON t.id = c.topic_id WHERE c.id = ?', id);
    if (!c) return null;
    const hints: string[] = JSON.parse(c.hints);
    const attempts = this.db.all<any>('SELECT * FROM challenge_attempts WHERE challenge_id = ? ORDER BY id', id).map<ChallengeAttempt>((a) => {
      const e = JSON.parse(a.evaluation);
      return { id: a.id, response: a.response, passed: !!a.passed, score: a.score, criteria: e.criteria, feedback: e.feedback_markdown, nextSteps: e.next_steps, createdAt: a.created_at };
    });
    const solutionVisible = c.status === 'completed' || !!c.solution_revealed;
    return {
      id: c.id,
      topicId: c.topic_id,
      topicTitle: c.topic_title,
      title: c.title,
      description: c.description,
      objectives: JSON.parse(c.objectives),
      level: c.level,
      hintsTotal: hints.length,
      // Pistas progresivas: solo viajan a la interfaz las ya reveladas; la solución, solo al superarlo o al rendirse.
      hints: hints.slice(0, c.hints_revealed),
      criteria: JSON.parse(c.criteria),
      xp: c.xp,
      status: c.status,
      isFinalProject: !!c.is_final,
      solution: solutionVisible && c.solution ? c.solution : null,
      solutionRevealed: !!c.solution_revealed,
      canRevealSolution: c.status !== 'completed' && !c.solution_revealed && attempts.length >= 1 && !!c.solution,
      attempts,
      createdAt: c.created_at,
    };
  }

  async create(input: { topicId: number; moduleId?: number | null; focus?: string }, ctx: TaskContext): Promise<Gen<ChallengeView>> {
    const t = this.db.get<{ id: number; title: string; level: Level | null; difficulty: number; status: string }>('SELECT id, title, level, difficulty, status FROM topics WHERE id = ?', input.topicId);
    if (!t) return fail('Tema no encontrado.');
    if (t.status === 'diagnosing') return fail('Completa primero el diagnóstico del tema.');
    const m = input.moduleId ? this.db.get<{ title: string; objective: string }>('SELECT title, objective FROM modules WHERE id = ? AND topic_id = ?', input.moduleId, t.id) : null;
    const concepts = this.db
      .all<{ name: string; status: string }>(
        m
          ? 'SELECT DISTINCT c.name, c.status FROM lesson_concepts lc JOIN lessons l ON l.id = lc.lesson_id JOIN concepts c ON c.id = lc.concept_id WHERE l.module_id = ?'
          : "SELECT name, status FROM concepts WHERE topic_id = ? ORDER BY status = 'not_studied', mastery DESC LIMIT 15",
        m ? input.moduleId! : t.id,
      );
    const provided = this.learning.provided(t.id, `${input.focus ?? ''} ${m?.title ?? ''} ${t.title}`, 6);
    const r = await this.gateway.run(
      {
        task: 'challenge',
        schema: ChallengeSchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está diseñando tu reto…',
        prompt: [
          `TEMA: ${t.title} · ${LEVEL_GUIDE[t.level ?? 'principiante']}`,
          m ? `MÓDULO: ${m.title} — ${m.objective}` : '',
          input.focus ? `ENFOQUE PEDIDO: ${input.focus}` : '',
          `CONCEPTOS DISPONIBLES: ${concepts.map((c) => `${c.name} (${c.status})`).join(', ')}`,
          'Diseña un RETO PRÁCTICO basado en problemas, acorde al tema: programación → construir una funcionalidad; SQL → resolver consultas;',
          'redes → diseñar una topología; ciberseguridad → analizar un escenario; matemáticas → resolver problemas; idiomas → ejercicios y diálogos.',
          'Incluye descripción, objetivos, nivel, 3 pistas progresivas (ninguna da la solución), criterios de evaluación verificables y la solución explicada.',
          'El estudiante responderá con texto (código, consultas, diseño o razonamiento).',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].filter(Boolean).join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    const c = r.value;
    const id = this.db.run(
      'INSERT INTO challenges (topic_id, module_id, title, description, objectives, level, hints, criteria, solution, xp) VALUES (?,?,?,?,?,?,?,?,?,75)',
      t.id, input.moduleId ?? null, c.title, c.description_markdown, JSON.stringify(c.objectives), c.level, JSON.stringify(c.hints), JSON.stringify(c.criteria), c.solution_markdown,
    ).lastId;
    this.log.info('práctica', `Nuevo reto: «${c.title}»`);
    return { ok: true, value: this.get(id)! };
  }

  /** El proyecto final se crea con la ruta; las pistas y la solución se preparan al abrirlo por primera vez. */
  async prepareFinal(id: number, ctx: TaskContext): Promise<Gen<ChallengeView>> {
    const c = this.db.get<any>('SELECT c.*, t.title AS topic_title, t.level FROM challenges c JOIN topics t ON t.id = c.topic_id WHERE c.id = ?', id);
    if (!c) return fail('Reto no encontrado.');
    if (c.solution) return { ok: true, value: this.get(id)! };
    const provided = this.learning.provided(c.topic_id, `${c.title} ${c.topic_title}`, 6);
    const r = await this.gateway.run(
      {
        task: 'challenge',
        schema: ChallengeSchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está preparando el proyecto final…',
        prompt: [
          `TEMA: ${c.topic_title} · ${LEVEL_GUIDE[(c.level ?? 'principiante') as Level]}`,
          `Desarrolla este PROYECTO FINAL manteniendo su título y propósito: «${c.title}»`,
          c.description,
          `Objetivos: ${JSON.parse(c.objectives).join('; ')} · Criterios: ${JSON.parse(c.criteria).join('; ')}`,
          'Completa la descripción con detalle, 3 pistas progresivas, criterios verificables y la solución explicada.',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    this.db.run(
      'UPDATE challenges SET description = ?, objectives = ?, hints = ?, criteria = ?, solution = ? WHERE id = ?',
      r.value.description_markdown, JSON.stringify(r.value.objectives), JSON.stringify(r.value.hints), JSON.stringify(r.value.criteria), r.value.solution_markdown, id,
    );
    return { ok: true, value: this.get(id)! };
  }

  hint(id: number): ChallengeView {
    this.db.run('UPDATE challenges SET hints_revealed = MIN(hints_revealed + 1, json_array_length(hints)) WHERE id = ?', id);
    return this.get(id)!;
  }

  revealSolution(id: number): ChallengeView {
    const c = this.get(id);
    if (c?.canRevealSolution) {
      this.db.run('UPDATE challenges SET solution_revealed = 1 WHERE id = ?', id);
      this.log.info('práctica', `Solución consultada: «${c.title}» (sin XP)`);
    }
    return this.get(id)!;
  }

  async submit(id: number, response: string, ctx: TaskContext): Promise<Gen<ChallengeView>> {
    const c = this.db.get<any>('SELECT c.*, t.title AS topic_title, t.level FROM challenges c JOIN topics t ON t.id = c.topic_id WHERE c.id = ?', id);
    if (!c) return fail('Reto no encontrado.');
    if (!c.solution) return fail('El reto aún no está preparado.');
    const text = response.trim();
    if (text.length < 10) return fail('Escribe tu solución antes de enviarla.');
    const r = await this.gateway.run(
      {
        task: 'challenge_eval',
        schema: ChallengeEvalSchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está evaluando tu solución…',
        prompt: [
          `RETO: ${c.title} (tema ${c.topic_title}, nivel ${c.level}/5)`,
          c.description,
          `OBJETIVOS: ${JSON.parse(c.objectives).join('; ')}`,
          `CRITERIOS DE EVALUACIÓN (evalúa cada uno): ${JSON.parse(c.criteria).join(' | ')}`,
          `SOLUCIÓN DE REFERENCIA (solo para ti; NO la reveles en tu respuesta): ${c.solution}`,
          `Pistas que ya vio: ${c.hints_revealed}.`,
          'Evalúa con rigor: passed solo si cumple los criterios esenciales. Soluciones distintas a la de referencia pero correctas también valen.',
          'En feedback_markdown guía con preguntas y señala qué mejorar sin entregar la solución.',
          `SOLUCIÓN DEL ESTUDIANTE:\n<<<\n${text.slice(0, 20_000)}\n>>>`,
        ].join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    const e = r.value;
    this.db.run('INSERT INTO challenge_attempts (challenge_id, response, passed, score, evaluation) VALUES (?,?,?,?,?)', id, text, e.passed ? 1 : 0, e.score, JSON.stringify(e));
    this.game.markActivity('challenge');
    if (e.passed && c.status !== 'completed') {
      this.db.run(`UPDATE challenges SET status = 'completed', completed_at = ${now} WHERE id = ?`, id);
      // La XP solo se gana si se resolvió sin ver la solución.
      if (!c.solution_revealed) this.game.award('challenge_complete', 'challenge', id, c.xp, `Reto superado: «${c.title}»`);
      if (c.is_final) this.learning.checkTopicMastery(c.topic_id);
    }
    return { ok: true, value: this.get(id)! };
  }
}
