import type { Diagnosis, Gen, LessonAction, LessonSummary, LessonUnit, LessonView, Level, ModuleView, StageStatus, TopicDetail, TopicSummary } from '../../../shared/learning';
import type { MessageSource } from '../../../shared/types';
import { autoGrade, fingerprint, normalizeQuestion, QUESTION_SELECT, toQuestionView, verdictFor, type QuestionRow } from '../assess/questions';
import { fail, type ClaudeGateway, type TaskContext } from '../claude/gateway';
import type { Db } from '../db/database';
import type { GameService } from '../game/game-service';
import { XP } from '../game/game-service';
import type { ActivityLog } from '../log/activity-log';
import type { AskService, ConversationContext, ConversationRow } from '../tutor/ask-service';
import { verifySources, type ProvidedSource } from '../tutor/citations';
import { ASK_SYSTEM_PROMPT, formatSources } from '../tutor/prompts';
import type { VaultService } from '../vault/vault-service';
import { addConceptSources, applyMastery, findConcept, relate, upsertConcept } from './concepts';
import { DiagnosticSchema, LEVEL_GUIDE, LessonSchema, PathSchema, TEACHER_SYSTEM } from './schemas';

export interface LearningDeps {
  db: Db;
  vault: VaultService;
  gateway: ClaudeGateway;
  game: GameService;
  log: ActivityLog;
  ask: AskService;
}

const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const TUTOR_SYSTEM = [
  'Eres el tutor socrático de StudyCore. Tu objetivo es que el estudiante aprenda a pensar, no darle respuestas hechas.',
  '- Ante un ejercicio o problema: NO des la solución. Haz una pregunta que le ayude a avanzar, o da la pista mínima necesaria.',
  '- Solo das la solución completa si el estudiante ya lo intentó en serio y lo pide expresamente, y aun así explicas el razonamiento.',
  '- Ante una duda conceptual: explica con claridad, comprueba con una pregunta corta si lo entendió.',
  '- Usa el contexto de su ruta, su nivel y sus debilidades. Si le falta un prerrequisito, díselo y empieza por ahí.',
  '- Respuestas breves y dialogadas: termina normalmente con una pregunta para él.',
  '',
  ASK_SYSTEM_PROMPT.split('\n').slice(-7).join('\n'),
].join('\n');

const LESSON_CHAT_SYSTEM = [
  'Eres el profesor de StudyCore acompañando una lección concreta. Respondes a peticiones del estudiante sobre la lección:',
  'explicar más sencillo, dar otro ejemplo, explicar técnicamente, proponer ejercicios (sin dar la solución hasta que responda) o relacionar conceptos.',
  'Respuestas cortas, concretas y adaptadas a su nivel.',
  '',
  ASK_SYSTEM_PROMPT.split('\n').slice(-7).join('\n'),
].join('\n');

export class LearningService {
  constructor(private d: LearningDeps) {}

  /* ───────── Temas ───────── */

  listTopics(): TopicSummary[] {
    return this.d.db
      .all<any>(
        `SELECT t.id, t.title, t.objective, t.level, t.status, t.created_at AS createdAt, t.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.topic_id = t.id) AS lessonCount,
                (SELECT COUNT(*) FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.topic_id = t.id AND l.status = 'completed') AS completedLessons,
                (SELECT COUNT(*) FROM modules m WHERE m.topic_id = t.id) AS moduleCount,
                (SELECT COUNT(*) FROM modules m WHERE m.topic_id = t.id AND m.status = 'completed') AS completedModules,
                (SELECT COUNT(*) FROM concepts c WHERE c.topic_id = t.id) AS concepts,
                (SELECT COUNT(*) FROM concepts c WHERE c.topic_id = t.id AND c.status = 'mastered') AS masteredConcepts
           FROM topics t ORDER BY t.updated_at DESC`,
      )
      .map((t) => ({ ...t, progress: t.lessonCount ? t.completedLessons / t.lessonCount : 0 }));
  }

