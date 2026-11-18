// Simula la CLI de Claude Code para pruebas.
// FAKE_MODE = ok | error | session | invalid | invalid-once | slow | rate | badcite | noauth
// Tareas estructuradas: se detecta "TAREA: <nombre>" en el prompt y se devuelve un resultado coherente.
// FAKE_GRADE_SCORE (0-1, por defecto 0.8) y FAKE_PASS (1/0) ajustan correcciones y retos. FAKE_LOG registra tareas.
const fs = require('fs');
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

if (args[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: mode !== 'noauth', authMethod: 'claude.ai', subscriptionType: 'max' })); process.exit(0); }

const Q_JOIN = 'Un INNER JOIN devuelve solo las filas que tienen coincidencia en ambas tablas';

function mc(prompt, concept, correct = 0) {
  return { type: 'multiple_choice', prompt, concept, difficulty: 2, options: ['Opción A', 'Opción B', 'Opción C'], option_feedback: ['A explica', 'B explica', 'C explica'], correct_index: correct, explanation: 'Porque sí.' };
}

function task(name, input) {
  const tag = String(process.hrtime.bigint() % 1000000n);
  switch (name) {
    case 'diagnostic':
      return {
        summary: 'El vault cubre joins e índices.',
        subtopics: ['Joins', 'Índices'],
        questions: [
          mc('¿Qué devuelve un INNER JOIN?', 'INNER JOIN', 0),
          { type: 'true_false', prompt: 'Un LEFT JOIN conserva todas las filas de la izquierda.', concept: 'LEFT JOIN', difficulty: 1, correct_bool: true, explanation: 'Así es.' },
          { type: 'short_answer', prompt: '¿Para qué sirve un índice?', concept: 'Índices', difficulty: 2, model_answer: 'Acelera búsquedas.', key_points: ['velocidad'], explanation: 'Índices.' },
          { type: 'short_answer', prompt: '¿Qué es la tercera forma normal?', concept: 'Normalización', difficulty: 3, model_answer: 'Sin dependencias transitivas.', explanation: '3FN.' },
          mc('¿Qué coste tiene un índice?', 'Índices', 1),
          { type: 'true_false', prompt: 'INNER JOIN incluye filas sin coincidencia.', concept: 'INNER JOIN', difficulty: 1, correct_bool: false, explanation: 'No.' },
        ],
        sources: [{ ref: 'S1', path: 'notas/sql.md', heading: 'Joins', quote: Q_JOIN }],
      };
    case 'path':
      return {
        level: 'intermedio', diagnosis_summary: 'Conoce lo básico de joins.', known_concepts: ['INNER JOIN'], gaps: ['Índices'], missing_prerequisites: [],
        short_answer_grades: [{ question_index: 2, score: 0.5, feedback: 'Incompleta.' }, { question_index: 3, score: 0, feedback: 'No respondida.' }],
        objective: 'Dominar consultas con joins e índices.', difficulty: 3,
        modules: [
          { title: 'Fundamentos de JOIN', objective: 'Combinar tablas', lessons: [
            { title: 'INNER JOIN', summary: 'Coincidencias', difficulty: 2, concepts: ['INNER JOIN'] },
            { title: 'LEFT JOIN', summary: 'Conservar la izquierda', difficulty: 2, concepts: ['LEFT JOIN'] },
          ] },
          { title: 'Rendimiento', objective: 'Consultas rápidas', lessons: [{ title: 'Índices', summary: 'Acelerar búsquedas', difficulty: 3, concepts: ['Índices'] }] },
        ],
        concepts: [
          { name: 'INNER JOIN', short_definition: 'Filas con coincidencia', prerequisites: [], ref: 'S1', quote: Q_JOIN },
          { name: 'LEFT JOIN', short_definition: 'Conserva la izquierda', prerequisites: ['INNER JOIN'] },
          { name: 'Índices', short_definition: 'Aceleran búsquedas', prerequisites: [] },
          { name: 'Normalización', short_definition: 'Evita redundancia', prerequisites: [] },
        ],
        final_project: { title: 'Informe de ventas', description: 'Construye consultas.', objectives: ['Usar joins'], criteria: ['Correctas', 'Eficientes'] },
      };
    case 'lesson': {
      const u = (kind, title) => ({ kind, title, body_markdown: `Contenido de ${title} [S1].` });
      return {
        units: [
          u('intro', 'Por qué importa'), u('definition', 'Definición'), u('explanation', 'Cómo funciona'),
          { ...u('check', 'Comprobación 1'), check: mc(`Comprobación A ${tag}`, 'INNER JOIN', 1) },
          u('example', 'Ejemplo'), u('analogy', 'Analogía'), u('application', 'Aplicación'), u('mistakes', 'Errores comunes'),
          { ...u('check', 'Comprobación 2'), check: { type: 'true_false', prompt: `Comprobación B ${tag}`, concept: 'INNER JOIN', difficulty: 2, correct_bool: true, explanation: 'Sí.' } },
          u('related', 'Relacionados'), u('summary', 'Resumen'),
        ],
        sources: [{ ref: 'S1', path: 'notas/sql.md', heading: 'Joins', quote: Q_JOIN }],
        complementary_markdown: 'Dato general.',
        concepts: [{ name: 'INNER JOIN', short_definition: 'Filas con coincidencia' }],
      };
    }
    case 'quiz': {
      const concept = (/- ([^:\n]+):/.exec(input.split('CONCEPTOS A EVALUAR')[1] || '') || [])[1] || 'INNER JOIN';
      return {
        intro_markdown: input.includes('REFUERZO:') ? 'Nueva explicación con otra analogía.' : '',
        questions: [
          mc(`MC ${tag} sobre ${concept}`, concept, 2),
          { type: 'true_false', prompt: `VF ${tag}`, concept, difficulty: 2, correct_bool: true, explanation: 'Cierto.' },
          { type: 'fill_blank', prompt: `Un ___ combina tablas y un ___ acelera ${tag}`, concept, difficulty: 2, blanks: [['join'], ['índice', 'indice']], explanation: 'Join e índice.' },
          { type: 'matching', prompt: `Relaciona ${tag}`, concept, difficulty: 2, left: ['INNER', 'LEFT'], right: ['coincidencias', 'conserva izquierda'], pairs: [0, 1], explanation: 'Relación.' },
          { type: 'short_answer', prompt: `Explica ${concept} ${tag}`, concept, difficulty: 3, model_answer: 'Respuesta modelo.', key_points: ['clave'], explanation: 'Abierta.' },
          { type: 'multiple_choice', prompt: `Inválida ${tag}`, concept, difficulty: 2, options: ['solo una'], correct_index: 5, explanation: 'x' },
        ],
      };
    }
    case 'grade': {
      const ids = [...input.matchAll(/### id (\d+)/g)].map((m) => Number(m[1]));
      const score = Number(process.env.FAKE_GRADE_SCORE ?? 0.8);
      return { grades: ids.map((id) => ({ id, score, understood: score >= 0.5, analysis: 'Buen intento.', reasoning_errors: score < 1 ? ['Falta un matiz'] : [], correct_answer: 'Respuesta modelo.', review_suggestion: 'Repasa el concepto.' })) };
    }
    case 'concept':
      return { short_definition: 'Definición ampliada', explanation_markdown: 'Explicación completa.', example_markdown: 'Ejemplo.', application_markdown: 'Aplicación.', related: ['LEFT JOIN'], sources: [{ ref: 'S1', path: 'notas/sql.md', heading: 'Joins', quote: Q_JOIN }] };
    case 'glossary':
      return { concepts: [
        { name: 'INNER JOIN', short_definition: 'x', explanation: 'Completa', example: 'e', application: 'a', related: ['Vista'], prerequisites: [], ref: 'S1', path: 'notas/sql.md', quote: Q_JOIN },
        { name: 'Vista', short_definition: 'Consulta guardada', explanation: 'e', example: 'e', application: 'a', related: [], prerequisites: ['INNER JOIN'], ref: 'S9', path: 'notas/sql.md', quote: 'frase inventada que no está en el documento' },
      ] };
    case 'cards':
      return { cards: [
        { front: `¿Qué hace INNER JOIN? ${tag}`, back: 'Coincidencias', explanation: 'x', category: 'Joins', difficulty: 1, concept: 'INNER JOIN', path: 'notas/sql.md', heading: 'Joins' },
        { front: `¿Qué conserva LEFT JOIN? ${tag}`, back: 'La izquierda', explanation: 'x', category: 'Joins', difficulty: 2, concept: 'LEFT JOIN', path: 'no/existe.md', heading: '' },
        { front: `¿Qué hace INNER JOIN? ${tag}`, back: 'Duplicada', explanation: 'x', category: 'Joins', difficulty: 1, concept: 'INNER JOIN', path: '', heading: '' },
      ] };
    case 'challenge':
      return { title: 'Reto de ventas', description_markdown: 'Escribe la consulta.', objectives: ['Unir tablas'], level: 3, hints: ['Pista 1', 'Pista 2', 'Pista 3'], criteria: ['Usa JOIN', 'Filtra'], solution_markdown: 'SELECT ... JOIN ...' };
    case 'challenge_eval': {
      const passed = process.env.FAKE_PASS !== '0';
      return { passed, score: passed ? 0.9 : 0.3, criteria: [{ criterion: 'Usa JOIN', met: passed, comment: 'ok' }], feedback_markdown: passed ? 'Bien hecho.' : '¿Qué tabla falta?', next_steps: ['Optimizar'] };
    }
    case 'recommend': {
      const lesson = /\[lesson (\d+)\]/.exec(input);
      return { recommendations: [
        { action: 'lesson', target_id: lesson ? Number(lesson[1]) : 999, topic_id: null, title: 'Sigue la lección', reason: 'Siguiente paso', minutes: 20 },
        { action: 'lesson', target_id: 99999, topic_id: null, title: 'Inexistente', reason: 'x', minutes: 5 },
        { action: 'review_cards', target_id: null, topic_id: null, title: 'Repasa', reason: 'Vencidas', minutes: 10 },
      ] };
    }
  }
  return null;
}

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_ARGS_FILE) fs.writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify({ args, input }));
  const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
  const sid = resume || (args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : 'sess-x');
  const tm = /^TAREA: (\w+)/.exec(input);
  if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, (tm ? tm[1] : 'ask') + '\n');
  if (mode === 'session' && resume) {
    out({ type: 'result', subtype: 'error', is_error: true, result: `No conversation found with session ID: ${resume}`, session_id: sid });
    process.exit(1);
  }
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-test' });
  out({ type: 'assistant', session_id: sid, message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: process.cwd() + '/notas/sql.md' } }] } });
  if (mode === 'slow') { setTimeout(() => {}, 60_000); return; }
  if (mode === 'rate') { out({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }); out({ type: 'result', is_error: true, result: 'usage limit', session_id: sid }); process.exit(1); }
  if (mode === 'error') { process.stderr.write('boom'); process.exit(2); }
  if (mode === 'invalid' || (mode === 'invalid-once' && !resume && !input.includes('ATENCIÓN: un intento anterior'))) {
    out({ type: 'result', is_error: false, result: 'texto', session_id: sid, total_cost_usd: 0.01 });
    process.exit(0);
  }
  let structured;
  if (tm) structured = task(tm[1], input);
  else {
    const quote = mode === 'badcite' ? 'esta frase no existe en ningún documento del vault' : Q_JOIN;
    structured = {
      answer_markdown: 'Un **INNER JOIN** combina filas con coincidencia [S1].',
      sources: [{ ref: 'S1', path: 'notas/sql.md', heading: 'Joins', quote }],
      complementary_markdown: 'En PostgreSQL también existe LATERAL.',
      not_in_vault: ['FULL OUTER JOIN'],
    };
  }
  out({ type: 'result', is_error: false, result: 'ok', session_id: sid, total_cost_usd: 0.02, structured_output: structured });
  process.exit(0);
});
