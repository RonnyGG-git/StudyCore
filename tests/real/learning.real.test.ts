import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { Gen } from '../../shared/learning';
import { AppCore } from '../../electron/core/app-core';

// Flujo educativo completo contra la CLI REAL y el vault real (solo lectura). Consume uso del plan.
const VAULT = process.env.STUDYCORE_REAL_VAULT || 'C:/RONNY/MIND/CEREBRO';
const ok = <T>(g: Gen<T>, step: string): T => {
  if (!g.ok) throw new Error(`${step} → ${g.errorKind}: ${g.error}`);
  return g.value;
};
const log = (...a: unknown[]) => console.log('[real]', ...a);

it('flujo real: tema → diagnóstico → ruta → lección → quiz → tarjetas → reto', async () => {
  const dataDir = process.env.STUDYCORE_REAL_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'studycore-real-'));
  const core = new AppCore({ dataDir, defaultOutputDir: path.join(dataDir, 'salida') });
  const ctx = (label: string) => ({ onProgress: (t: string) => log(label, '·', t) });
  const t0 = Date.now();
  const lap = (s: string) => log(`${s} (${Math.round((Date.now() - t0) / 1000)} s)`);
  try {
    core.updateSettings({ vaultPath: VAULT, model: 'sonnet' });
    await core.reindex(() => {});

    const created = ok(await core.learning.createTopic({ title: 'Subneteo IPv4 y VLSM', goal: 'Saber diseñar el direccionamiento de una red', scope: ['06 Redes'] }, ctx('diag')), 'diagnóstico');
    const diag = core.quiz.get(created.assessmentId)!;
    lap(`Diagnóstico: ${diag.questions.length} preguntas → ${diag.questions.map((q) => `${q.type}:${q.concept}`).join(' | ')}`);
    for (const q of diag.questions) {
      const resp = q.type === 'multiple_choice' ? 0 : q.type === 'true_false' ? true : q.ord % 2 ? null : 'Se toma la máscara y se cuentan los bits de host para saber cuántas direcciones hay.';
      ok(core.quiz.saveAnswer(q.id, resp), 'respuesta diagnóstico');
    }
    const topic = ok(await core.learning.submitDiagnostic(created.assessmentId, ctx('ruta')), 'ruta');
    lap(`Ruta: nivel ${topic.level}, ${topic.modules.length} módulos, ${topic.lessonCount} lecciones, ${topic.concepts} conceptos`);
    log('Módulos:', topic.modules.map((m) => `${m.title} [${m.lessons.map((l) => l.title).join(' / ')}]`));
    log('Diagnóstico:', topic.diagnosis);
    expect(topic.modules[0].lessons[0].status).toBe('available');

    const lesson = ok(await core.learning.generateLesson(topic.modules[0].lessons[0].id, ctx('lección')), 'lección');
    lap(`Lección «${lesson.title}»: ${lesson.units.length} unidades (${lesson.units.map((u) => u.kind).join(',')}); fuentes ${lesson.sources.filter((s) => s.verified).length}/${lesson.sources.length} verificadas`);
    log('Unidad 2:', lesson.units[1]?.body.slice(0, 400));
    for (const u of lesson.units.filter((x) => x.check)) {
      const q = ok(await core.quiz.checkAnswer(u.check!.id, u.check!.type === 'true_false' ? true : 0, ctx('check')), 'comprobación');
      log('Comprobación:', q.answer?.verdict, q.answer?.feedback?.analysis.slice(0, 160));
    }
    ok(core.learning.completeLesson(lesson.id), 'completar');

    const quiz = ok(await core.quiz.create({ topicId: topic.id, kind: 'lesson_quiz', mode: 'practice', lessonId: lesson.id, count: 4 }, ctx('quiz')), 'quiz');
    lap(`Quiz: ${quiz.questions.map((q) => q.type).join(', ')}`);
    const open = quiz.questions.find((q) => !['multiple_choice', 'true_false', 'fill_blank', 'matching'].includes(q.type));
    if (open) {
      const g = ok(await core.quiz.checkAnswer(open.id, 'Creo que VLSM sirve para que todas las subredes tengan el mismo tamaño y así sea más fácil.', ctx('corrección')), 'corrección');
      lap(`Corrección abierta (respuesta errónea a propósito): ${g.answer?.verdict} ${Math.round((g.answer?.score ?? 0) * 100)}%`);
      log('Análisis:', g.answer?.feedback?.analysis);
      log('Errores de razonamiento:', g.answer?.feedback?.reasoningErrors);
      expect(g.answer!.score).toBeLessThan(0.7);
    }

    const cards = ok(await core.cards.generate({ topicId: topic.id, lessonId: lesson.id, count: 5 }, ctx('tarjetas')), 'tarjetas');
    lap(`Tarjetas: ${cards.created}`);
    const ch = ok(await core.challenges.create({ topicId: topic.id, moduleId: topic.modules[0].id }, ctx('reto')), 'reto');
    lap(`Reto: «${ch.title}» · criterios ${ch.criteria.length} · pistas ${ch.hintsTotal}`);

    const g = core.game.state();
    lap(`XP ${g.xp}, nivel ${g.level.n} ${g.level.name}, logros ${g.achievements.filter((a) => a.unlockedAt).map((a) => a.name).join(', ')}`);
    log('Uso:', core.dashboard().usage);
    expect(g.xp).toBeGreaterThanOrEqual(35);
  } finally {
    core.shutdown();
  }
});
