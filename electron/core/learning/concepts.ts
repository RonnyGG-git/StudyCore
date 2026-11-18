import type { ConceptStatus, ConceptSummary, ConceptView } from '../../../shared/learning';
import type { MessageSource } from '../../../shared/types';
import type { Db } from '../db/database';
import { verifySources, type ProvidedSource, type SectionLookup } from '../tutor/citations';

/**
 * Dominio de un concepto: media móvil ponderada por dificultad.
 * Una pregunta difícil bien resuelta pesa más que una fácil; los fallos seguidos activan el refuerzo.
 */
export function applyMastery(db: Db, conceptId: number, score: number, difficulty: number) {
  const c = db.get<{ mastery: number; attempts: number; correct: number; fail_streak: number; manual_status: number; status: ConceptStatus }>(
    'SELECT mastery, attempts, correct, fail_streak, manual_status, status FROM concepts WHERE id = ?', conceptId,
  );
  if (!c) return;
  const w = 0.2 + 0.06 * Math.max(1, Math.min(5, difficulty));
  const mastery = c.attempts === 0 ? score * 0.7 : c.mastery * (1 - w) + score * w;
  const attempts = c.attempts + 1;
  const correct = c.correct + (score >= 0.99 ? 1 : 0);
  const failStreak = score < 0.5 ? c.fail_streak + 1 : 0;
  const status = c.manual_status ? c.status : statusFor(mastery, correct);
  db.run(
    "UPDATE concepts SET mastery = ?, attempts = ?, correct = ?, fail_streak = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
    mastery, attempts, correct, failStreak, status, conceptId,
  );
}

export function statusFor(mastery: number, correct: number): ConceptStatus {
  if (mastery >= 0.85 && correct >= 3) return 'mastered';
  if (mastery >= 0.6) return 'understood';
  return 'learning';
}

export function findConcept(db: Db, topicId: number, name: string): number | null {
  const n = name.trim();
  if (!n) return null;
  const r = db.get<{ id: number }>('SELECT id FROM concepts WHERE topic_id = ? AND lower(name) = lower(?)', topicId, n);
  return r?.id ?? null;
}

export interface ConceptInput {
  name: string;
  shortDefinition?: string;
  explanation?: string;
  example?: string;
  application?: string;
}

