import { z } from 'zod';
import type { Gen, Rpc } from '../../shared/learning';
import type { AppCore } from './app-core';
import { conceptMap, getConcept, listConcepts } from './learning/concepts';
import { QUESTION_TYPES } from './learning/schemas';

const id = z.number().int().positive();
const req = z.string().min(1).max(64);
const optTopic = z.number().int().positive().nullable().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cardInput = z.object({
  topicId: z.number().int().positive().nullable(),
  front: z.string().max(2000),
  back: z.string().max(4000),
  explanation: z.string().max(4000).optional(),
  category: z.string().max(80).optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
});
/** Respuestas: número, booleano, texto, lista (huecos/relacionar) o null («No lo sé»). */
const response = z.union([z.null(), z.boolean(), z.number().int(), z.string().max(20_000), z.array(z.union([z.string().max(300), z.number().int(), z.null()])).max(30)]);

type Handler = { schema: z.ZodTuple<any, any>; fn: (...args: any[]) => unknown };
export type RpcTable = { [K in keyof Rpc]: Handler };

/**
 * Tabla de métodos invocables desde la interfaz. El proceso principal valida cada llamada contra
 * su esquema antes de ejecutarla; la interfaz nunca es de confianza.
 */
export function createRpc(core: AppCore, progress: (requestId: string, text: string) => void): RpcTable {
  const task = <T>(requestId: string, fn: Parameters<AppCore['withRequest']>[2]) =>
    core.withRequest(requestId, (t) => progress(requestId, t), fn) as Promise<Gen<T>>;
  const h = <S extends z.ZodTuple<any, any>>(schema: S, fn: (...args: z.infer<S>) => unknown): Handler => ({ schema, fn: fn as Handler['fn'] });

  return {
    home: h(z.tuple([]), () => core.planner.home()),
    topicsList: h(z.tuple([]), () => core.learning.listTopics()),
    topicGet: h(z.tuple([id]), (i) => core.learning.getTopic(i)),
    topicCreate: h(z.tuple([z.object({ title: z.string().max(200), goal: z.string().max(1000), scope: z.array(z.string().max(1024)).max(50) }), req]), (input, r) =>
      task(r, (ctx) => core.learning.createTopic(input, ctx)),
    ),
    topicSubmitDiagnostic: h(z.tuple([id, req]), (a, r) => task(r, (ctx) => core.learning.submitDiagnostic(a, ctx))),
    topicDelete: h(z.tuple([id]), (i) => core.learning.deleteTopic(i)),

    lessonGet: h(z.tuple([id]), (i) => core.learning.getLesson(i)),
    lessonGenerate: h(z.tuple([id, req, z.boolean().optional()]), (i, r, regen) => task(r, (ctx) => core.learning.generateLesson(i, ctx, regen ?? false))),
    lessonSetUnit: h(z.tuple([id, z.number().int().min(0).max(100)]), (i, u) => core.learning.setUnit(i, u)),
    lessonComplete: h(z.tuple([id]), (i) => core.learning.completeLesson(i)),
    lessonAction: h(z.tuple([id, z.enum(['simpler', 'example', 'technical', 'exercise', 'relate']), req, z.string().max(300).optional()]), (i, a, r, extra) =>
      task(r, (ctx) => core.learning.lessonAction(i, a, ctx, extra)),
    ),
    lessonConversation: h(z.tuple([id]), (i) => core.learning.lessonConversation(i)),
    tutorOpen: h(z.tuple([id]), (t) => core.learning.tutorConversation(t)),

    quizCreate: h(
      z.tuple([
        z.object({
          topicId: id,
          kind: z.enum(['lesson_quiz', 'module_quiz', 'practice', 'reinforcement', 'exam']),
          mode: z.enum(['practice', 'exam']),
          lessonId: id.nullable().optional(),
          moduleId: id.nullable().optional(),
          conceptIds: z.array(id).max(20).optional(),
          count: z.number().int().min(1).max(20).optional(),
          types: z.array(z.enum(QUESTION_TYPES)).max(9).optional(),
        }),
        req,
      ]),
      (q, r) => task(r, (ctx) => core.quiz.create(q, ctx)),
    ),
    assessmentGet: h(z.tuple([id]), (i) => core.quiz.get(i)),
    assessmentList: h(z.tuple([optTopic]), (t) => core.quiz.list(t ?? null)),
    answerSave: h(z.tuple([id, response]), (q, resp) => core.quiz.saveAnswer(q, resp)),
    answerCheck: h(z.tuple([id, response, req]), (q, resp, r) => task(r, (ctx) => core.quiz.checkAnswer(q, resp, ctx))),
    assessmentSubmit: h(z.tuple([id, req]), (a, r) => task(r, (ctx) => core.quiz.submit(a, ctx))),

    conceptsList: h(
      z.tuple([z.object({ topicId: optTopic, status: z.enum(['not_studied', 'learning', 'understood', 'mastered']).nullable().optional(), favorites: z.boolean().optional(), query: z.string().max(200).optional() })]),
      (f) => listConcepts(core.db, f),
    ),
    conceptGet: h(z.tuple([id]), (i) => getConcept(core.db, i)),
    conceptMap: h(z.tuple([id]), (t) => conceptMap(core.db, t)),
    conceptSetStatus: h(z.tuple([id, z.enum(['not_studied', 'learning', 'understood', 'mastered'])]), (i, s) =>
      core.db.run("UPDATE concepts SET status = ?, manual_status = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", s, i),
    ),
    conceptToggleFavorite: h(z.tuple([id]), (i) => {
      core.db.run('UPDATE concepts SET favorite = 1 - favorite WHERE id = ?', i);
      return !!core.db.get<{ favorite: number }>('SELECT favorite FROM concepts WHERE id = ?', i)?.favorite;
    }),
    conceptExpand: h(z.tuple([id, req]), (i, r) => task(r, (ctx) => core.glossary.expand(i, ctx))),
    glossaryGenerate: h(z.tuple([id, req]), (t, r) => task(r, (ctx) => core.glossary.generate(t, ctx))),

    game: h(z.tuple([]), () => core.game.state()),
    stats: h(z.tuple([]), () => core.game.stats()),
    trackTime: h(z.tuple([z.number().min(0).max(120), z.string().max(40)]), (s) => core.game.addStudyTime(s)),

    cardsOverview: h(z.tuple([]), () => core.cards.overview()),
    cardsDue: h(z.tuple([optTopic, z.number().int().min(1).max(200).optional()]), (t, l) => core.cards.due(t ?? null, l ?? 50)),
    cardsList: h(z.tuple([optTopic]), (t) => core.cards.list(t ?? null)),
    cardCreate: h(z.tuple([cardInput]), (c) => core.cards.create(c)),
    cardUpdate: h(z.tuple([id, cardInput]), (i, c) => core.cards.update(i, c)),
    cardDelete: h(z.tuple([id]), (i) => core.cards.delete(i)),
    cardReview: h(z.tuple([id, z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])]), (i, r) => core.cards.review(i, r)),
    cardsGenerate: h(z.tuple([z.object({ topicId: id, lessonId: id.nullable().optional(), count: z.number().int().min(3).max(25).optional() }), req]), (i, r) =>
      task(r, (ctx) => core.cards.generate(i, ctx)),
    ),

    challengesList: h(z.tuple([optTopic]), (t) => core.challenges.list(t ?? null)),
    challengeGet: h(z.tuple([id]), (i) => core.challenges.get(i)),
    challengeCreate: h(z.tuple([z.object({ topicId: id, moduleId: id.nullable().optional(), focus: z.string().max(300).optional() }), req]), (i, r) =>
      task(r, (ctx) => core.challenges.create(i, ctx)),
    ),
    challengePrepare: h(z.tuple([id, req]), (i, r) => task(r, (ctx) => core.challenges.prepareFinal(i, ctx))),
    challengeHint: h(z.tuple([id]), (i) => core.challenges.hint(i)),
    challengeSubmit: h(z.tuple([id, z.string().max(20_000), req]), (i, text, r) => task(r, (ctx) => core.challenges.submit(i, text, ctx))),
    challengeRevealSolution: h(z.tuple([id]), (i) => core.challenges.revealSolution(i)),

    goalsList: h(z.tuple([]), () => core.planner.goals()),
    goalSave: h(z.tuple([z.object({ id: id.optional(), period: z.enum(['daily', 'weekly']), metric: z.enum(['xp', 'lessons', 'questions', 'minutes', 'cards']), target: z.number().int().min(1).max(100_000) })]), (g) =>
      core.planner.saveGoal(g),
    ),
    goalDelete: h(z.tuple([id]), (i) => core.planner.deleteGoal(i)),
    sessionsList: h(z.tuple([day, day]), (f, t) => core.planner.sessions(f, t)),
    sessionSave: h(
      z.tuple([
        z.object({
          id: id.optional(),
          topicId: id.nullable(),
          title: z.string().max(160),
          date: day,
          minutes: z.number().int().min(5).max(600),
          status: z.enum(['planned', 'done', 'skipped']).optional(),
          notes: z.string().max(2000).optional(),
        }),
      ]),
      (s) => core.planner.saveSession(s),
    ),
    sessionDelete: h(z.tuple([id]), (i) => core.planner.deleteSession(i)),
    recommendations: h(z.tuple([]), () => core.planner.recommendations()),
    recommendWithClaude: h(z.tuple([z.number().int().min(10).max(480), req]), (m, r) => task(r, (ctx) => core.planner.recommendWithClaude(m, ctx))),
    plannerStats: h(z.tuple([]), () => core.planner.stats()),

    exportData: h(z.tuple([]), () => {
      const r = core.exportAll();
      return r.ok ? { ok: true, value: r.value } : { ok: false, errorKind: 'execution', error: r.error };
    }),
  };
}

/** Invoca un método validando sus argumentos. Lanza si el método no existe o los datos no son válidos. */
export async function invokeRpc(table: RpcTable, method: string, args: unknown[]): Promise<unknown> {
  if (!Object.prototype.hasOwnProperty.call(table, method)) throw new Error(`Método desconocido: ${method}`);
  const h = table[method as keyof Rpc];
  const parsed = h.schema.safeParse(args);
  if (!parsed.success) throw new Error(`Petición no válida (${method}).`);
  return h.fn(...(parsed.data as unknown[]));
}
