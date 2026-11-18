import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AssessmentView, ChallengeView, Gen, LessonView, QuestionView, TopicDetail } from '../../shared/learning';
import { AppCore } from '../../electron/core/app-core';
import { ClaudeClient } from '../../electron/core/claude/claude-client';
import { createRpc, invokeRpc, type RpcTable } from '../../electron/core/rpc';
import { SAMPLE_VAULT, tempDir, writeFiles } from './helpers';

const FAKE = path.resolve(__dirname, '../fixtures/fake-claude.cjs');

/**
 * Recorre el ejemplo del documento de requisitos (sección 16) de punta a punta,
 * a través de la misma capa RPC que usa la interfaz, con la CLI de Claude simulada.
 */
describe('Flujo completo de aprendizaje', () => {
  let core: AppCore;
  let rpc: RpcTable;
  let out: string;
  const progress: string[] = [];
  const rewards: { xp: number; reason: string }[] = [];
  const call = async <T>(m: string, ...a: unknown[]) => (await invokeRpc(rpc, m, a)) as T;
  const ok = <T>(g: Gen<T>): T => {
    if (!g.ok) throw new Error(`${g.errorKind}: ${g.error}`);
    return g.value;
  };

  let topic: TopicDetail;

  beforeAll(async () => {
    const root = tempDir('vault-');
    out = tempDir('out-');
    writeFiles(root, SAMPLE_VAULT);
    core = new AppCore({ dataDir: tempDir('data-'), defaultOutputDir: out, claude: new ClaudeClient({ executable: process.execPath, prefixArgs: [FAKE] }) });
    core.updateSettings({ vaultPath: root });
    await core.reindex(() => {});
    rpc = createRpc(core, (_r, t) => progress.push(t));
    core.game.onReward = (r) => rewards.push(r);
  });
  afterAll(() => core.shutdown());

  it('1-4 · crea el tema, genera el diagnóstico sin exponer las soluciones y lo corrige', async () => {
    const created = ok(await call<Gen<{ topicId: number; assessmentId: number }>>('topicCreate', { title: 'SQL', goal: 'consultas', scope: ['notas'] }, 'r1'));
    const diag = (await call<AssessmentView>('assessmentGet', created.assessmentId))!;
    expect(diag.questions).toHaveLength(6);
    expect(JSON.stringify(diag)).not.toMatch(/"correct"|modelAnswer|optionFeedback/);
    for (const q of diag.questions) {
      const resp = q.type === 'multiple_choice' ? 0 : q.type === 'true_false' ? true : q.ord === 3 ? null : 'Sirve para buscar rápido';
      ok(await call<Gen<QuestionView>>('answerSave', q.id, resp));
    }
    expect((await call<AssessmentView>('assessmentGet', diag.id)).questions[0].answer!.verdict).toBe('pendiente');
    topic = ok(await call<Gen<TopicDetail>>('topicSubmitDiagnostic', created.assessmentId, 'r2'));
    expect(topic).toMatchObject({ status: 'active', level: 'intermedio', moduleCount: 2, lessonCount: 3 });
    expect(topic.diagnosis!.gaps).toEqual(['Índices']);
    expect(topic.modules[0].status).toBe('available');
    expect(topic.modules[0].lessons.map((l) => l.status)).toEqual(['available', 'locked']);
    expect(topic.modules[1].status).toBe('locked');
    expect(topic.finalChallengeId).not.toBeNull();
    const graded = (await call<AssessmentView>('assessmentGet', created.assessmentId))!;
    expect(graded.status).toBe('graded');
    expect(graded.questions.find((q) => q.ord === 2)!.answer!.score).toBe(0.5);
    expect(core.game.xp()).toBe(15);
    expect(progress).toContain('Claude está analizando tus documentos sobre el tema…');
  });

  it('prerrequisitos y fuentes de los conceptos', async () => {
    const left = core.db.get<{ id: number }>("SELECT id FROM concepts WHERE name = 'LEFT JOIN'")!;
    const c = (await call<any>('conceptGet', left.id))!;
    expect(c.prerequisites.map((p: any) => p.name)).toEqual(['INNER JOIN']);
    const inner = core.db.get<{ id: number }>("SELECT id FROM concepts WHERE name = 'INNER JOIN'")!;
    expect((await call<any>('conceptGet', inner.id)).sources[0]).toMatchObject({ path: 'notas/sql.md', verified: true });
  });

  it('mapa de conocimientos: los fundamentos van antes que lo que depende de ellos', async () => {
    const map = await call<any>('conceptMap', topic.id);
    const depth = (n: string) => map.nodes.find((x: any) => x.name === n).depth;
    expect(depth('LEFT JOIN')).toBeGreaterThan(depth('INNER JOIN'));
    expect(map.edges).toContainEqual(expect.objectContaining({ kind: 'prerequisite' }));
  });

  it('5 · una lección bloqueada no se puede preparar', async () => {
    const locked = topic.modules[0].lessons[1];
    const r = await call<Gen<LessonView>>('lessonGenerate', locked.id, 'r3');
    expect(r.ok).toBe(false);
  });

  let lesson: LessonView;
  it('5-6 · prepara la lección en unidades, exige las comprobaciones y desbloquea la siguiente', async () => {
    lesson = ok(await call<Gen<LessonView>>('lessonGenerate', topic.modules[0].lessons[0].id, 'r4'));
    expect(lesson.units.length).toBe(11);
    expect(lesson.units.filter((u) => u.check)).toHaveLength(2);
    expect(lesson.sources[0].verified).toBe(true);
    expect(lesson.status).toBe('in_progress');
    expect((await call<Gen<LessonView>>('lessonComplete', lesson.id)).ok).toBe(false);
    for (const u of lesson.units.filter((x) => x.check)) {
      const q = ok(await call<Gen<QuestionView>>('answerCheck', u.check!.id, u.check!.type === 'true_false' ? true : 0, 'r5'));
      expect(q.answer!.feedback).not.toBeNull();
    }
    await call('lessonSetUnit', lesson.id, 10);
    const done = ok(await call<Gen<LessonView>>('lessonComplete', lesson.id));
    expect(done.status).toBe('completed');
    expect(core.game.xp()).toBe(15 + 20);
    const t = (await call<TopicDetail>('topicGet', topic.id))!;
    expect(t.modules[0].lessons[1].status).toBe('available');
    expect((await call<any>('game')).achievements.find((a: any) => a.code === 'first_lesson').unlockedAt).not.toBeNull();
  });

  it('acciones de lección y tutor con contexto de la ruta', async () => {
    const r = ok(await call<Gen<{ conversationId: number }>>('lessonAction', lesson.id, 'simpler', 'r6'));
    const conv = core.ask.get(r.conversationId)!;
    expect(conv.messages_[0].content).toMatch(/más sencilla/);
    const argsFile = path.join(out, 'tutor-args.json');
    process.env.FAKE_ARGS_FILE = argsFile;
    const tutorId = await call<number>('tutorOpen', topic.id);
    expect(await call<number>('tutorOpen', topic.id)).toBe(tutorId);
    const a = await core.askQuestion({ conversationId: tutorId, question: '¿Por qué falla mi JOIN?', requestId: 'r7' }, () => {});
    delete process.env.FAKE_ARGS_FILE;
    expect(a.ok).toBe(true);
    const sent = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    expect(sent.input).toContain('CONTEXTO DEL ESTUDIANTE');
    expect(sent.input).toContain('Fundamentos de JOIN');
    expect(sent.args[sent.args.indexOf('--system-prompt') + 1]).toMatch(/socrático/);
    expect(core.ask.list(50, 'ask').some((c) => c.id === tutorId)).toBe(false);
  });

  it('7-8 · el modo examen oculta la corrección hasta entregar; los fallos repetidos activan el refuerzo', async () => {
    const quiz = ok(await call<Gen<AssessmentView>>('quizCreate', { topicId: topic.id, kind: 'practice', mode: 'exam', conceptIds: [core.db.get<{ id: number }>("SELECT id FROM concepts WHERE name = 'INNER JOIN'")!.id] }, 'r8'));
    expect(quiz.questions.length).toBe(5); // la pregunta incoherente se descarta
    expect(quiz.questions.map((q) => q.type).sort()).toEqual(['fill_blank', 'matching', 'multiple_choice', 'short_answer', 'true_false']);
    for (const q of quiz.questions) {
      const wrong = { multiple_choice: 0, true_false: false, fill_blank: ['x', 'y'], short_answer: 'no sé bien' } as Record<string, unknown>;
      const resp = q.type === 'matching' ? [q.right!.indexOf('conserva izquierda'), q.right!.indexOf('coincidencias')] : wrong[q.type];
      ok(await call<Gen<QuestionView>>('answerSave', q.id, resp));
    }
    expect((await call<Gen<QuestionView>>('answerCheck', quiz.questions[0].id, 2, 'r9')).ok).toBe(false);
    const before = (await call<AssessmentView>('assessmentGet', quiz.id))!;
    expect(before.questions.every((q) => q.answer!.feedback === null)).toBe(true);
    process.env.FAKE_GRADE_SCORE = '0.1';
    const graded = ok(await call<Gen<AssessmentView>>('assessmentSubmit', quiz.id, 'r10'));
    delete process.env.FAKE_GRADE_SCORE;
    expect(graded.status).toBe('graded');
    expect(graded.passed).toBe(false);
    expect(graded.review[0]).toMatch(/INNER JOIN/);
    const open = graded.questions.find((q) => q.type === 'short_answer')!;
    expect(open.answer!.feedback!.reasoningErrors).toEqual(['Falta un matiz']);
    const fb = graded.questions.find((q) => q.type === 'fill_blank')!.answer!.feedback!;
    expect(fb.reasoningErrors[0]).toMatch(/Hueco 1/);

    const recs = await call<any[]>('recommendations');
    const reinforce = recs.find((r) => r.action === 'reinforce_concept');
    expect(reinforce.title).toMatch(/INNER JOIN/);
    const ref = ok(await call<Gen<AssessmentView>>('quizCreate', { topicId: topic.id, kind: 'reinforcement', mode: 'practice', conceptIds: [reinforce.targetId] }, 'r11'));
    expect(ref.intro).toMatch(/Nueva explicación/);
    expect(ref.difficulty).toBeLessThan(quiz.difficulty + 1);
    const titles = new Set(quiz.questions.map((q) => q.prompt));
    expect(ref.questions.some((q) => titles.has(q.prompt))).toBe(false);
  });

  it('9-13 · completa el módulo con su evaluación, desbloquea el siguiente y otorga XP', async () => {
    const l2 = ok(await call<Gen<LessonView>>('lessonGenerate', topic.modules[0].lessons[1].id, 'r12'));
    for (const u of l2.units.filter((x) => x.check)) ok(await call('answerCheck', u.check!.id, u.check!.type === 'true_false' ? true : 1, 'r13'));
    ok(await call<Gen<LessonView>>('lessonComplete', l2.id));
    const mq = ok(await call<Gen<AssessmentView>>('quizCreate', { topicId: topic.id, kind: 'module_quiz', mode: 'exam', moduleId: topic.modules[0].id }, 'r14'));
    const right = { multiple_choice: 2, true_false: true, fill_blank: ['JOIN', 'Indice'], matching: [0, 1], short_answer: 'respuesta completa' } as Record<string, unknown>;
    for (const q of mq.questions) {
      // las opciones de "relacionar" se barajan: se responde según el texto
      const resp = q.type === 'matching' ? [q.right!.indexOf('coincidencias'), q.right!.indexOf('conserva izquierda')] : right[q.type];
      ok(await call('answerSave', q.id, resp));
    }
    process.env.FAKE_GRADE_SCORE = '1';
    const g = ok(await call<Gen<AssessmentView>>('assessmentSubmit', mq.id, 'r15'));
    delete process.env.FAKE_GRADE_SCORE;
    expect(g.score).toBe(1);
    expect(g.passed).toBe(true);
    const t = (await call<TopicDetail>('topicGet', topic.id))!;
    expect(t.modules[0].status).toBe('completed');
    expect(t.modules[1].status).toBe('available');
    expect(t.modules[1].lessons[0].status).toBe('available');
    const kinds = core.db.all<{ kind: string }>('SELECT kind FROM xp_events').map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(['quiz_excellent', 'module_complete']));
    // la misma evaluación no puede cobrarse dos veces
    const xp = core.game.xp();
    await call('assessmentSubmit', mq.id, 'r16');
    expect(core.game.xp()).toBe(xp);
    expect(rewards.some((r) => r.reason.startsWith('Módulo completado'))).toBe(true);
  });

  it('14 · tarjetas generadas sin duplicados, con fuentes válidas y repetición espaciada', async () => {
    const r = ok(await call<Gen<{ created: number }>>('cardsGenerate', { topicId: topic.id }, 'r17'));
    expect(r.created).toBe(2);
    const cards = await call<any[]>('cardsDue', null, 50);
    expect(cards).toHaveLength(2);
    expect(cards.find((c) => c.sourcePath === 'notas/sql.md')).toBeTruthy();
    expect(cards.find((c) => c.front.includes('LEFT')).sourcePath).toBeNull();
    const reviewed = await call<any>('cardReview', cards[0].id, 3);
    expect(reviewed.intervalDays).toBe(1);
    const again = await call<any>('cardReview', cards[1].id, 1);
    expect(again.lapses).toBe(1);
    expect((await call<any>('cardsOverview')).forgetting.length).toBe(1);
    const manual = ok(await call<Gen<any>>('cardCreate', { topicId: topic.id, front: 'Pregunta', back: 'Respuesta' }));
    expect(manual.origin).toBe('manual');
    expect((await call<Gen<any>>('cardCreate', { topicId: topic.id, front: ' ', back: 'x' })).ok).toBe(false);
  });

  it('retos: pistas progresivas, solución oculta y XP solo sin ver la solución', async () => {
    const c = ok(await call<Gen<ChallengeView>>('challengeCreate', { topicId: topic.id }, 'r18'));
    expect(c.hints).toEqual([]);
    expect(c.solution).toBeNull();
    expect(c.canRevealSolution).toBe(false);
    expect((await call<ChallengeView>('challengeHint', c.id)).hints).toEqual(['Pista 1']);
    process.env.FAKE_PASS = '0';
    const failed = ok(await call<Gen<ChallengeView>>('challengeSubmit', c.id, 'SELECT * FROM ventas', 'r19'));
    delete process.env.FAKE_PASS;
    expect(failed.status).toBe('open');
    expect(failed.canRevealSolution).toBe(true);
    const revealed = await call<ChallengeView>('challengeRevealSolution', c.id);
    expect(revealed.solution).toMatch(/JOIN/);
    const xp = core.game.xp();
    const passed = ok(await call<Gen<ChallengeView>>('challengeSubmit', c.id, 'SELECT * FROM ventas v JOIN clientes c ON ...', 'r20'));
    expect(passed.status).toBe('completed');
    expect(core.game.xp()).toBe(xp);
  });

  it('15 · completa la ruta y el proyecto final: tema dominado', async () => {
    const t = (await call<TopicDetail>('topicGet', topic.id))!;
    const l3 = ok(await call<Gen<LessonView>>('lessonGenerate', t.modules[1].lessons[0].id, 'r21'));
    for (const u of l3.units.filter((x) => x.check)) ok(await call('answerCheck', u.check!.id, u.check!.type === 'true_false' ? true : 1, 'r22'));
    ok(await call('lessonComplete', l3.id));
    const mq = ok(await call<Gen<AssessmentView>>('quizCreate', { topicId: topic.id, kind: 'module_quiz', mode: 'practice', moduleId: t.modules[1].id }, 'r23'));
    for (const q of mq.questions) {
      const resp = q.type === 'matching' ? [q.right!.indexOf('coincidencias'), q.right!.indexOf('conserva izquierda')] : ({ multiple_choice: 2, true_false: true, fill_blank: ['join', 'índice'], short_answer: 'bien' } as any)[q.type];
      ok(await call('answerCheck', q.id, resp, 'r24'));
    }
    expect((await call<AssessmentView>('assessmentGet', mq.id)).status).toBe('graded');
    expect((await call<TopicDetail>('topicGet', topic.id))!.status).toBe('active');
    const fin = ok(await call<Gen<ChallengeView>>('challengePrepare', t.finalChallengeId!, 'r25'));
    expect(fin.isFinalProject).toBe(true);
    ok(await call('challengeSubmit', fin.id, 'Mi proyecto final completo con joins', 'r26'));
    const done = (await call<TopicDetail>('topicGet', topic.id))!;
    expect(done.status).toBe('mastered');
    expect(core.db.get<{ n: number }>("SELECT COUNT(*) n FROM xp_events WHERE kind = 'topic_mastered'")!.n).toBe(1);
    const game = await call<any>('game');
    expect(game.achievements.filter((a: any) => a.unlockedAt).map((a: any) => a.code)).toEqual(
      expect.arrayContaining(['first_lesson', 'first_exam', 'first_module', 'first_topic', 'first_challenge']),
    );
    expect(game.level.n).toBeGreaterThanOrEqual(3);
  });

  it('glosario: genera, verifica fuentes, completa fichas y marca estados', async () => {
    const r = ok(await call<Gen<{ added: number; updated: number }>>('glossaryGenerate', topic.id, 'r27'));
    expect(r).toEqual({ added: 1, updated: 1 });
    const vista = core.db.get<{ id: number }>("SELECT id FROM concepts WHERE name = 'Vista'")!;
    const v = await call<any>('conceptGet', vista.id);
    expect(v.sources[0].verified).toBe(false);
    expect(v.prerequisites[0].name).toBe('INNER JOIN');
    const left = core.db.get<{ id: number }>("SELECT id FROM concepts WHERE name = 'LEFT JOIN'")!;
    const exp = ok(await call<Gen<any>>('conceptExpand', left.id, 'r28'));
    expect(exp.explanation).toBe('Explicación completa.');
    expect(await call<boolean>('conceptToggleFavorite', left.id)).toBe(true);
    await call('conceptSetStatus', left.id, 'mastered');
    expect((await call<any[]>('conceptsList', { favorites: true }))[0]).toMatchObject({ name: 'LEFT JOIN', status: 'mastered' });
  });

  it('planificador: objetivos con datos reales, sesiones, recomendaciones de Claude validadas', async () => {
    await call('trackTime', 30, 'lesson');
    const goals = await call<any[]>('goalSave', { period: 'daily', metric: 'lessons', target: 2 });
    expect(goals[0]).toMatchObject({ current: 3, done: true });
    const today = new Date().toISOString().slice(0, 10);
    const s = await call<any>('sessionSave', { topicId: topic.id, title: 'Repaso', date: today, minutes: 30 });
    await call('sessionSave', { ...s, status: 'done' });
    expect((await call<any>('plannerStats')).compliance).toBe(1);
    // la recomendación de Claude que apunta a un id inexistente se descarta
    const t = (await call<TopicDetail>('topicGet', topic.id))!;
    expect(t.status).toBe('mastered');
    const rec = await call<Gen<any[]>>('recommendWithClaude', 30, 'r29');
    expect(rec.ok && rec.value.every((x) => x.targetId !== 99999)).toBe(true);
    const home = await call<any>('home');
    expect(home.game.xp).toBe(core.game.xp());
    expect(home.today.questions).toBeGreaterThan(0);
    expect(home.week).toHaveLength(7);
  });

  it('estadísticas, exportación y validación del RPC', async () => {
    const st = await call<any>('stats');
    expect(st.totals.lessons).toBe(3);
    expect(st.totals.correctPct).toBeGreaterThan(0);
    expect(st.questionTypes.length).toBeGreaterThan(3);
    const ex = ok(await call<Gen<string>>('exportData'));
    expect(fs.existsSync(ex) && fs.existsSync(ex.replace(/\.json$/, '.md'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(ex, 'utf8')).topics).toHaveLength(1);
    await expect(call('nope')).rejects.toThrow(/desconocido/);
    await expect(call('topicGet', -1)).rejects.toThrow(/no válida/);
    await expect(call('answerSave', 1, { evil: true })).rejects.toThrow(/no válida/);
    await expect(call('constructor')).rejects.toThrow(/desconocido/);
  });
});