  getTopic(id: number): TopicDetail | null {
    const { db } = this.d;
    const base = this.listTopics().find((t) => t.id === id);
    if (!base) return null;
    const t = db.get<any>('SELECT summary, scope, difficulty, diagnosis FROM topics WHERE id = ?', id)!;
    const modules = db.all<any>('SELECT id, ord, title, objective, status FROM modules WHERE topic_id = ? ORDER BY ord', id).map<ModuleView>((m) => {
      const q = db.get<{ best: number | null; passed: number | null; n: number }>(
        "SELECT MAX(score) best, MAX(passed) passed, COUNT(*) n FROM assessments WHERE module_id = ? AND kind = 'module_quiz' AND status = 'graded'", m.id,
      )!;
      return { ...m, lessons: this.lessonSummaries(m.id), quiz: { bestScore: q.best, passed: !!q.passed, attempts: q.n } };
    });
    return {
      ...base,
      summary: t.summary,
      scope: JSON.parse(t.scope),
      difficulty: t.difficulty,
      diagnosis: t.diagnosis ? (JSON.parse(t.diagnosis) as Diagnosis) : null,
      diagnosticAssessmentId: db.get<{ id: number }>("SELECT id FROM assessments WHERE topic_id = ? AND kind = 'diagnostic' ORDER BY id DESC LIMIT 1", id)?.id ?? null,
      modules,
      finalChallengeId: db.get<{ id: number }>('SELECT id FROM challenges WHERE topic_id = ? AND is_final = 1 ORDER BY id LIMIT 1', id)?.id ?? null,
      tutorConversationId: db.get<{ id: number }>("SELECT id FROM conversations WHERE topic_id = ? AND kind = 'tutor' ORDER BY id DESC LIMIT 1", id)?.id ?? null,
      weakConcepts: db.all<any>('SELECT id, name, mastery FROM concepts WHERE topic_id = ? AND attempts > 0 AND mastery < 0.6 ORDER BY mastery LIMIT 6', id),
    };
  }

  private lessonSummaries(moduleId: number): LessonSummary[] {
    return this.d.db
      .all<any>('SELECT id, ord, title, summary, difficulty, status, content, current_unit FROM lessons WHERE module_id = ? ORDER BY ord', moduleId)
      .map((l) => ({
        id: l.id,
        ord: l.ord,
        title: l.title,
        summary: l.summary,
        difficulty: l.difficulty,
        status: l.status,
        generated: !!l.content,
        currentUnit: l.current_unit,
        unitCount: l.content ? JSON.parse(l.content).length : 0,
        concepts: this.d.db.all<{ name: string }>('SELECT c.name FROM lesson_concepts lc JOIN concepts c ON c.id = lc.concept_id WHERE lc.lesson_id = ? ORDER BY c.name', l.id).map((c) => c.name),
      }));
  }

  deleteTopic(id: number) {
    this.d.db.run('DELETE FROM topics WHERE id = ?', id);
    this.d.log.info('aprendizaje', `Tema eliminado (#${id})`);
  }

  private scopeOf(topicId: number): string[] {
    return JSON.parse(this.d.db.get<{ scope: string }>('SELECT scope FROM topics WHERE id = ?', topicId)?.scope ?? '[]');
  }

