import type { ConceptView, Gen } from '../../../shared/learning';
import { fail, type ClaudeGateway, type TaskContext } from '../claude/gateway';
import type { Db } from '../db/database';
import type { ActivityLog } from '../log/activity-log';
import type { VaultService } from '../vault/vault-service';
import { addConceptSources, findConcept, getConcept, relate, upsertConcept } from './concepts';
import type { LearningService } from './learning-service';
import { ConceptExpandSchema, GlossarySchema, TEACHER_SYSTEM } from './schemas';
import { formatSources } from '../tutor/prompts';

export class GlossaryService {
  constructor(private db: Db, private vault: VaultService, private gateway: ClaudeGateway, private log: ActivityLog, private learning: LearningService) {}

  /** Completa la ficha de un concepto (explicación, ejemplo, aplicación, relaciones, fuentes). */
  async expand(id: number, ctx: TaskContext): Promise<Gen<ConceptView>> {
    const c = getConcept(this.db, id);
    if (!c) return fail('Concepto no encontrado.');
    const provided = this.learning.provided(c.topicId, `${c.name} ${c.topicTitle}`, 8);
    const others = this.db.all<{ name: string }>('SELECT name FROM concepts WHERE topic_id = ? AND id <> ? LIMIT 60', c.topicId, id).map((r) => r.name);
    const r = await this.gateway.run(
      {
        task: 'concept',
        schema: ConceptExpandSchema,
        system: TEACHER_SYSTEM,
        label: `Claude está completando «${c.name}»…`,
        prompt: [
          `CONCEPTO: ${c.name} (tema ${c.topicTitle})`,
          c.shortDefinition ? `Definición actual: ${c.shortDefinition}` : '',
          'Escribe su ficha de glosario: definición corta, explicación completa, un ejemplo y una aplicación real.',
          `En "related" usa nombres de esta lista cuando corresponda: ${others.join(', ')}`,
          'Cita el vault con S#/R# y la frase literal.',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].filter(Boolean).join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    const o = r.value;
    this.db.tx(() => {
      upsertConcept(this.db, c.topicId, { name: c.name, shortDefinition: o.short_definition, explanation: o.explanation_markdown, example: o.example_markdown, application: o.application_markdown });
      addConceptSources(this.db, id, o.sources, provided, this.vault);
      for (const name of o.related) {
        const rid = findConcept(this.db, c.topicId, name);
        if (rid) relate(this.db, id, rid, 'related');
      }
    });
    return { ok: true, value: getConcept(this.db, id)! };
  }

  /** Extrae del vault el glosario del tema: crea conceptos nuevos y completa los existentes. */
  async generate(topicId: number, ctx: TaskContext): Promise<Gen<{ added: number; updated: number }>> {
    const t = this.db.get<{ title: string }>('SELECT title FROM topics WHERE id = ?', topicId);
    if (!t) return fail('Tema no encontrado.');
    const provided = this.learning.provided(topicId, t.title, 14);
    if (!provided.length) return fail('No hay documentos del vault para este tema.');
    const existing = this.db.all<{ name: string }>('SELECT name FROM concepts WHERE topic_id = ?', topicId).map((r) => r.name);
    const r = await this.gateway.run(
      {
        task: 'glossary',
        schema: GlossarySchema,
        system: TEACHER_SYSTEM,
        label: 'Claude está construyendo el glosario desde tus documentos…',
        prompt: [
          `TEMA: ${t.title}`,
          'Extrae de los documentos un GLOSARIO de 10 a 25 conceptos clave: definición corta, explicación, ejemplo, aplicación, conceptos relacionados y prerrequisitos.',
          'Solo conceptos que aparezcan en el vault: cada uno con ref S#, path y una frase literal del documento.',
          existing.length ? `Conceptos que ya existen (puedes completarlos usando el MISMO nombre): ${existing.join(', ')}` : '',
          '',
          'FRAGMENTOS DEL VAULT:',
          formatSources(provided),
        ].filter(Boolean).join('\n'),
      },
      ctx,
    );
    if (!r.ok) return r;
    let added = 0;
    let updated = 0;
    this.db.tx(() => {
      for (const c of r.value.concepts) {
        const res = upsertConcept(this.db, topicId, { name: c.name, shortDefinition: c.short_definition, explanation: c.explanation, example: c.example, application: c.application });
        res.created ? added++ : updated++;
        addConceptSources(this.db, res.id, [{ ref: c.ref, path: c.path, heading: '', quote: c.quote }], provided, this.vault);
      }
      for (const c of r.value.concepts) {
        const id = findConcept(this.db, topicId, c.name)!;
        for (const n of c.related) {
          const rid = findConcept(this.db, topicId, n);
          if (rid) relate(this.db, id, rid, 'related');
        }
        for (const n of c.prerequisites) {
          const pid = findConcept(this.db, topicId, n);
          if (pid) relate(this.db, id, pid, 'prerequisite');
        }
      }
    });
    this.log.info('glosario', `Glosario de «${t.title}»: ${added} nuevos, ${updated} completados`);
    return { ok: true, value: { added, updated } };
  }
}
