import type { AssessmentKind, AssessmentSummary, AssessmentView, Feedback, Gen, Level, QuestionType, QuestionView, QuizRequest } from '../../../shared/learning';
import { fail, type ClaudeGateway, type TaskContext } from '../claude/gateway';
import type { Db } from '../db/database';
import { XP, type GameService } from '../game/game-service';
import type { ActivityLog } from '../log/activity-log';
import { applyMastery, findConcept } from '../learning/concepts';
import type { LearningService } from '../learning/learning-service';
import { GradeSchema, LEVEL_GUIDE, QuizSchema, TEACHER_SYSTEM } from '../learning/schemas';
import { formatSources } from '../tutor/prompts';
import { autoGrade, fingerprint, isAutoGradable, normalizeQuestion, QUESTION_SELECT, responseIsValid, toQuestionView, verdictFor, type QuestionRow } from './questions';

export interface QuizDeps {
  db: Db;
  gateway: ClaudeGateway;
  game: GameService;
  log: ActivityLog;
  learning: LearningService;
}

const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const PASS_SCORE = 0.7;
export const EXCELLENT_SCORE = 0.9;

const DEFAULTS: Record<QuizRequest['kind'], { count: number; types: QuestionType[]; title: string }> = {
  lesson_quiz: { count: 4, types: ['multiple_choice', 'true_false', 'fill_blank', 'short_answer'], title: 'Comprueba si lo entendiste' },
  module_quiz: { count: 8, types: ['multiple_choice', 'true_false', 'fill_blank', 'matching', 'short_answer', 'problem', 'case_analysis', 'code'], title: 'Evaluación del módulo' },
  practice: { count: 6, types: ['multiple_choice', 'true_false', 'fill_blank', 'matching', 'short_answer', 'problem'], title: 'Práctica' },
  reinforcement: { count: 5, types: ['multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'problem'], title: 'Refuerzo' },
  exam: { count: 12, types: ['multiple_choice', 'true_false', 'fill_blank', 'matching', 'short_answer', 'problem', 'essay', 'case_analysis', 'code'], title: 'Examen' },
};

const TYPE_NAMES: Record<QuestionType, string> = {
  multiple_choice: 'selección múltiple', true_false: 'verdadero o falso', short_answer: 'respuesta corta', fill_blank: 'completar espacios',
  matching: 'relacionar conceptos', problem: 'resolver un problema', essay: 'desarrollo', case_analysis: 'análisis de una situación real', code: 'ejercicio de programación',
};

export class QuizService {
  constructor(private d: QuizDeps) {}

  /** Genera una evaluación adaptada: conceptos objetivo, dificultad según dominio y sin repetir preguntas anteriores. */
  async create(req: QuizRequest, ctx: TaskContext): Promise<Gen<AssessmentView>> {
    const { db } = this.d;
    const topic = db.get<{ id: number; title: string; level: Level | null; status: string }>('SELECT id, title, level, status FROM topics WHERE id = ?', req.topicId);
    if (!topic) return fail('Tema no encontrado.');
    if (topic.status === 'diagnosing') return fail('Completa primero el diagnóstico del tema.');
    const def = DEFAULTS[req.kind];
    let conceptIds: number[] = [];
    let title = def.title;
    let moduleId: number | null = req.moduleId ?? null;
    let lessonContext = '';

    if (req.kind === 'lesson_quiz') {
      const l = db.get<{ title: string; content: string | null; module_id: number }>('SELECT title, content, module_id FROM lessons WHERE id = ?', req.lessonId ?? -1);
      if (!l?.content) return fail('La lección no está preparada.');
      moduleId = l.module_id;
      title = `${def.title} · ${l.title}`;
      conceptIds = db.all<{ concept_id: number }>('SELECT concept_id FROM lesson_concepts WHERE lesson_id = ?', req.lessonId!).map((r) => r.concept_id);
      lessonContext = (JSON.parse(l.content) as { title: string; body: string }[]).map((u) => `${u.title}: ${u.body.slice(0, 400)}`).join('\n');
    } else if (req.kind === 'module_quiz') {
      const m = db.get<{ title: string; status: string }>('SELECT title, status FROM modules WHERE id = ? AND topic_id = ?', moduleId ?? -1, topic.id);
      if (!m) return fail('Módulo no encontrado.');
      const open = db.get<{ n: number }>("SELECT COUNT(*) n FROM lessons WHERE module_id = ? AND status <> 'completed'", moduleId!)!.n;
      if (open) return fail(`Completa las ${open} lección(es) pendientes del módulo antes de su evaluación.`);
      title = `${def.title} · ${m.title}`;
      conceptIds = db.all<{ concept_id: number }>('SELECT DISTINCT lc.concept_id FROM lesson_concepts lc JOIN lessons l ON l.id = lc.lesson_id WHERE l.module_id = ?', moduleId!).map((r) => r.concept_id);
    } else if (req.kind === 'reinforcement') {
      conceptIds = (req.conceptIds ?? []).slice(0, 3);
      if (!conceptIds.length) return fail('Elige el concepto que quieres reforzar.');
      const names = db.all<{ name: string }>(`SELECT name FROM concepts WHERE id IN (${conceptIds.map(() => '?').join(',')})`, ...conceptIds).map((c) => c.name);
      title = `${def.title} · ${names.join(', ')}`;
    } else if (req.conceptIds?.length) {
      conceptIds = req.conceptIds;
    } else {
      // Práctica o examen general: prioriza lo estudiado y menos dominado.
      conceptIds = db
        .all<{ id: number }>(
          `SELECT c.id FROM concepts c WHERE c.topic_id = ? AND (c.status <> 'not_studied' OR ? = 'exam')
            ORDER BY CASE WHEN c.attempts = 0 THEN 0.5 ELSE c.mastery END ASC LIMIT ?`, topic.id, req.kind, req.kind === 'exam' ? 20 : 8,
        )
        .map((r) => r.id);
      if (!conceptIds.length) conceptIds = db.all<{ id: number }>('SELECT id FROM concepts WHERE topic_id = ? LIMIT 8', topic.id).map((r) => r.id);
      title = `${def.title} · ${topic.title}`;
    }
    if (!conceptIds.length) return fail('No hay conceptos que evaluar en este tema todavía.');

    const concepts = db.all<{ id: number; name: string; short_definition: string; mastery: number; attempts: number; fail_streak: number }>(
      `SELECT id, name, short_definition, mastery, attempts, fail_streak FROM concepts WHERE id IN (${conceptIds.map(() => '?').join(',')})`, ...conceptIds,
    );
    const avg = concepts.reduce((a, c) => a + (c.attempts ? c.mastery : 0.4), 0) / concepts.length;
    let difficulty = Math.max(1, Math.min(5, 1 + Math.round(avg * 4)));
    if (req.kind === 'reinforcement') difficulty = Math.max(1, difficulty - 1);
    if (req.kind === 'exam' || req.kind === 'module_quiz') difficulty = Math.max(difficulty, 2);
    const count = Math.max(1, Math.min(20, req.count ?? def.count));
    const types = req.types?.length ? req.types : def.types;
    const history = db
      .all<{ prompt: string }>('SELECT q.prompt FROM questions q JOIN assessments a ON a.id = q.assessment_id WHERE a.topic_id = ? ORDER BY q.id DESC LIMIT 40', topic.id)
      .map((r) => r.prompt);
    const prereqs =
      req.kind === 'reinforcement'
        ? db.all<{ name: string; status: string }>(
            `SELECT c.name, c.status FROM concept_relations r JOIN concepts c ON c.id = r.related_id WHERE r.kind = 'prerequisite' AND r.concept_id IN (${conceptIds.map(() => '?').join(',')})`, ...conceptIds,
          )
        : [];
    const provided = this.d.learning.provided(topic.id, `${concepts.map((c) => c.name).join(' ')} ${topic.title}`, 8);

    const r = await this.d.gateway.run(
      {
        task: 'quiz',
        schema: QuizSchema,
        system: TEACHER_SYSTEM,
        label: req.kind === 'reinforcement' ? 'Claude está preparando una explicación nueva y ejercicios de refuerzo…' : 'Claude está preparando tus preguntas…',
        prompt: [
          `TEMA: ${topic.title} · ${LEVEL_GUIDE[topic.level ?? 'principiante']}`,
          `TIPO DE EVALUACIÓN: ${title}. Crea ${count} preguntas. Dificultad objetivo ${difficulty}/5 (varía ±1 entre preguntas).`,
          `Tipos a mezclar: ${types.map((t) => `${t} (${TYPE_NAMES[t]})`).join(', ')}. Usa "code" solo si el tema es de programación; "fill_blank" marca huecos con ___.`,
          'CONCEPTOS A EVALUAR (dominio actual):',
          ...concepts.map((c) => `- ${c.name}: ${c.short_definition} [${c.attempts ? `${Math.round(c.mastery * 100)}%${c.fail_streak >= 2 ? `, falló ${c.fail_streak} veces seguidas` : ''}` : 'sin evaluar'}]`),
          req.kind === 'reinforcement'
            ? `REFUERZO: el estudiante falla estos conceptos. En intro_markdown escribe una explicación NUEVA (otro enfoque, analogía distinta, paso a paso), y preguntas progresivas de fácil a media.${prereqs.length ? ` Prerrequisitos: ${prereqs.map((p) => `${p.name} (${p.status})`).join(', ')}.` : ''}`
            : 'intro_markdown debe ir vacío.',
          lessonContext ? `CONTENIDO DE LA LECCIÓN:\n${lessonContext}` : '',
          history.length ? `NO REPITAS ni parafrasees estas preguntas ya hechas:\n${history.map((h) => `- ${h.slice(0, 140)}`).join('\n')}` : '',
          'Evalúa comprensión, no memoria literal. Las preguntas abiertas llevan model_answer y key_points.',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].filter(Boolean).join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;

    const seen = new Set(db.all<{ fingerprint: string }>('SELECT q.fingerprint FROM questions q JOIN assessments a ON a.id = q.assessment_id WHERE a.topic_id = ?', topic.id).map((x) => x.fingerprint));
    const questions = r.value.questions
      .map(normalizeQuestion)
      .filter((q): q is NonNullable<typeof q> => !!q && !seen.has(fingerprint(q.prompt)) && (seen.add(fingerprint(q.prompt)), true));
    if (questions.length < Math.ceil(Math.min(count, r.value.questions.length) * 0.5) || !questions.length) {
      return { ok: false, errorKind: 'invalid_output', error: 'Las preguntas generadas no eran válidas o repetían otras anteriores. Inténtalo de nuevo.' };
    }

    const id = db.tx(() => {
      const aid = db.run(
        'INSERT INTO assessments (topic_id, module_id, lesson_id, kind, mode, title, difficulty, intro) VALUES (?,?,?,?,?,?,?,?)',
        topic.id, moduleId, req.lessonId ?? null, req.kind, req.mode, title, difficulty, req.kind === 'reinforcement' ? r.value.intro_markdown : '',
      ).lastId;
      questions.forEach((q, i) => {
        db.run(
          'INSERT INTO questions (assessment_id, ord, type, prompt, data, solution, explanation, concept_id, concept_name, difficulty, points, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
          aid, i, q.type, q.prompt, JSON.stringify(q.data), JSON.stringify(q.solution), q.explanation, findConcept(db, topic.id, q.concept), q.concept, q.difficulty, 1, fingerprint(q.prompt),
        );
      });
      db.run(`UPDATE topics SET updated_at = ${now} WHERE id = ?`, topic.id);
      return aid;
    });
    this.d.log.info('evaluación', `${title}: ${questions.length} preguntas (dificultad ${difficulty})`);
    return { ok: true, value: this.get(id)! };
  }

  get(id: number): AssessmentView | null {
    const a = this.d.db.get<any>('SELECT a.*, t.title AS topic_title FROM assessments a LEFT JOIN topics t ON t.id = a.topic_id WHERE a.id = ?', id);
    if (!a) return null;
    const reveal = a.status === 'graded' || a.mode === 'practice';
    return {
      id: a.id,
      kind: a.kind,
      mode: a.mode,
      status: a.status,
      title: a.title,
      topicId: a.topic_id,
      topicTitle: a.topic_title,
      moduleId: a.module_id,
      lessonId: a.lesson_id,
      difficulty: a.difficulty,
      score: a.score,
      passed: a.passed == null ? null : !!a.passed,
      questions: this.d.db.all<QuestionRow>(`${QUESTION_SELECT} WHERE q.assessment_id = ? ORDER BY q.ord`, id).map((q) => toQuestionView(q, reveal)),
      createdAt: a.created_at,
      finishedAt: a.finished_at,
      review: JSON.parse(a.review),
      intro: a.intro,
    } as AssessmentView;
  }

  list(topicId?: number | null): AssessmentSummary[] {
    return this.d.db.all<any>(
      `SELECT a.id, a.kind, a.mode, a.title, t.title AS topicTitle, a.score, a.passed, a.created_at AS createdAt, a.finished_at AS finishedAt,
              (SELECT COUNT(*) FROM questions q WHERE q.assessment_id = a.id) AS questions
         FROM assessments a LEFT JOIN topics t ON t.id = a.topic_id
        WHERE a.kind NOT IN ('lesson_check') ${topicId ? 'AND a.topic_id = ?' : ''}
        ORDER BY a.id DESC LIMIT 100`,
      ...(topicId ? [topicId] : []),
    ).map((r) => ({ ...r, passed: r.passed == null ? null : !!r.passed }));
  }

  private question(questionId: number) {
    return this.d.db.get<QuestionRow & { assessment_id: number; a_status: string; mode: string; kind: AssessmentKind; topic_id: number | null; concept_id: number | null }>(
      `SELECT q.id, q.ord, q.type, q.prompt, q.data, q.solution, q.explanation, q.concept_name, q.concept_id, q.difficulty, q.points, q.assessment_id,
              s.status AS a_status, s.mode, s.kind, s.topic_id,
              a.response AS a_response, a.score AS a_score, a.verdict AS a_verdict, a.feedback AS a_feedback
         FROM questions q JOIN assessments s ON s.id = q.assessment_id LEFT JOIN answers a ON a.question_id = q.id WHERE q.id = ?`, questionId,
    );
  }

  /** Guarda una respuesta sin corregir (modo examen y diagnóstico). null = «No lo sé». */
  saveAnswer(questionId: number, response: unknown): Gen<QuestionView> {
    const q = this.question(questionId);
    if (!q) return fail('Pregunta no encontrada.');
    if (q.a_status === 'graded') return fail('Esta evaluación ya está entregada.');
    if (q.a_verdict && q.a_verdict !== 'pendiente') return fail('Esta pregunta ya está corregida.');
    if (response !== null && !responseIsValid(q.type, JSON.parse(q.data), response)) return fail('Respuesta no válida para este tipo de pregunta.');
    this.d.db.run(
      `INSERT INTO answers (question_id, response) VALUES (?, ?) ON CONFLICT(question_id) DO UPDATE SET response = excluded.response, answered_at = ${now}`,
      questionId, JSON.stringify(response),
    );
    return { ok: true, value: toQuestionView(this.question(questionId)!, false) };
  }

  /** Modo práctica: corrige la respuesta al momento (cerradas localmente, abiertas con Claude). */
  async checkAnswer(questionId: number, response: unknown, ctx: TaskContext): Promise<Gen<QuestionView>> {
    const q = this.question(questionId);
    if (!q) return fail('Pregunta no encontrada.');
    if (q.mode !== 'practice') return fail('En modo examen las respuestas se corrigen al entregar.');
    if (q.a_verdict && q.a_verdict !== 'pendiente') return { ok: true, value: toQuestionView(q, true) };
    const saved = this.saveAnswer(questionId, response);
    if (!saved.ok) return saved;
    const r = await this.gradePending([questionId], ctx);
    if (!r.ok) return r;
    this.maybeFinish(q.assessment_id);
    return { ok: true, value: toQuestionView(this.question(questionId)!, true) };
  }

  /** Entrega: corrige lo pendiente, puntúa sin respuesta como 0, calcula nota, XP y desbloqueos. */
  async submit(id: number, ctx: TaskContext): Promise<Gen<AssessmentView>> {
    const { db } = this.d;
    const a = db.get<{ status: string; kind: AssessmentKind }>('SELECT status, kind FROM assessments WHERE id = ?', id);
    if (!a) return fail('Evaluación no encontrada.');
    if (a.kind === 'diagnostic') return fail('El diagnóstico se entrega desde el tema.');
    if (a.status === 'graded') return { ok: true, value: this.get(id)! };
    const unanswered = db.all<{ id: number }>('SELECT q.id FROM questions q LEFT JOIN answers a ON a.question_id = q.id WHERE q.assessment_id = ? AND a.id IS NULL', id);
    for (const u of unanswered) db.run("INSERT INTO answers (question_id, response) VALUES (?, 'null')", u.id);
    const pending = db.all<{ id: number }>("SELECT q.id FROM questions q JOIN answers a ON a.question_id = q.id WHERE q.assessment_id = ? AND a.verdict = 'pendiente'", id).map((r) => r.id);
    const r = await this.gradePending(pending, ctx);
    if (!r.ok) return r;
    this.finish(id);
    return { ok: true, value: this.get(id)! };
  }

  private maybeFinish(assessmentId: number) {
    const left = this.d.db.get<{ n: number }>(
      "SELECT COUNT(*) n FROM questions q LEFT JOIN answers a ON a.question_id = q.id WHERE q.assessment_id = ? AND (a.id IS NULL OR a.verdict = 'pendiente')", assessmentId,
    )!.n;
    const kind = this.d.db.get<{ kind: string }>('SELECT kind FROM assessments WHERE id = ?', assessmentId)!.kind;
    if (!left && kind !== 'diagnostic') this.finish(assessmentId);
  }

  private finish(id: number) {
    const { db, game, learning } = this.d;
    const a = db.get<{ status: string; kind: AssessmentKind; module_id: number | null; title: string }>('SELECT status, kind, module_id, title FROM assessments WHERE id = ?', id)!;
    if (a.status === 'graded') return;
    const t = db.get<{ s: number; p: number }>('SELECT SUM(a.score * q.points) s, SUM(q.points) p FROM questions q JOIN answers a ON a.question_id = q.id WHERE q.assessment_id = ?', id)!;
    const score = t.p ? t.s / t.p : 0;
    const passed = score >= PASS_SCORE;
    const weak = db
      .all<{ name: string; avg: number }>(
        'SELECT q.concept_name AS name, AVG(a.score) avg FROM questions q JOIN answers a ON a.question_id = q.id WHERE q.assessment_id = ? AND q.concept_name IS NOT NULL GROUP BY q.concept_name HAVING avg < 0.7 ORDER BY avg',
        id,
      )
      .map((w) => `Repasa «${w.name}» (${Math.round(w.avg * 100)}% de acierto)`);
    db.run(`UPDATE assessments SET status = 'graded', score = ?, passed = ?, review = ?, finished_at = ${now} WHERE id = ?`, score, a.kind === 'lesson_check' ? null : passed ? 1 : 0, JSON.stringify(weak), id);
    if (a.kind === 'lesson_check') return;
    this.d.log.info('evaluación', `${a.title}: ${Math.round(score * 100)}%${passed ? ' · aprobada' : ''}`);
    if (score >= EXCELLENT_SCORE) game.award('quiz_excellent', 'assessment', id, XP.quiz_excellent, `Calificación excelente (${Math.round(score * 100)}%) en «${a.title}»`);
    else if (passed) game.award('quiz_pass', 'assessment', id, XP.quiz_pass, `Evaluación aprobada (${Math.round(score * 100)}%): «${a.title}»`);
    if (passed && a.kind === 'module_quiz' && a.module_id) learning.onModuleQuizPassed(a.module_id);
  }

  /** Corrige un lote: tipos cerrados al instante; abiertos en UNA llamada a Claude. */
  private async gradePending(questionIds: number[], ctx: TaskContext): Promise<Gen<void>> {
    const { db } = this.d;
    const open: (QuestionRow & { response: unknown; topic_id: number | null })[] = [];
    for (const id of questionIds) {
      const q = this.question(id)!;
      const response = JSON.parse(q.a_response ?? 'null');
      const data = JSON.parse(q.data);
      const sol = JSON.parse(q.solution);
      if (response === null) {
        this.store(q, 0, { analysis: 'No respondiste esta pregunta (o marcaste «No lo sé»).', reasoningErrors: [], correctAnswer: correctText(q.type, data, sol), reviewSuggestion: q.concept_name ? `Repasa «${q.concept_name}».` : '' }, 'auto');
      } else if (isAutoGradable(q.type)) {
        const g = autoGrade(q.type, data, sol, q.explanation, response, q.concept_name)!;
        this.store(q, g.score, g.feedback, 'auto');
      } else {
        open.push({ ...q, response });
      }
    }
    if (!open.length) return { ok: true, value: undefined };

    const topic = db.get<{ title: string; level: Level | null }>('SELECT title, level FROM topics WHERE id = ?', open[0].topic_id ?? -1);
    const r = await this.d.gateway.run(
      {
        task: 'grade',
        schema: GradeSchema,
        system: TEACHER_SYSTEM,
        label: open.length > 1 ? `Claude está corrigiendo ${open.length} respuestas abiertas…` : 'Claude está analizando tu respuesta…',
        prompt: [
          `TEMA: ${topic?.title ?? ''} · ${LEVEL_GUIDE[topic?.level ?? 'principiante']}`,
          'Corrige cada respuesta del estudiante. No te limites a correcto/incorrecto:',
          '1) analiza su respuesta, 2) decide si comprendió realmente el concepto, 3) explica por qué está bien o mal,',
          '4) identifica errores de razonamiento concretos, 5) da la respuesta correcta, 6) recomienda qué repasar.',
          'Da crédito parcial (score entre 0 y 1) cuando acierte en parte. Habla al estudiante de tú, con honestidad y ánimo.',
          '',
          ...open.map((q) => {
            const sol = JSON.parse(q.solution);
            const data = JSON.parse(q.data);
            return [
              `### id ${q.id} · ${q.type} · concepto: ${q.concept_name ?? '-'} · dificultad ${q.difficulty}`,
              `Enunciado: ${q.prompt}`,
              data.scenario ? `Escenario: ${data.scenario}` : '',
              `Respuesta modelo: ${sol.modelAnswer}`,
              sol.keyPoints?.length ? `Puntos clave: ${sol.keyPoints.join('; ')}` : '',
              `RESPUESTA DEL ESTUDIANTE:\n<<<\n${String(q.response).slice(0, 8000)}\n>>>`,
            ].filter(Boolean).join('\n');
          }),
        ].join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    for (const q of open) {
      const g = r.value.grades.find((x) => x.id === q.id);
      if (!g) return { ok: false, errorKind: 'invalid_output', error: 'La corrección llegó incompleta. Inténtalo de nuevo.' };
      const score = g.understood ? g.score : Math.min(g.score, 0.6);
      this.store(q, score, { analysis: g.analysis, reasoningErrors: g.reasoning_errors, correctAnswer: g.correct_answer, reviewSuggestion: g.review_suggestion }, 'claude');
    }
    return { ok: true, value: undefined };
  }

  private store(q: QuestionRow & { concept_id?: number | null; kind?: AssessmentKind; topic_id?: number | null }, score: number, feedback: Feedback, by: 'auto' | 'claude') {
    const { db, game } = this.d;
    db.run(`UPDATE answers SET score = ?, verdict = ?, feedback = ?, graded_by = ?, graded_at = ${now} WHERE question_id = ?`, score, verdictFor(score), JSON.stringify(feedback), by, q.id);
    const meta = db.get<{ concept_id: number | null; kind: AssessmentKind; topic_id: number | null }>(
      'SELECT q.concept_id, s.kind, s.topic_id FROM questions q JOIN assessments s ON s.id = q.assessment_id WHERE q.id = ?', q.id,
    )!;
    const conceptId = meta.concept_id ?? (meta.topic_id && q.concept_name ? findConcept(db, meta.topic_id, q.concept_name) : null);
    if (conceptId) applyMastery(db, conceptId, score, q.difficulty);
    game.markActivity('question', { correct: score >= 0.99 });
  }
}

function correctText(type: string, data: any, sol: any): string {
  switch (type) {
    case 'multiple_choice': return data.options[sol.correct];
    case 'true_false': return sol.correct ? 'Verdadero' : 'Falso';
    case 'fill_blank': return sol.blanks.map((b: string[]) => b[0]).join(' · ');
    case 'matching': return sol.pairs.map((p: number, i: number) => `${data.left[i]} → ${data.right[p]}`).join('; ');
    default: return sol.modelAnswer ?? '';
  }
}
