import { createHash } from 'node:crypto';
import type { AnswerView, Feedback, QuestionType, QuestionView, Verdict } from '../../../shared/learning';
import type { QuestionGenT } from '../learning/schemas';

export interface NormalizedQuestion {
  type: QuestionType;
  prompt: string;
  data: Record<string, unknown>;
  solution: Record<string, unknown>;
  explanation: string;
  difficulty: number;
  concept: string;
}

const BLANK = /_{3,}/g;

export const fold = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function fingerprint(prompt: string): string {
  return createHash('sha1').update(fold(prompt)).digest('hex').slice(0, 16);
}

function shuffle<T>(arr: T[], seed: string): T[] {
  const out = [...arr];
  let h = parseInt(createHash('md5').update(seed).digest('hex').slice(0, 8), 16);
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Valida la coherencia interna de una pregunta generada (índices en rango, huecos que cuadran…).
 * Devuelve null si no es corregible de forma fiable: mejor descartarla que evaluar mal.
 */
export function normalizeQuestion(q: QuestionGenT): NormalizedQuestion | null {
  const base = { type: q.type, prompt: q.prompt.trim(), explanation: q.explanation ?? '', difficulty: q.difficulty, concept: q.concept.trim() };
  switch (q.type) {
    case 'multiple_choice': {
      const opts = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2 || opts.length > 6 || q.correct_index == null || q.correct_index < 0 || q.correct_index >= opts.length) return null;
      return { ...base, data: { options: opts }, solution: { correct: q.correct_index, optionFeedback: q.option_feedback ?? [] } };
    }
    case 'true_false':
      if (typeof q.correct_bool !== 'boolean') return null;
      return { ...base, data: {}, solution: { correct: q.correct_bool } };
    case 'fill_blank': {
      const n = (q.prompt.match(BLANK) ?? []).length;
      if (!n || !q.blanks || q.blanks.length !== n) return null;
      return { ...base, data: { blanks: n }, solution: { blanks: q.blanks } };
    }
    case 'matching': {
      const left = q.left ?? [];
      const right = q.right ?? [];
      const pairs = q.pairs ?? [];
      if (left.length < 2 || left.length !== right.length || pairs.length !== left.length || new Set(pairs).size !== pairs.length || pairs.some((p) => p < 0 || p >= right.length)) return null;
      // Se barajan las opciones de la derecha para que el orden no delate la respuesta.
      const order = shuffle(right.map((_, i) => i), q.prompt);
      const shuffled = order.map((i) => right[i]);
      const mapped = pairs.map((p) => order.indexOf(p));
      return { ...base, data: { left, right: shuffled }, solution: { pairs: mapped } };
    }
    default: {
      if (!q.model_answer?.trim()) return null;
      const data: Record<string, unknown> = {};
      if (q.type === 'case_analysis' && q.scenario) data.scenario = q.scenario;
      if (q.type === 'code') {
        data.language = q.language ?? '';
        if (q.starter_code) data.starterCode = q.starter_code;
      }
      return { ...base, data, solution: { modelAnswer: q.model_answer, keyPoints: q.key_points ?? [] } };
    }
  }
}

export function isAutoGradable(type: string): boolean {
  return type === 'multiple_choice' || type === 'true_false' || type === 'fill_blank' || type === 'matching';
}

export function verdictFor(score: number): Verdict {
  return score >= 0.99 ? 'correcta' : score >= 0.5 ? 'parcial' : 'incorrecta';
}

export interface AutoGrade {
  score: number;
  feedback: Feedback;
}

