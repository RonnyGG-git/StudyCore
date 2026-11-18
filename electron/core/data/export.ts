import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../db/database';
import type { GameService } from '../game/game-service';

/** Tablas con el progreso del estudiante (el índice del vault se reconstruye y no se exporta). */
const TABLES = [
  'topics', 'modules', 'lessons', 'concepts', 'concept_sources', 'concept_relations', 'lesson_concepts',
  'assessments', 'questions', 'answers', 'xp_events', 'user_achievements', 'study_days',
  'flashcards', 'card_reviews', 'challenges', 'challenge_attempts', 'goals', 'planned_sessions',
  'conversations', 'messages', 'message_sources',
];

/** Exporta todo a JSON (reutilizable) y un informe Markdown legible, en la carpeta de resultados. */
export function exportData(db: Db, game: GameService, outputDir: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const dir = path.join(outputDir, 'Exportaciones');
  fs.mkdirSync(dir, { recursive: true });
  const data: Record<string, unknown> = { app: 'StudyCore', schemaVersion: db.version, exportedAt: new Date().toISOString() };
  for (const t of TABLES) data[t] = db.all(`SELECT * FROM ${t}`);
  const json = path.join(dir, `studycore-${stamp}.json`);
  fs.writeFileSync(json, JSON.stringify(data, null, 2), 'utf8');

  const s = game.stats();
  const g = game.state();
  const lines = [
    `# Informe de StudyCore — ${new Date().toLocaleDateString('es')}`,
    '',
    `**Nivel ${g.level.n} · ${g.level.name}** — ${s.totals.xp} XP · racha actual ${s.streak.current} días (mejor ${s.streak.best})`,
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| Tiempo de estudio | ${Math.round(s.totals.minutes / 60 * 10) / 10} h |`,
    `| Lecciones completadas | ${s.totals.lessons} |`,
    `| Preguntas respondidas | ${s.totals.questions} |`,
    `| Acierto | ${s.totals.correctPct ?? '—'}% |`,
    `| Conceptos dominados | ${s.totals.conceptsMastered} |`,
    `| Temas dominados / pendientes | ${s.totals.topicsMastered} / ${s.totals.topicsPending} |`,
    `| Tarjetas repasadas | ${s.totals.cardsReviewed} |`,
    `| Retos superados | ${s.totals.challengesCompleted} |`,
    '',
    '## Temas',
    '',
    ...s.topics.map((t) => `- **${t.title}** — ${Math.round(t.progress * 100)}% de lecciones, dominio medio ${Math.round(t.mastery * 100)}%${t.accuracy != null ? `, acierto ${Math.round(t.accuracy * 100)}%` : ''}`),
    '',
    '## Logros',
    '',
    ...g.achievements.map((a) => `- ${a.unlockedAt ? '🏅' : '▫️'} **${a.name}** — ${a.description}${a.unlockedAt ? ` (${a.unlockedAt.slice(0, 10)})` : ` (${a.progress.value}/${a.progress.target})`}`),
    '',
    '## Evaluaciones',
    '',
    ...db
      .all<{ title: string; score: number; finished_at: string }>("SELECT title, score, finished_at FROM assessments WHERE status = 'graded' AND kind <> 'lesson_check' ORDER BY id DESC LIMIT 50")
      .map((a) => `- ${a.finished_at.slice(0, 10)} · ${a.title}: ${Math.round(a.score * 100)}%`),
    '',
  ];
  fs.writeFileSync(json.replace(/\.json$/, '.md'), lines.join('\n'), 'utf8');
  return json;
}
