import { describe, expect, it } from 'vitest';
import { quoteFound, verifySources } from '../../electron/core/tutor/citations';

const provided = [{ ref: 'S1', sectionId: 7, path: 'notas/sql.md', heading: 'SQL › Joins', content: 'Un **INNER JOIN** devuelve solo las filas que tienen coincidencia en ambas tablas.' }];
const lookup = {
  sectionsOf: (p: string) => (p === 'notas/osi.md' ? [{ id: 9, content: 'El modelo OSI tiene siete capas, desde la física hasta la aplicación.', heading: 'OSI', heading_path: 'Redes › OSI' }] : []),
};

describe('verificación de citas', () => {
  it('acepta citas literales ignorando acentos, mayúsculas y Markdown', () => {
    expect(quoteFound('un inner join devuelve solo las filas', provided[0].content)).toBe(true);
    expect(quoteFound('Un INNER JOIN … ambas tablas', provided[0].content)).toBe(true);
    expect(quoteFound('JOIN', provided[0].content)).toBe(false);
  });

  it('marca como no verificada una cita inventada o un documento inexistente', () => {
    const r = verifySources(
      [
        { ref: 'S1', path: 'x', heading: 'x', quote: 'Un INNER JOIN devuelve solo las filas que tienen coincidencia' },
        { ref: 's1', path: 'x', heading: 'x', quote: 'el join siempre es lento en cualquier motor' },
        { ref: 'R1', path: 'notas/osi.md', heading: '?', quote: 'El modelo OSI tiene siete capas' },
        { ref: 'R2', path: 'notas/inventado.md', heading: 'x', quote: 'lo que sea que diga aquí dentro' },
      ],
      provided,
      lookup,
    );
    expect(r.map((s) => s.verified)).toEqual([true, false, true, false]);
    expect(r[0]).toMatchObject({ path: 'notas/sql.md', heading: 'SQL › Joins', sectionId: 7 });
    expect(r[2]).toMatchObject({ heading: 'Redes › OSI', sectionId: 9 });
    expect(r[3].reason).toMatch(/no existe/);
  });
});
