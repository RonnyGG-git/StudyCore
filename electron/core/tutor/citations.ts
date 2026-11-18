import type { MessageSource } from '../../../shared/types';

export interface ProvidedSource {
  ref: string;
  sectionId: number;
  path: string;
  heading: string;
  content: string;
}

export interface ClaimedSource {
  ref: string;
  path: string;
  heading: string;
  quote: string;
}

export interface SectionLookup {
  sectionsOf(relPath: string): { id: number; content: string; heading: string; heading_path: string }[];
}

/** Normaliza para comparar citas: sin acentos, sin marcas de Markdown, espacios colapsados. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[*_`>#|[\]()]/g, ' ')
    .replace(/[“”«»"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function quoteFound(quote: string, content: string): boolean {
  const q = normalizeForMatch(quote).replace(/(\.\.\.|…)/g, ' ').trim();
  if (q.length < 8) return false;
  const c = normalizeForMatch(content);
  if (c.includes(q)) return true;
  // Citas con elipsis: todas las partes deben aparecer en orden.
  const parts = normalizeForMatch(quote).split(/\.\.\.|…/).map((p) => p.trim()).filter((p) => p.length >= 6);
  if (parts.length < 2) return false;
  let from = 0;
  for (const p of parts) {
    const at = c.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

/**
 * Comprueba cada fuente que Claude dice haber usado:
 *  - debe corresponder a un fragmento entregado ([S#]) o a un documento indexado del vault,
 *  - y la frase citada debe aparecer literalmente (normalizada) en ese texto.
 * Lo que no se puede comprobar se marca como no verificado, nunca se oculta.
 */
export function verifySources(claimed: ClaimedSource[], provided: ProvidedSource[], lookup: SectionLookup): (MessageSource & { sectionId: number | null })[] {
  return claimed.map((c) => {
    const byRef = provided.find((p) => p.ref.toUpperCase() === c.ref.trim().toUpperCase());
    if (byRef) {
      // Si la frase es real pero está en otro fragmento, se atribuye al sitio correcto.
      const hit = quoteFound(c.quote, byRef.content) ? byRef : provided.find((p) => quoteFound(c.quote, p.content));
      if (hit) return { ref: byRef.ref, path: hit.path, heading: hit.heading, quote: c.quote, sectionId: hit.sectionId, verified: true };
      const inDoc = lookup.sectionsOf(byRef.path).find((s) => quoteFound(c.quote, s.content));
      if (inDoc) return { ref: byRef.ref, path: byRef.path, heading: inDoc.heading_path || inDoc.heading, quote: c.quote, sectionId: inDoc.id, verified: true };
      return { ref: byRef.ref, path: byRef.path, heading: byRef.heading, quote: c.quote, sectionId: byRef.sectionId, verified: false, reason: 'La frase citada no aparece en el fragmento indicado.' };
    }
    const rel = c.path.replace(/\\/g, '/').replace(/^\.?\//, '');
    const sections = lookup.sectionsOf(rel);
    if (!sections.length) {
      return { ...c, path: rel, sectionId: null, verified: false, reason: 'El documento no existe en el índice del vault.' };
    }
    const hit = sections.find((s) => quoteFound(c.quote, s.content));
    return {
      ...c,
      path: rel,
      heading: hit ? hit.heading_path || hit.heading : c.heading,
      sectionId: hit?.id ?? null,
      verified: !!hit,
      reason: hit ? undefined : 'La frase citada no aparece en ese documento.',
    };
  });
}