  /** 1) Crea el tema y genera el diagnóstico inicial a partir de los documentos del vault. */
  async createTopic(input: { title: string; goal: string; scope: string[] }, ctx: TaskContext): Promise<Gen<{ topicId: number; assessmentId: number }>> {
    const { db, vault } = this.d;
    const title = input.title.trim();
    if (title.length < 2) return fail('Escribe el tema que quieres estudiar.');
    const scope = [...new Set(input.scope.map((s) => s.replace(/\\/g, '/').replace(/\/$/, '')).filter(Boolean))];
    ctx.onProgress('Buscando el tema en tu vault…');
    const provided = vault.retrieve(`${title} ${input.goal}`, 12, 3, scope);
    if (!provided.length) return fail('No encontré documentos sobre ese tema en el ámbito elegido. Prueba otro nombre o amplía las carpetas.');

    const r = await this.d.gateway.run(
      {
        task: 'diagnostic',
        schema: DiagnosticSchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está analizando tus documentos sobre el tema…',
        prompt: [
          `TEMA: ${title}`,
          input.goal ? `OBJETIVO DEL ESTUDIANTE: ${input.goal}` : '',
          '',
          'Analiza lo que el vault contiene sobre el tema e identifica sus subtemas. Después crea un DIAGNÓSTICO INICIAL de 8 preguntas',
          'para medir qué sabe ya el estudiante: conceptos que conoce y desconoce, profundidad y prerrequisitos que le faltan.',
          'Mezcla dificultades de 1 a 5, de fundamentos a avanzado. Tipos permitidos: multiple_choice, true_false, short_answer.',
          'Incluye al menos 2 short_answer para medir comprensión (no solo memoria). Cada pregunta indica el concepto que evalúa.',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].filter(Boolean).join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;

    const questions = r.value.questions.filter((q) => ['multiple_choice', 'true_false', 'short_answer'].includes(q.type)).map(normalizeQuestion).filter((q) => q !== null);
    if (questions.length < 4) return { ok: false, errorKind: 'invalid_output', error: 'El diagnóstico generado no era válido. Inténtalo de nuevo.' };

    const out = db.tx(() => {
      const topicId = db.run('INSERT INTO topics (title, goal, summary, scope) VALUES (?,?,?,?)', title, input.goal.trim(), r.value.summary, JSON.stringify(scope)).lastId;
      const assessmentId = db.run("INSERT INTO assessments (topic_id, kind, mode, title, difficulty) VALUES (?, 'diagnostic', 'exam', ?, 2)", topicId, `Diagnóstico · ${title}`).lastId;
      questions.forEach((q, i) =>
        db.run(
          'INSERT INTO questions (assessment_id, ord, type, prompt, data, solution, explanation, concept_name, difficulty, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?)',
          assessmentId, i, q.type, q.prompt, JSON.stringify(q.data), JSON.stringify(q.solution), q.explanation, q.concept, q.difficulty, fingerprint(q.prompt),
        ),
      );
      return { topicId, assessmentId };
    });
    this.d.log.info('aprendizaje', `Nuevo tema «${title}»: diagnóstico de ${questions.length} preguntas`);
    return { ok: true, value: out };
  }

  /** 2) Corrige el diagnóstico, fija el nivel y construye la ruta completa con prerrequisitos. */
  async submitDiagnostic(assessmentId: number, ctx: TaskContext): Promise<Gen<TopicDetail>> {
    const { db, vault } = this.d;
    const a = db.get<{ topic_id: number; status: string; kind: string }>('SELECT topic_id, status, kind FROM assessments WHERE id = ?', assessmentId);
    if (!a || a.kind !== 'diagnostic') return fail('Diagnóstico no encontrado.');
    if (a.status === 'graded') return { ok: true, value: this.getTopic(a.topic_id)! };
    const topic = db.get<{ id: number; title: string; goal: string }>('SELECT id, title, goal FROM topics WHERE id = ?', a.topic_id)!;
    const rows = db.all<QuestionRow>(`${QUESTION_SELECT} WHERE q.assessment_id = ? ORDER BY q.ord`, assessmentId);

    const lines: string[] = [];
    const auto = new Map<number, { score: number; feedback: any }>();
    rows.forEach((q, i) => {
      const data = JSON.parse(q.data);
      const sol = JSON.parse(q.solution);
      const resp = q.a_response == null ? null : JSON.parse(q.a_response);
      let shown: string;
      if (resp === null) shown = '(No lo sé / sin responder)';
      else if (q.type === 'multiple_choice') shown = data.options[resp] ?? '?';
      else if (q.type === 'true_false') shown = resp ? 'Verdadero' : 'Falso';
      else shown = String(resp);
      if (q.type !== 'short_answer') {
        const g = resp === null ? null : autoGrade(q.type, data, sol, q.explanation, resp, q.concept_name);
        const score = g?.score ?? 0;
        auto.set(q.id, { score, feedback: g?.feedback ?? { analysis: q.explanation, reasoningErrors: [], correctAnswer: q.type === 'true_false' ? (sol.correct ? 'Verdadero' : 'Falso') : data.options?.[sol.correct] ?? '', reviewSuggestion: '' } });
        lines.push(`[${i}] (${q.type}, dificultad ${q.difficulty}, concepto: ${q.concept_name}) ${q.prompt}\n    Respuesta: ${shown} → ${score >= 1 ? 'CORRECTA' : 'INCORRECTA'}`);
      } else {
        lines.push(`[${i}] (short_answer, dificultad ${q.difficulty}, concepto: ${q.concept_name}) ${q.prompt}\n    Respuesta modelo: ${sol.modelAnswer}\n    Respuesta del estudiante: ${shown}`);
      }
    });

    const provided = vault.retrieve(topic.title, 14, 3, this.scopeOf(topic.id));
    const r = await this.d.gateway.run(
      {
        task: 'path',
        schema: PathSchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está evaluando tu diagnóstico y diseñando tu ruta…',
        prompt: [
          `TEMA: ${topic.title}`,
          topic.goal ? `OBJETIVO DEL ESTUDIANTE: ${topic.goal}` : '',
          '',
          'RESULTADOS DEL DIAGNÓSTICO (las cerradas ya están corregidas; califica tú las short_answer en short_answer_grades usando su índice):',
          ...lines,
          '',
          'Con esto: determina su nivel, qué conceptos conoce, cuáles le faltan y qué prerrequisitos necesita.',
          'Después diseña una RUTA DE APRENDIZAJE ordenada de fundamentos a avanzado: 3 a 6 módulos con 2 a 4 lecciones cada uno.',
          'Si le faltan prerrequisitos, el primer módulo debe cubrirlos. No repitas lo que ya domina salvo como repaso breve.',
          'Lista los conceptos fundamentales (con definición corta, sus prerrequisitos por nombre y, si salen del vault, ref S# y la frase literal).',
          'Cada lección indica los nombres EXACTOS de los conceptos que trabaja. Termina con un proyecto o reto final práctico.',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].filter(Boolean).join('\n'),
        timeoutMs: 10 * 60_000,
      },
      ctx,
    );
    if (!r.ok) return r;
    const p = r.value;

    db.tx(() => {
      // Respuestas del diagnóstico: cerradas corregidas localmente, abiertas por Claude.
      rows.forEach((q, i) => {
        let score: number;
        let feedback: any;
        if (q.type === 'short_answer') {
          const g = p.short_answer_grades.find((x) => x.question_index === i);
          score = q.a_response == null || q.a_response === 'null' ? 0 : g?.score ?? 0;
          feedback = { analysis: g?.feedback ?? 'Sin evaluación.', reasoningErrors: [], correctAnswer: JSON.parse(q.solution).modelAnswer, reviewSuggestion: '' };
        } else {
          ({ score, feedback } = auto.get(q.id)!);
        }
        db.run(
          `INSERT INTO answers (question_id, response, score, verdict, feedback, graded_by, graded_at) VALUES (?,?,?,?,?,?,${now})
           ON CONFLICT(question_id) DO UPDATE SET score = excluded.score, verdict = excluded.verdict, feedback = excluded.feedback, graded_by = excluded.graded_by, graded_at = excluded.graded_at`,
          q.id, q.a_response ?? 'null', score, verdictFor(score), JSON.stringify(feedback), q.type === 'short_answer' ? 'claude' : 'auto',
        );
      });
      const total = db.get<{ s: number; n: number }>('SELECT SUM(a.score) s, COUNT(*) n FROM answers a JOIN questions q ON q.id = a.question_id WHERE q.assessment_id = ?', assessmentId)!;
      db.run(`UPDATE assessments SET status = 'graded', score = ?, finished_at = ${now} WHERE id = ?`, total.n ? total.s / total.n : 0, assessmentId);

      const diagnosis: Diagnosis = { summary: p.diagnosis_summary, known: p.known_concepts, gaps: p.gaps, missingPrerequisites: p.missing_prerequisites };
      db.run(`UPDATE topics SET level = ?, objective = ?, difficulty = ?, diagnosis = ?, status = 'active', updated_at = ${now} WHERE id = ?`, p.level, p.objective, p.difficulty, JSON.stringify(diagnosis), topic.id);

      for (const c of p.concepts) {
        const { id } = upsertConcept(db, topic.id, { name: c.name, shortDefinition: c.short_definition });
        if (c.quote) addConceptSources(db, id, [{ ref: c.ref ?? '', path: c.path ?? '', heading: '', quote: c.quote }], provided, vault);
      }
      for (const c of p.concepts) {
        const id = findConcept(db, topic.id, c.name)!;
        for (const pre of c.prerequisites) {
          const pid = findConcept(db, topic.id, pre) ?? upsertConcept(db, topic.id, { name: pre }).id;
          relate(db, id, pid, 'prerequisite');
        }
      }
      p.modules.forEach((m, mi) => {
        const moduleId = db.run('INSERT INTO modules (topic_id, ord, title, objective, status) VALUES (?,?,?,?,?)', topic.id, mi, m.title, m.objective, mi === 0 ? 'available' : 'locked').lastId;
        m.lessons.forEach((l, li) => {
          const lessonId = db.run('INSERT INTO lessons (module_id, ord, title, summary, difficulty, status) VALUES (?,?,?,?,?,?)', moduleId, li, l.title, l.summary, l.difficulty, mi === 0 && li === 0 ? 'available' : 'locked').lastId;
          for (const name of l.concepts) {
            const cid = findConcept(db, topic.id, name) ?? upsertConcept(db, topic.id, { name }).id;
            db.run('INSERT OR IGNORE INTO lesson_concepts (lesson_id, concept_id) VALUES (?,?)', lessonId, cid);
          }
        });
      });
      db.run(
        'INSERT INTO challenges (topic_id, title, description, objectives, level, criteria, xp, is_final) VALUES (?,?,?,?,?,?,?,1)',
        topic.id, p.final_project.title, p.final_project.description, JSON.stringify(p.final_project.objectives), Math.min(5, p.difficulty + 1), JSON.stringify(p.final_project.criteria), XP.challenge_complete,
      );
      // El diagnóstico es la primera evidencia de dominio por concepto.
      for (const q of db.all<{ concept_name: string; difficulty: number; score: number }>('SELECT q.concept_name, q.difficulty, a.score FROM questions q JOIN answers a ON a.question_id = q.id WHERE q.assessment_id = ?', assessmentId)) {
        const cid = q.concept_name ? findConcept(db, topic.id, q.concept_name) : null;
        if (cid) applyMastery(db, cid, q.score, q.difficulty);
      }
    });
    this.d.game.award('diagnostic_complete', 'assessment', assessmentId, XP.diagnostic_complete, `Diagnóstico de «${topic.title}» completado`);
    this.d.game.markActivity('question');
    this.d.log.info('aprendizaje', `Ruta creada para «${topic.title}»: nivel ${p.level}, ${p.modules.length} módulos`);
    return { ok: true, value: this.getTopic(topic.id)! };
  }

  /* ───────── Lecciones ───────── */

  getLesson(id: number, markOpened = true): LessonView | null {
    const { db } = this.d;
    const l = db.get<any>(
      `SELECT l.*, m.title AS module_title, m.topic_id, m.id AS module_id, t.title AS topic_title
         FROM lessons l JOIN modules m ON m.id = l.module_id JOIN topics t ON t.id = m.topic_id WHERE l.id = ?`, id,
    );
    if (!l) return null;
    if (markOpened) db.run(`UPDATE lessons SET opened_at = ${now} WHERE id = ?`, id);
    const checks = new Map(
      db.all<QuestionRow>(`${QUESTION_SELECT} JOIN assessments s ON s.id = q.assessment_id WHERE s.lesson_id = ? AND s.kind = 'lesson_check'`, id).map((q) => [q.id, toQuestionView(q, true)]),
    );
    const raw: { kind: LessonUnit['kind']; title: string; body: string; questionId?: number }[] = l.content ? JSON.parse(l.content) : [];
    const summary = this.lessonSummaries(l.module_id).find((x) => x.id === id)!;
    const siblings = db.all<{ id: number; ord: number }>('SELECT id, ord FROM lessons WHERE module_id = ? ORDER BY ord', l.module_id);
    const next =
      siblings.find((s) => s.ord > l.ord)?.id ??
      db.get<{ id: number }>('SELECT l.id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.topic_id = ? AND m.ord > (SELECT ord FROM modules WHERE id = ?) ORDER BY m.ord, l.ord LIMIT 1', l.topic_id, l.module_id)?.id ??
      null;
    return {
      ...summary,
      topicId: l.topic_id,
      topicTitle: l.topic_title,
      moduleId: l.module_id,
      moduleTitle: l.module_title,
      units: raw.map((u) => ({ kind: u.kind, title: u.title, body: u.body, check: u.questionId ? checks.get(u.questionId) ?? null : null })),
      sources: JSON.parse(l.sources) as MessageSource[],
      complementary: l.complementary,
      conversationId: db.get<{ id: number }>("SELECT id FROM conversations WHERE lesson_id = ? AND kind = 'lesson' ORDER BY id DESC LIMIT 1", id)?.id ?? null,
      nextLessonId: next,
      isLastInModule: siblings[siblings.length - 1]?.id === id,
    };
  }

  /** 3) Genera la lección en unidades cortas, adaptada al nivel y a lo que el estudiante aún no domina. */
  async generateLesson(id: number, ctx: TaskContext, regenerate = false): Promise<Gen<LessonView>> {
    const { db, vault } = this.d;
    const l = db.get<any>(
      `SELECT l.id, l.title, l.summary, l.difficulty, l.status, l.content, l.module_id, m.title AS module_title, m.objective AS module_objective, m.topic_id,
              t.title AS topic_title, t.level, t.objective FROM lessons l JOIN modules m ON m.id = l.module_id JOIN topics t ON t.id = m.topic_id WHERE l.id = ?`, id,
    );
    if (!l) return fail('Lección no encontrada.');
    if (l.status === 'locked') return fail('Esta lección está bloqueada: completa antes las anteriores.');
    if (l.content && !regenerate) return { ok: true, value: this.getLesson(id)! };

    const concepts = db.all<{ name: string; short_definition: string; mastery: number; attempts: number; status: string }>(
      'SELECT c.name, c.short_definition, c.mastery, c.attempts, c.status FROM lesson_concepts lc JOIN concepts c ON c.id = lc.concept_id WHERE lc.lesson_id = ?', id,
    );
    const previous = db.all<{ title: string }>(
      "SELECT l.title FROM lessons l JOIN modules m ON m.id = l.module_id WHERE m.topic_id = ? AND l.status = 'completed' ORDER BY m.ord, l.ord", l.topic_id,
    );
    const provided = vault.retrieve(`${l.title} ${concepts.map((c) => c.name).join(' ')} ${l.topic_title}`, 10, 3, this.scopeOf(l.topic_id));
    const level = (l.level ?? 'principiante') as Level;

    const r = await this.d.gateway.run(
      {
        task: 'lesson',
        schema: LessonSchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está preparando tu lección…',
        prompt: [
          `TEMA: ${l.topic_title} · OBJETIVO DE LA RUTA: ${l.objective}`,
          `MÓDULO: ${l.module_title} — ${l.module_objective}`,
          `LECCIÓN: ${l.title} — ${l.summary} (dificultad ${l.difficulty}/5)`,
          LEVEL_GUIDE[level],
          previous.length ? `YA ESTUDIÓ: ${previous.map((p) => p.title).join('; ')}` : 'Es su primera lección del tema.',
          'CONCEPTOS DE LA LECCIÓN (dominio actual 0-1):',
          ...concepts.map((c) => `- ${c.name}: ${c.short_definition} [dominio ${c.attempts ? c.mastery.toFixed(2) : 'sin evaluar'}]`),
          '',
          'Escribe la lección como una SECUENCIA DE UNIDADES CORTAS (nada de muros de texto), en este orden:',
          'intro (por qué importa) → definition (definición clara) → explanation (1-2 unidades) → check → example (práctico) → analogy (de la vida real)',
          '→ application (usos reales) → mistakes (errores comunes) → check → related (conceptos relacionados) → summary (lo aprendido).',
          'Cada unidad "check" lleva en "check" una pregunta multiple_choice (con option_feedback) o true_false para comprobar comprensión.',
          'Insiste más en los conceptos con dominio bajo. Marca con [S#] lo que salga del vault; lo que no esté ahí va en complementary_markdown.',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    const out = r.value;
    if (!out.units.some((u) => u.kind === 'summary')) return { ok: false, errorKind: 'invalid_output', error: 'La lección generada estaba incompleta. Inténtalo de nuevo.' };

    const sources = verifySources(out.sources, provided, vault).map(({ sectionId: _s, ...rest }) => rest);
    db.tx(() => {
      db.run("DELETE FROM assessments WHERE lesson_id = ? AND kind = 'lesson_check'", id);
      const checkAssessment = db.run("INSERT INTO assessments (topic_id, module_id, lesson_id, kind, mode, title, difficulty) VALUES (?,?,?, 'lesson_check', 'practice', ?, ?)", l.topic_id, l.module_id, id, `Comprobaciones · ${l.title}`, l.difficulty).lastId;
      let ord = 0;
      const units = out.units.map((u) => {
        let questionId: number | undefined;
        const q = u.kind === 'check' && u.check ? normalizeQuestion(u.check) : null;
        if (q && (q.type === 'multiple_choice' || q.type === 'true_false')) {
          const cid = findConcept(db, l.topic_id, q.concept);
          questionId = db.run(
            'INSERT INTO questions (assessment_id, ord, type, prompt, data, solution, explanation, concept_id, concept_name, difficulty, fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            checkAssessment, ord++, q.type, q.prompt, JSON.stringify(q.data), JSON.stringify(q.solution), q.explanation, cid, q.concept, q.difficulty, fingerprint(q.prompt),
          ).lastId;
        }
        return { kind: u.kind, title: u.title, body: u.body_markdown, questionId };
      });
      for (const c of out.concepts) {
        const { id: cid } = upsertConcept(db, l.topic_id, { name: c.name, shortDefinition: c.short_definition });
        db.run('INSERT OR IGNORE INTO lesson_concepts (lesson_id, concept_id) VALUES (?,?)', id, cid);
      }
      db.run(
        `UPDATE lessons SET content = ?, sources = ?, complementary = ?, current_unit = 0, generated_at = ${now},
                status = CASE WHEN status = 'available' THEN 'in_progress' ELSE status END, started_at = COALESCE(started_at, ${now}) WHERE id = ?`,
        JSON.stringify(units), JSON.stringify(sources), out.complementary_markdown, id,
      );
      db.run(`UPDATE modules SET status = 'in_progress' WHERE id = ? AND status = 'available'`, l.module_id);
      db.run(`UPDATE topics SET updated_at = ${now} WHERE id = ?`, l.topic_id);
    });
    this.d.log.info('aprendizaje', `Lección preparada: «${l.title}» (${out.units.length} unidades)`);
    return { ok: true, value: this.getLesson(id)! };
  }

  setUnit(id: number, unit: number) {
    const l = this.d.db.get<{ content: string | null }>('SELECT content FROM lessons WHERE id = ?', id);
    if (!l?.content) return;
    const max = JSON.parse(l.content).length - 1;
    this.d.db.run(`UPDATE lessons SET current_unit = ?, opened_at = ${now} WHERE id = ?`, Math.max(0, Math.min(max, Math.round(unit))), id);
  }

  /** 4) Completa la lección (requiere haber respondido sus comprobaciones) y desbloquea la siguiente. */
  completeLesson(id: number): Gen<LessonView> {
    const { db, game } = this.d;
    const l = db.get<any>('SELECT l.id, l.title, l.status, l.content, l.module_id, l.ord, m.topic_id FROM lessons l JOIN modules m ON m.id = l.module_id WHERE l.id = ?', id);
    if (!l) return fail('Lección no encontrada.');
    if (!l.content) return fail('La lección aún no se ha preparado.');
    if (l.status === 'locked') return fail('La lección está bloqueada.');
    const pending = db.get<{ n: number }>(
      "SELECT COUNT(*) n FROM questions q JOIN assessments s ON s.id = q.assessment_id LEFT JOIN answers a ON a.question_id = q.id WHERE s.lesson_id = ? AND s.kind = 'lesson_check' AND a.id IS NULL", id,
    )!.n;
    if (pending) return fail(`Responde las ${pending} pregunta(s) de comprobación antes de terminar la lección.`);
    if (l.status !== 'completed') {
      db.tx(() => {
        db.run(`UPDATE lessons SET status = 'completed', completed_at = ${now} WHERE id = ?`, id);
        db.run("UPDATE concepts SET status = 'learning' WHERE status = 'not_studied' AND manual_status = 0 AND id IN (SELECT concept_id FROM lesson_concepts WHERE lesson_id = ?)", id);
        db.run("UPDATE lessons SET status = 'available' WHERE module_id = ? AND ord = ? AND status = 'locked'", l.module_id, l.ord + 1);
        db.run(`UPDATE topics SET updated_at = ${now} WHERE id = ?`, l.topic_id);
      });
      game.award('lesson_complete', 'lesson', id, XP.lesson_complete, `Lección completada: «${l.title}»`);
      game.markActivity('lesson');
    }
    return { ok: true, value: this.getLesson(id)! };
  }

  /** Tras una evaluación de módulo aprobada: completa el módulo, desbloquea el siguiente y comprueba el dominio del tema. */
  onModuleQuizPassed(moduleId: number) {
    const { db, game } = this.d;
    const m = db.get<{ id: number; topic_id: number; ord: number; title: string; status: string }>('SELECT id, topic_id, ord, title, status FROM modules WHERE id = ?', moduleId);
    if (!m || m.status === 'completed') return;
    const open = db.get<{ n: number }>("SELECT COUNT(*) n FROM lessons WHERE module_id = ? AND status <> 'completed'", moduleId)!.n;
    if (open) return;
    db.tx(() => {
      db.run(`UPDATE modules SET status = 'completed', completed_at = ${now} WHERE id = ?`, moduleId);
      const next = db.get<{ id: number }>('SELECT id FROM modules WHERE topic_id = ? AND ord > ? ORDER BY ord LIMIT 1', m.topic_id, m.ord);
      if (next) {
        db.run("UPDATE modules SET status = 'available' WHERE id = ? AND status = 'locked'", next.id);
        db.run("UPDATE lessons SET status = 'available' WHERE module_id = ? AND ord = (SELECT MIN(ord) FROM lessons WHERE module_id = ?) AND status = 'locked'", next.id, next.id);
      }
    });
    game.award('module_complete', 'module', moduleId, XP.module_complete, `Módulo completado: «${m.title}»`);
    this.checkTopicMastery(m.topic_id);
  }

  /** Un tema se domina al completar todos sus módulos y su proyecto final. */
  checkTopicMastery(topicId: number) {
    const { db, game } = this.d;
    const t = db.get<{ title: string; status: string }>('SELECT title, status FROM topics WHERE id = ?', topicId);
    if (!t || t.status === 'mastered') return;
    const mods = db.get<{ n: number; done: number }>("SELECT COUNT(*) n, SUM(status = 'completed') done FROM modules WHERE topic_id = ?", topicId)!;
    const finalOpen = db.get<{ n: number }>("SELECT COUNT(*) n FROM challenges WHERE topic_id = ? AND is_final = 1 AND status <> 'completed'", topicId)!.n;
    if (!mods.n || mods.done < mods.n || finalOpen) return;
    db.run(`UPDATE topics SET status = 'mastered', mastered_at = ${now}, updated_at = ${now} WHERE id = ?`, topicId);
    game.award('topic_mastered', 'topic', topicId, XP.topic_mastered, `Tema dominado: «${t.title}»`);
  }

  /* ───────── Tutor y acciones de lección ───────── */

  tutorConversation(topicId: number): number {
    const existing = this.d.db.get<{ id: number }>("SELECT id FROM conversations WHERE topic_id = ? AND kind = 'tutor' ORDER BY id DESC LIMIT 1", topicId);
    if (existing) return existing.id;
    const t = this.d.db.get<{ title: string }>('SELECT title FROM topics WHERE id = ?', topicId);
    if (!t) throw new Error('Tema no encontrado.');
    return this.d.ask.createConversation('tutor', `Tutor · ${t.title}`, topicId, null);
  }

  lessonConversation(id: number): number {
    const l = this.getLesson(id, false);
    if (!l) throw new Error('Lección no encontrada.');
    return l.conversationId ?? this.d.ask.createConversation('lesson', `Lección · ${l.title}`, l.topicId, id);
  }

  async lessonAction(id: number, action: LessonAction, ctx: TaskContext, extra?: string): Promise<Gen<{ conversationId: number }>> {
    const lesson = this.getLesson(id, false);
    if (!lesson) return fail('Lección no encontrada.');
    if (!lesson.units.length) return fail('Prepara primero la lección.');
    const unit = lesson.units[Math.min(lesson.currentUnit, lesson.units.length - 1)];
    const focus = `«${unit.title}» (lección «${lesson.title}»)`;
    const text: Record<LessonAction, string> = {
      simpler: `Explícamelo de forma más sencilla, dividiéndolo en ideas pequeñas y con una analogía cotidiana: ${focus}.`,
      example: `Dame otro ejemplo, distinto a los de la lección y bien concreto, de ${focus}.`,
      technical: `Explícamelo con rigor técnico: definiciones precisas, funcionamiento interno y casos límite de ${focus}.`,
      exercise: `Ponme un ejercicio práctico sobre ${focus}. No me des la solución: espera mi respuesta y corrígela.`,
      relate: `Relaciona ${focus} con ${extra?.trim() || 'otros conceptos de este tema'}: semejanzas, diferencias y cuándo aplicar cada uno.`,
    };
    const conversationId = lesson.conversationId ?? this.d.ask.createConversation('lesson', `Lección · ${lesson.title}`, lesson.topicId, id);
    const r = await this.d.ask.ask({ conversationId, question: text[action] }, ctx.onProgress, ctx.signal);
    if (!r.ok) return { ok: false, errorKind: r.errorKind, error: r.error };
    return { ok: true, value: { conversationId } };
  }

  /** Contexto pedagógico que acompaña cada mensaje del tutor o del chat de una lección. */
  conversationContext(conv: ConversationRow): ConversationContext | null {
    const { db } = this.d;
    if (!conv.topic_id) return null;
    const t = this.getTopic(conv.topic_id);
    if (!t) return null;
    const outline = t.modules
      .map((m) => `- ${m.title} [${STAGE[m.status]}]: ${m.lessons.map((l) => `${l.title} (${STAGE[l.status]})`).join(', ')}`)
      .join('\n');
    const recent = db
      .all<{ title: string; score: number }>("SELECT title, score FROM assessments WHERE topic_id = ? AND status = 'graded' AND kind <> 'lesson_check' ORDER BY id DESC LIMIT 4", conv.topic_id)
      .map((a) => `${a.title}: ${Math.round(a.score * 100)}%`);
    const lines = [
      `Tema: ${t.title} · nivel ${t.level ?? 'sin diagnosticar'} · objetivo: ${t.objective}`,
      t.diagnosis ? `Diagnóstico: ${t.diagnosis.summary}. Lagunas: ${t.diagnosis.gaps.join(', ') || 'ninguna'}.` : '',
      `Ruta:\n${outline}`,
      t.weakConcepts.length ? `Conceptos débiles: ${t.weakConcepts.map((c) => `${c.name} (${Math.round(c.mastery * 100)}%)`).join(', ')}` : '',
      recent.length ? `Últimos resultados: ${recent.join('; ')}` : '',
    ];
    let hint = t.title;
    if (conv.kind === 'lesson' && conv.lesson_id) {
      const l = this.getLesson(conv.lesson_id, false);
      if (l) {
        lines.push(`LECCIÓN ACTUAL: ${l.title} (unidad ${l.currentUnit + 1} de ${l.units.length})`);
        lines.push(l.units.map((u, i) => `${i + 1}. [${u.kind}] ${u.title}: ${u.body.slice(0, 260).replace(/\s+/g, ' ')}`).join('\n'));
        hint = `${l.title} ${l.concepts.join(' ')}`;
      }
    }
    return { system: conv.kind === 'tutor' ? TUTOR_SYSTEM : LESSON_CHAT_SYSTEM, context: lines.filter(Boolean).join('\n'), scope: t.scope, retrievalHint: hint };
  }

  provided(topicId: number, query: string, max = 10): ProvidedSource[] {
    return this.d.vault.retrieve(query, max, 3, this.scopeOf(topicId));
  }
}

const STAGE: Record<StageStatus, string> = { locked: 'bloqueado', available: 'disponible', in_progress: 'en curso', completed: 'completado' };
