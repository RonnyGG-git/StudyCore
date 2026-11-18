import { z } from 'zod';
import type { ProvidedSource } from './citations';

export const SOURCE_RULES = [
  'REGLAS DE FUENTES (obligatorias):',
  '1. Distingue siempre entre lo que dicen los documentos del estudiante y tu conocimiento general.',
  '2. Toda afirmación basada en el vault lleva su marca [S#] (fragmento entregado) o [R#] (documento que leíste tú con Read).',
  '3. Nunca atribuyas a los documentos algo que no dicen. Si el vault no cubre algo, dilo en not_in_vault.',
  '4. En sources, "quote" es una frase COPIADA LITERALMENTE del documento (10 a 35 palabras), sin parafrasear ni traducir.',
  '5. El conocimiento general útil va solo en complementary_markdown, nunca mezclado con lo del vault.',
  '6. Solo puedes leer dentro del vault. Nunca intentes escribir, ejecutar comandos ni salir de él.',
].join('\n');

export const ASK_SYSTEM_PROMPT = [
  'Eres el profesor de StudyCore, el entorno de aprendizaje personal del estudiante.',
  'Su conocimiento está en su vault de Obsidian (tu carpeta de trabajo). Respondes en español, con claridad didáctica:',
  'primero la idea central en una o dos frases, luego el desarrollo en bloques cortos, ejemplos concretos cuando ayuden.',
  'Evita muros de texto: usa subtítulos breves, listas y código solo cuando aporten.',
  '',
  SOURCE_RULES,
].join('\n');

export const AskOutputSchema = z.object({
  answer_markdown: z.string().min(1),
  sources: z
    .array(
      z.object({
        ref: z.string().describe('S1, S2… para fragmentos entregados; R1, R2… para documentos que leíste tú'),
        path: z.string().describe('Ruta relativa al vault, con / como separador'),
        heading: z.string().describe('Apartado o encabezado del documento'),
        quote: z.string().describe('Frase literal copiada del documento'),
      }),
    )
    .max(12),
  complementary_markdown: z.string().describe('Conocimiento general que NO está en el vault; vacío si no hace falta'),
  not_in_vault: z.array(z.string()).max(8).describe('Aspectos de la pregunta que el vault no cubre'),
});
export type AskOutput = z.infer<typeof AskOutputSchema>;

/** --json-schema de la CLI rechaza la cabecera "$schema" que añade zod. */
export function toCliSchema(schema: z.ZodType): object {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const MAX_SOURCE_CHARS = 2400;

export function formatSources(sources: ProvidedSource[]): string {
  if (!sources.length) return '(La búsqueda en el índice no encontró fragmentos relevantes. Puedes buscar tú con Grep/Glob dentro del vault.)';
  return sources
    .map((s) => {
      const body = s.content.length > MAX_SOURCE_CHARS ? `${s.content.slice(0, MAX_SOURCE_CHARS)}\n[…fragmento recortado; el documento completo está en el vault]` : s.content;
      return `[${s.ref}] documento: ${s.path} | apartado: ${s.heading || '(inicio)'}\n<<<\n${body}\n>>>`;
    })
    .join('\n\n');
}

export function buildAskPrompt(question: string, sources: ProvidedSource[], history?: string): string {
  return [
    history ? `CONVERSACIÓN PREVIA (resumen reconstruido):\n${history}\n` : '',
    `PREGUNTA DEL ESTUDIANTE:\n${question}`,
    '',
    'FRAGMENTOS DEL VAULT recuperados por StudyCore (cítalos por su identificador):',
    formatSources(sources),
    '',
    'Si los fragmentos no bastan, puedes leer otros documentos del vault con Read/Grep/Glob y citarlos como R1, R2… con su ruta relativa.',
    'Entrega la respuesta con la herramienta StructuredOutput.',
  ]
    .filter(Boolean)
    .join('\n');
}