/** Corrección local e instantánea de los tipos cerrados, con retroalimentación específica. */
export function autoGrade(type: string, data: any, solution: any, explanation: string, response: unknown, concept: string | null): AutoGrade | null {
  const review = concept ? `Repasa «${concept}».` : 'Repasa el apartado correspondiente de la lección.';
  switch (type) {
    case 'multiple_choice': {
      if (typeof response !== 'number') return null;
      const ok = response === solution.correct;
      const why = solution.optionFeedback?.[response] ?? '';
      return {
        score: ok ? 1 : 0,
        feedback: {
          analysis: [why, ok ? '' : explanation].filter(Boolean).join(' ') || explanation,
          reasoningErrors: ok ? [] : [why || 'La opción elegida no es correcta.'].filter(Boolean),
          correctAnswer: data.options[solution.correct],
          reviewSuggestion: ok ? '' : review,
        },
      };
    }
    case 'true_false': {
      if (typeof response !== 'boolean') return null;
      const ok = response === solution.correct;
      return { score: ok ? 1 : 0, feedback: { analysis: explanation, reasoningErrors: [], correctAnswer: solution.correct ? 'Verdadero' : 'Falso', reviewSuggestion: ok ? '' : review } };
    }
    case 'fill_blank': {
      if (!Array.isArray(response)) return null;
      const accepted: string[][] = solution.blanks;
      const wrong: string[] = [];
      let hits = 0;
      accepted.forEach((alts, i) => {
        const given = fold(String(response[i] ?? ''));
        if (given && alts.some((a) => fold(a) === given)) hits++;
        else wrong.push(`Hueco ${i + 1}: «${String(response[i] ?? '').trim() || '(vacío)'}» → se esperaba «${alts[0]}»`);
      });
      const score = hits / accepted.length;
      return { score, feedback: { analysis: explanation, reasoningErrors: wrong, correctAnswer: accepted.map((a) => a[0]).join(' · '), reviewSuggestion: score < 1 ? review : '' } };
    }
    case 'matching': {
      if (!Array.isArray(response)) return null;
      const pairs: number[] = solution.pairs;
      const wrong: string[] = [];
      let hits = 0;
      pairs.forEach((p, i) => {
        if (response[i] === p) hits++;
        else wrong.push(`«${data.left[i]}» corresponde a «${data.right[p]}»`);
      });
      const score = hits / pairs.length;
      return { score, feedback: { analysis: explanation, reasoningErrors: wrong, correctAnswer: pairs.map((p, i) => `${data.left[i]} → ${data.right[p]}`).join('; '), reviewSuggestion: score < 1 ? review : '' } };
    }
  }
  return null;
}

export interface QuestionRow {
  id: number;
  ord: number;
  type: QuestionType;
  prompt: string;
  data: string;
  solution: string;
  explanation: string;
  concept_name: string | null;
  difficulty: number;
  points: number;
  a_response: string | null;
  a_score: number | null;
  a_verdict: string | null;
  a_feedback: string | null;
}

export const QUESTION_SELECT = `
  SELECT q.id, q.ord, q.type, q.prompt, q.data, q.solution, q.explanation, q.concept_name, q.difficulty, q.points,
         a.response AS a_response, a.score AS a_score, a.verdict AS a_verdict, a.feedback AS a_feedback
    FROM questions q LEFT JOIN answers a ON a.question_id = q.id`;

/**
 * Vista para la interfaz. La solución NUNCA viaja al renderer: solo la retroalimentación,
 * y solo cuando la respuesta ya está corregida (en modo examen, al entregar).
 */
export function toQuestionView(r: QuestionRow, revealFeedback: boolean): QuestionView {
  const data = JSON.parse(r.data);
  let answer: AnswerView | null = null;
  if (r.a_response != null) {
    const graded = revealFeedback && r.a_verdict !== 'pendiente';
    answer = {
      response: JSON.parse(r.a_response),
      score: graded ? r.a_score ?? 0 : 0,
      verdict: graded ? (r.a_verdict as Verdict) : 'pendiente',
      feedback: graded && r.a_feedback ? JSON.parse(r.a_feedback) : null,
    };
  }
  return {
    id: r.id,
    ord: r.ord,
    type: r.type,
    prompt: r.prompt,
    concept: r.concept_name,
    difficulty: r.difficulty,
    points: r.points,
    options: data.options,
    blanks: data.blanks,
    left: data.left,
    right: data.right,
    scenario: data.scenario,
    language: data.language,
    starterCode: data.starterCode,
    answer,
  };
}

export function responseIsValid(type: string, data: any, response: unknown): boolean {
  switch (type) {
    case 'multiple_choice':
      return typeof response === 'number' && Number.isInteger(response) && response >= 0 && response < data.options.length;
    case 'true_false':
      return typeof response === 'boolean';
    case 'fill_blank':
      return Array.isArray(response) && response.length === data.blanks && response.every((x) => typeof x === 'string' && x.length <= 300);
    case 'matching':
      return Array.isArray(response) && response.length === data.left.length && response.every((x) => x === null || (Number.isInteger(x) && x >= 0 && x < data.right.length));
    default:
      return typeof response === 'string' && response.trim().length > 0 && response.length <= 20_000;
  }
}
