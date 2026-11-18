import { z } from 'zod';
import { SOURCE_RULES } from '../tutor/prompts';

export const QUESTION_TYPES = ['multiple_choice', 'true_false', 'short_answer', 'fill_blank', 'matching', 'problem', 'essay', 'case_analysis', 'code'] as const;
export const AUTO_TYPES = new Set(['multiple_choice', 'true_false', 'fill_blank', 'matching']);

export const TEACHER_SYSTEM = [
  'Eres el profesor particular de StudyCore. Enseñas en español, con rigor y claridad didáctica,',
  'adaptando la profundidad al nivel del estudiante. Construyes desde los fundamentos y respetas los prerrequisitos.',
  'El material base son los documentos del vault de Obsidian del estudiante (tu carpeta de trabajo).',
  '',
  SOURCE_RULES,
].join('\n');

export const SourceRef = z.object({
  ref: z.string().describe('S# del fragmento entregado o R# si leíste el documento tú'),
  path: z.string(),
  heading: z.string(),
  quote: z.string().describe('Frase literal copiada del documento'),
});

export const QuestionGen = z.object({
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().min(3).describe('Enunciado. En fill_blank marca cada hueco con ___'),
  concept: z.string().describe('Concepto evaluado (nombre exacto de la lista de conceptos)'),
  difficulty: z.number().int().min(1).max(5),
  options: z.array(z.string()).optional().describe('multiple_choice: 3 a 5 opciones'),
  option_feedback: z.array(z.string()).optional().describe('multiple_choice: por qué cada opción es correcta o incorrecta'),
  correct_index: z.number().int().optional().describe('multiple_choice: índice desde 0'),
  correct_bool: z.boolean().optional().describe('true_false'),
  blanks: z.array(z.array(z.string()).min(1)).optional().describe('fill_blank: respuestas aceptadas por cada hueco, en orden'),
  left: z.array(z.string()).optional().describe('matching: elementos de la izquierda'),
  right: z.array(z.string()).optional().describe('matching: elementos de la derecha'),
  pairs: z.array(z.number().int()).optional().describe('matching: pairs[i] = índice en right que corresponde a left[i]'),
  scenario: z.string().optional().describe('case_analysis: situación real a analizar'),
  language: z.string().optional().describe('code: lenguaje'),
  starter_code: z.string().optional().describe('code: código inicial opcional'),
  model_answer: z.string().optional().describe('Respuesta modelo (obligatoria en tipos abiertos)'),
  key_points: z.array(z.string()).optional().describe('Puntos que una buena respuesta debe cubrir'),
  explanation: z.string().describe('Explicación de la respuesta correcta'),
});
export type QuestionGenT = z.infer<typeof QuestionGen>;

export const DiagnosticSchema = z.object({
  summary: z.string().describe('Qué cubre el vault sobre este tema, en 2-4 frases'),
  subtopics: z.array(z.string()).max(15),
  questions: z.array(QuestionGen).min(5).max(12),
  sources: z.array(SourceRef).max(10),
});

export const PathSchema = z.object({
  level: z.enum(['principiante', 'intermedio', 'avanzado']),
  diagnosis_summary: z.string(),
  known_concepts: z.array(z.string()),
  gaps: z.array(z.string()),
  missing_prerequisites: z.array(z.string()),
  short_answer_grades: z.array(z.object({ question_index: z.number().int(), score: z.number().min(0).max(1), feedback: z.string() })),
  objective: z.string(),
  difficulty: z.number().int().min(1).max(5),
  modules: z
    .array(
      z.object({
        title: z.string(),
        objective: z.string(),
        lessons: z.array(z.object({ title: z.string(), summary: z.string(), difficulty: z.number().int().min(1).max(5), concepts: z.array(z.string()).min(1) })).min(1).max(6),
      }),
    )
    .min(2)
    .max(8),
  concepts: z
    .array(
      z.object({
        name: z.string(),
        short_definition: z.string(),
        prerequisites: z.array(z.string()),
        ref: z.string().optional(),
        quote: z.string().optional(),
        path: z.string().optional(),
      }),
    )
    .min(3)
    .max(60),
  final_project: z.object({ title: z.string(), description: z.string(), objectives: z.array(z.string()), criteria: z.array(z.string()) }),
});

