import { describe, expect, it } from 'vitest';
import { countWords, parseMarkdown, parsePlainText } from '../../electron/core/vault/markdown';

describe('parseMarkdown', () => {
  const md = '---\ntags:\n  - sql\n  - "#bd"\n---\n# Título\nIntro con [[Enlace|alias]] y #etiqueta.\n## A\ntexto a\n```\n## no es encabezado\n```\n### A1\ntexto a1\n## B\ntexto b';

  it('trocea por encabezados con la ruta completa e ignora los de bloques de código', () => {
    const d = parseMarkdown(md, 'archivo');
    expect(d.title).toBe('Título');
    expect(d.sections.map((s) => s.headingPath)).toEqual(['Título', 'Título › A', 'Título › A › A1', 'Título › B']);
    expect(d.sections[1].content).toContain('## no es encabezado');
  });

  it('extrae etiquetas del frontmatter y del cuerpo, y enlaces wiki', () => {
    const d = parseMarkdown(md, 'archivo');
    expect(d.tags.sort()).toEqual(['bd', 'etiqueta', 'sql']);
    expect(d.links).toEqual(['Enlace']);
  });

  it('reconoce propiedades --- justo debajo del H1 y no las indexa como texto', () => {
    const d = parseMarkdown(['# Subredes', '', '---', 'tipo: concepto', 'tags: [redes]', '---', '', 'Contenido real.'].join('\n'), 'x');
    expect(d.title).toBe('Subredes');
    expect(d.tags).toEqual(['redes']);
    expect(d.sections.map((s) => s.content).join(' ')).not.toContain('tipo:');
    expect(d.sections[0].content).toBe('Contenido real.');
  });

  it('usa el nombre del archivo si no hay H1 y divide secciones enormes', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Párrafo ${i} ` + 'palabra '.repeat(60)).join('\n\n');
    const d = parseMarkdown(long, 'apuntes');
    expect(d.title).toBe('apuntes');
    expect(d.sections.length).toBeGreaterThan(1);
    expect(d.sections[0].heading).toMatch(/apuntes \(parte 1\)/);
    expect(d.sections.every((s) => s.wordCount <= 1000)).toBe(true);
  });

  it('cuenta palabras con acentos y texto plano', () => {
    expect(countWords('Programación orientada a objetos')).toBe(4);
    expect(parsePlainText('hola mundo', 'x').sections).toHaveLength(1);
    expect(parsePlainText('   ', 'x').sections).toHaveLength(0);
  });
});