/** Crea o completa un concepto sin pisar con vacío lo que ya tenía. */
export function upsertConcept(db: Db, topicId: number, c: ConceptInput): { id: number; created: boolean } {
  const name = c.name.trim().slice(0, 160);
  const existing = findConcept(db, topicId, name);
  if (existing) {
    for (const [col, val] of [['short_definition', c.shortDefinition], ['explanation', c.explanation], ['example', c.example], ['application', c.application]] as const) {
      if (val?.trim()) db.run(`UPDATE concepts SET ${col} = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, val.trim(), existing);
    }
    return { id: existing, created: false };
  }
  const id = db.run(
    'INSERT INTO concepts (topic_id, name, short_definition, explanation, example, application) VALUES (?,?,?,?,?,?)',
    topicId, name, c.shortDefinition?.trim() ?? '', c.explanation?.trim() ?? '', c.example?.trim() ?? '', c.application?.trim() ?? '',
  ).lastId;
  return { id, created: true };
}

export function relate(db: Db, conceptId: number, relatedId: number, kind: 'prerequisite' | 'related') {
  if (conceptId === relatedId) return;
  db.run('INSERT OR IGNORE INTO concept_relations (concept_id, related_id, kind) VALUES (?,?,?)', conceptId, relatedId, kind);
}

export function addConceptSources(db: Db, conceptId: number, claimed: { ref: string; path: string; heading: string; quote: string }[], provided: ProvidedSource[], lookup: SectionLookup) {
  const valid = claimed.filter((c) => c.quote?.trim() && (c.ref?.trim() || c.path?.trim()));
  for (const s of verifySources(valid, provided, lookup)) {
    const dup = db.get('SELECT 1 FROM concept_sources WHERE concept_id = ? AND path = ? AND quote = ?', conceptId, s.path, s.quote);
    if (!dup) db.run('INSERT INTO concept_sources (concept_id, path, heading, quote, verified, reason) VALUES (?,?,?,?,?,?)', conceptId, s.path, s.heading, s.quote, s.verified ? 1 : 0, s.reason ?? null);
  }
}

const SUMMARY_SELECT = `SELECT c.id, c.topic_id AS topicId, t.title AS topicTitle, c.name, c.short_definition AS shortDefinition,
  c.status, c.favorite, c.mastery FROM concepts c JOIN topics t ON t.id = c.topic_id`;

export function listConcepts(db: Db, f: { topicId?: number | null; status?: string | null; favorites?: boolean; query?: string }): ConceptSummary[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (f.topicId) where.push('c.topic_id = ?') && args.push(f.topicId);
  if (f.status) where.push('c.status = ?') && args.push(f.status);
  if (f.favorites) where.push('c.favorite = 1');
  if (f.query?.trim()) {
    where.push('(c.name LIKE ? OR c.short_definition LIKE ?)');
    args.push(`%${f.query.trim()}%`, `%${f.query.trim()}%`);
  }
  return db
    .all<any>(`${SUMMARY_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.name COLLATE NOCASE LIMIT 500`, ...args)
    .map((r) => ({ ...r, favorite: !!r.favorite }));
}

export function getConcept(db: Db, id: number): ConceptView | null {
  const r = db.get<any>(`${SUMMARY_SELECT} WHERE c.id = ?`, id);
  if (!r) return null;
  const full = db.get<any>('SELECT explanation, example, application, attempts, correct FROM concepts WHERE id = ?', id)!;
  const rel = (kind: string) =>
    db.all<{ id: number; name: string; status: ConceptStatus }>(
      `SELECT c.id, c.name, c.status FROM concept_relations r JOIN concepts c ON c.id = r.related_id WHERE r.concept_id = ? AND r.kind = ?
       UNION SELECT c.id, c.name, c.status FROM concept_relations r JOIN concepts c ON c.id = r.concept_id WHERE r.related_id = ? AND r.kind = 'related' AND ? = 'related'`,
      id, kind, id, kind,
    );
  return {
    ...r,
    favorite: !!r.favorite,
    explanation: full.explanation,
    example: full.example,
    application: full.application,
    attempts: full.attempts,
    correct: full.correct,
    related: rel('related').map(({ id: i, name }) => ({ id: i, name })),
    prerequisites: rel('prerequisite'),
    sources: db
      .all<any>('SELECT path, heading, quote, verified, reason FROM concept_sources WHERE concept_id = ? ORDER BY verified DESC, id', id)
      .map<MessageSource>((s, i) => ({ ref: `F${i + 1}`, path: s.path, heading: s.heading, quote: s.quote, verified: !!s.verified, reason: s.reason ?? undefined })),
    lessons: db.all<{ id: number; title: string }>('SELECT l.id, l.title FROM lesson_concepts lc JOIN lessons l ON l.id = lc.lesson_id WHERE lc.concept_id = ? ORDER BY l.id', id),
  };
}

/**
 * Mapa de conocimientos de un tema: cada concepto se coloca en la columna de su profundidad de
 * prerrequisitos (los fundamentos a la izquierda), con aristas de prerrequisito y de relación.
 */
export function conceptMap(db: Db, topicId: number) {
  const nodes = db.all<{ id: number; name: string; status: ConceptStatus; mastery: number }>('SELECT id, name, status, mastery FROM concepts WHERE topic_id = ? ORDER BY name COLLATE NOCASE', topicId);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = db
    .all<{ from: number; to: number; kind: 'prerequisite' | 'related' }>('SELECT related_id AS "from", concept_id AS "to", kind FROM concept_relations')
    .filter((e) => ids.has(e.from) && ids.has(e.to));
  const pre = new Map<number, number[]>();
  for (const e of edges) if (e.kind === 'prerequisite') pre.set(e.to, [...(pre.get(e.to) ?? []), e.from]);
  const depth = new Map<number, number>();
  const visit = (id: number, stack: Set<number>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (stack.has(id)) return 0; // ciclo: se corta
    stack.add(id);
    const d = Math.max(-1, ...(pre.get(id) ?? []).map((p) => visit(p, stack))) + 1;
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => visit(n.id, new Set()));
  return { nodes: nodes.map((n) => ({ ...n, depth: depth.get(n.id) ?? 0 })), edges };
}