export const UNIT_KINDS = ['intro', 'definition', 'explanation', 'example', 'analogy', 'application', 'mistakes', 'related', 'check', 'summary'] as const;

export const LessonSchema = z.object({
  units: z
    .array(
      z.object({
        kind: z.enum(UNIT_KINDS),
        title: z.string(),
        body_markdown: z.string().describe('Bloque corto (máx. ~180 palabras) con marcas [S#] cuando venga del vault'),
        check: QuestionGen.optional().describe('Solo en unidades "check": una pregunta multiple_choice o true_false'),
      }),
    )
    .min(8)
    .max(16),
  sources: z.array(SourceRef).max(12),
  complementary_markdown: z.string(),
  concepts: z.array(z.object({ name: z.string(), short_definition: z.string() })).max(15),
});

export const QuizSchema = z.object({
  intro_markdown: z.string().describe('Solo en refuerzos: una explicación NUEVA y distinta del concepto; vacío en otros casos'),
  questions: z.array(QuestionGen).min(1).max(20),
});

export const GradeSchema = z.object({
  grades: z.array(
    z.object({
      id: z.number().int(),
      score: z.number().min(0).max(1),
      understood: z.boolean().describe('¿Demuestra comprensión real del concepto, no solo memoria?'),
      analysis: z.string().describe('Análisis de la respuesta del estudiante, dirigido a él'),
      reasoning_errors: z.array(z.string()).describe('Errores de razonamiento o conceptuales concretos'),
      correct_answer: z.string(),
      review_suggestion: z.string().describe('Qué repasar exactamente'),
    }),
  ),
});

export const ConceptExpandSchema = z.object({
  short_definition: z.string(),
  explanation_markdown: z.string(),
  example_markdown: z.string(),
  application_markdown: z.string(),
  related: z.array(z.string()).max(10),
  sources: z.array(SourceRef).max(8),
});

export const GlossarySchema = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string(),
        short_definition: z.string(),
        explanation: z.string(),
        example: z.string(),
        application: z.string(),
        related: z.array(z.string()),
        prerequisites: z.array(z.string()),
        ref: z.string(),
        path: z.string(),
        quote: z.string(),
      }),
    )
    .min(1)
    .max(40),
});

export const CardsSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string(),
        back: z.string(),
        explanation: z.string(),
        category: z.string(),
        difficulty: z.number().int().min(1).max(3),
        concept: z.string(),
        path: z.string().describe('Documento del vault que respalda la tarjeta, o vacío'),
        heading: z.string(),
      }),
    )
    .min(1)
    .max(30),
});

export const ChallengeSchema = z.object({
  title: z.string(),
  description_markdown: z.string(),
  objectives: z.array(z.string()).min(1),
  level: z.number().int().min(1).max(5),
  hints: z.array(z.string()).min(2).max(4).describe('De la más sutil a la más directa; ninguna da la solución completa'),
  criteria: z.array(z.string()).min(2),
  solution_markdown: z.string(),
});

export const ChallengeEvalSchema = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(1),
  criteria: z.array(z.object({ criterion: z.string(), met: z.boolean(), comment: z.string() })),
  feedback_markdown: z.string().describe('Retroalimentación que guía sin revelar la solución completa'),
  next_steps: z.array(z.string()),
});

export const RecommendSchema = z.object({
  recommendations: z
    .array(
      z.object({
        action: z.enum(['diagnostic', 'lesson', 'module_quiz', 'review_cards', 'reinforce_concept', 'challenge', 'tutor', 'new_topic']),
        target_id: z.number().int().nullable(),
        topic_id: z.number().int().nullable(),
        title: z.string(),
        reason: z.string(),
        minutes: z.number().int().min(1).max(240),
      }),
    )
    .min(1)
    .max(6),
});

export const LEVEL_GUIDE = {
  principiante: 'Nivel principiante: lenguaje sencillo, analogías cotidianas, sin dar nada por sabido.',
  intermedio: 'Nivel intermedio: precisión técnica moderada, conecta con lo que ya sabe, ejemplos realistas.',
  avanzado: 'Nivel avanzado: rigor técnico, casos límite, compromisos de diseño y matices.',
} as const;
