import { describe, expect, it } from 'vitest';
import { autoGrade, normalizeQuestion, responseIsValid, toQuestionView } from '../../electron/core/assess/questions';
import { Db } from '../../electron/core/db/database';
import { addDays, GameService, levelFor, LEVELS } from '../../electron/core/game/game-service';
import { ActivityLog } from '../../electron/core/log/activity-log';
import { schedule } from '../../electron/core/memory/cards-service';
import { weekStart } from '../../electron/core/planner/planner-service';

describe('preguntas', () => {
  const base = { prompt: 'p', concept: 'c', difficulty: 2, explanation: 'e' };
  it('descarta preguntas incoherentes', () => {
    expect(normalizeQuestion({ ...base, type: 'multiple_choice', options: ['a', 'b'], correct_index: 2 })).toBeNull();
    expect(normalizeQuestion({ ...base, type: 'fill_blank', prompt: 'a ___ b', blanks: [['x'], ['y']] })).toBeNull();
    expect(normalizeQuestion({ ...base, type: 'matching', left: ['a', 'b'], right: ['1', '2'], pairs: [0, 0] })).toBeNull();
    expect(normalizeQuestion({ ...base, type: 'essay' })).toBeNull();
    expect(normalizeQuestion({ ...base, type: 'true_false', correct_bool: false })).not.toBeNull();
  });

  it('baraja relacionar y corrige con la correspondencia correcta', () => {
    const q = normalizeQuestion({ ...base, type: 'matching', prompt: 'semilla', left: ['A', 'B', 'C'], right: ['a', 'b', 'c'], pairs: [0, 1, 2] })!;
    const right = q.data.right as string[];
    const answer = ['a', 'b', 'c'].map((x) => right.indexOf(x));
    expect(autoGrade('matching', q.data, q.solution, '', answer, null)!.score).toBe(1);
    expect(autoGrade('matching', q.data, q.solution, '', [answer[1], answer[0], answer[2]], null)!.score).toBeCloseTo(1 / 3);
  });

  it('completar espacios acepta alternativas sin acentos ni mayúsculas y da crédito parcial', () => {
    const q = normalizeQuestion({ ...base, type: 'fill_blank', prompt: 'Un ___ y un ___', blanks: [['índice'], ['JOIN', 'unión']] })!;
    expect(autoGrade('fill_blank', q.data, q.solution, '', ['INDICE', ' union '], null)!.score).toBe(1);
    const half = autoGrade('fill_blank', q.data, q.solution, '', ['tabla', 'join'], 'Índices')!;
    expect(half.score).toBe(0.5);
    expect(half.feedback.reviewSuggestion).toMatch(/Índices/);
  });

  it('la vista nunca incluye la solución y oculta la corrección si no corresponde', () => {
    const row: any = { id: 1, ord: 0, type: 'multiple_choice', prompt: 'p', data: '{"options":["a","b"]}', solution: '{"correct":1}', explanation: 'x', concept_name: 'c', difficulty: 2, points: 1, a_response: '0', a_score: 0, a_verdict: 'incorrecta', a_feedback: '{"analysis":"x"}' };
    const hidden = toQuestionView(row, false);
    expect(hidden.answer).toMatchObject({ verdict: 'pendiente', feedback: null });
    expect(JSON.stringify(hidden)).not.toContain('correct');
    expect(toQuestionView(row, true).answer!.verdict).toBe('incorrecta');
  });

  it('valida las respuestas según el tipo', () => {
    expect(responseIsValid('multiple_choice', { options: ['a', 'b'] }, 2)).toBe(false);
    expect(responseIsValid('matching', { left: ['a'], right: ['b'] }, [0])).toBe(true);
    expect(responseIsValid('short_answer', {}, '   ')).toBe(false);
  });
});

describe('repetición espaciada', () => {
  const fresh = { intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
  it('progresa 1 → 3 → ×facilidad con «Bien»', () => {
    const a = schedule(fresh, 3);
    const b = schedule(a, 3);
    const c = schedule(b, 3);
    expect([a.intervalDays, b.intervalDays]).toEqual([1, 3]);
    expect(c.intervalDays).toBeCloseTo(7.5);
  });
  it('«Otra vez» reinicia, cuenta el olvido y baja la facilidad sin pasar del mínimo', () => {
    let s = { ...fresh, ease: 1.35, reps: 4, intervalDays: 20 };
    const r = schedule(s, 1);
    expect(r).toMatchObject({ reps: 0, lapses: 1, ease: 1.3 });
    expect(r.intervalDays * 1440).toBeCloseTo(10);
    s = { ...fresh };
    expect(schedule(s, 4).intervalDays).toBeGreaterThan(schedule(s, 3).intervalDays);
  });
});

describe('gamificación', () => {
  it('niveles con progresión creciente', () => {
    expect(LEVELS).toHaveLength(7);
    const gaps = LEVELS.slice(1).map((l, i) => l.min - LEVELS[i].min);
    expect(gaps.every((g, i) => i === 0 || g > gaps[i - 1])).toBe(true);
    expect(levelFor(0).name).toBe('Principiante');
    expect(levelFor(449)).toMatchObject({ n: 2, next: 450 });
    expect(levelFor(99999)).toMatchObject({ n: 7, next: null });
  });

  it('la XP de un evento se cobra una sola vez y avisa de la subida de nivel', () => {
    const db = new Db(':memory:');
    const g = new GameService(db, new ActivityLog(db, null));
    expect(g.award('lesson_complete', 'lesson', 1, 200, 'x')!.levelUp).toMatchObject({ n: 2 });
    expect(g.award('lesson_complete', 'lesson', 1, 200, 'x')).toBeNull();
    expect(g.xp()).toBe(200);
  });

  it('rachas por días con actividad real, bonificación por hitos y mejor racha', () => {
    const db = new Db(':memory:');
    let today = '2026-11-10';
    const g = new GameService(db, new ActivityLog(db, null), () => today);
    for (const d of ['2026-11-01', '2026-11-02', '2026-11-08', '2026-11-09', '2026-11-10']) {
      today = d;
      g.markActivity('question');
    }
    expect(g.streak()).toEqual({ current: 3, best: 3, activeToday: true });
    expect(db.get<{ n: number }>("SELECT COUNT(*) n FROM xp_events WHERE kind = 'streak'")!.n).toBe(1);
    today = '2026-11-11';
    expect(g.streak()).toMatchObject({ current: 3, activeToday: false });
    today = '2026-11-12';
    expect(g.streak().current).toBe(0);
    g.addStudyTime(500);
    expect(db.get<{ s: number }>('SELECT active_seconds s FROM study_days WHERE day = ?', today)!.s).toBe(120);
  });

  it('fechas', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekStart('2026-11-18')).toBe('2026-11-16');
  });
});
