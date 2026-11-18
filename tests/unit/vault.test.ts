import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Db } from '../../electron/core/db/database';
import { resolveInVault } from '../../electron/core/vault/paths';
import { buildFtsQuery, VaultService } from '../../electron/core/vault/vault-service';
import { SAMPLE_VAULT, tempDir, writeFiles } from './helpers';

describe('VaultService', () => {
  let root: string;
  let vault: VaultService;
  let db: Db;

  beforeEach(async () => {
    root = tempDir('vault-');
    writeFiles(root, SAMPLE_VAULT);
    db = new Db(':memory:');
    vault = new VaultService(db, () => root);
    await vault.reindex();
  });

  it('indexa md y txt, marca un pdf ilegible como error sin romper el indexado e ignora carpetas ocultas', () => {
    const s = vault.stats();
    expect(s.documents).toBe(4);
    expect(s.indexedDocuments).toBe(3);
    expect(s.pending).toBe(1);
    const paths = db.all<{ rel_path: string }>('SELECT rel_path FROM vault_documents').map((r) => r.rel_path);
    expect(paths).not.toContain('.obsidian/config.md');
    expect(paths).not.toContain('imagenes/foto.png');
  });

  it('busca sin distinguir acentos y devuelve documento y apartado', () => {
    const hits = vault.search('normalizacion');
    expect(hits[0].path).toBe('notas/Normalización.md');
    const join = vault.search('inner join');
    expect(join[0].headingPath).toBe('SQL › Joins');
    expect(join[0].snippet).toContain('«');
  });

  it('la consulta FTS no admite operadores inyectados', () => {
    expect(buildFtsQuery('"); DROP TABLE x; -- NEAR(a b)')).toBe('"drop" OR "table"* OR "near"');
    expect(buildFtsQuery('modelo OSI capas')).toBe('"modelo"* OR "osi" OR "capa"*');
    expect(buildFtsQuery('de la el')).toBeNull();
    expect(vault.search('" OR * AND')).toEqual([]);
  });

  it('es incremental: solo reprocesa lo modificado y elimina lo borrado', async () => {
    const again = await vault.reindex();
    expect(again).toMatchObject({ added: 0, updated: 0, removed: 0 });
    const file = path.join(root, 'notas/sql.md');
    fs.writeFileSync(file, '# SQL\n## Vistas\nUna vista es una consulta guardada.');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    fs.rmSync(path.join(root, 'redes/osi.txt'));
    const r = await vault.reindex();
    expect(r).toMatchObject({ added: 0, updated: 1, removed: 1 });
    expect(vault.search('inner join')).toEqual([]);
    expect(vault.search('vista')[0].path).toBe('notas/sql.md');
    expect(db.get<{ n: number }>('SELECT COUNT(*) n FROM vault_fts')!.n).toBe(db.get<{ n: number }>('SELECT COUNT(*) n FROM vault_sections')!.n);
  });

  it('construye el árbol, etiquetas, enlaces y backlinks', () => {
    const tree = vault.tree()!;
    expect(tree.children!.map((c) => c.name)).toEqual(['docs', 'notas', 'redes']);
    const doc = vault.document('notas/sql.md');
    expect(doc.tags).toEqual(['bases-de-datos', 'rendimiento', 'sql']);
    expect(doc.links).toEqual(['normalización']);
    expect(doc.backlinks).toEqual(['notas/Normalización.md']);
  });

  it('retrieve limita fragmentos por documento y asigna referencias S#', () => {
    const r = vault.retrieve('join índice sql tablas', 8, 2);
    expect(r[0].ref).toBe('S1');
    expect(r.filter((x) => x.path === 'notas/sql.md').length).toBeLessThanOrEqual(2);
  });

  it('extrae el texto de un PDF por páginas y lo hace buscable', async () => {
    const page = (txt: string) => `BT /F1 12 Tf 72 720 Td (${txt}) Tj ET`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
      `<< /Length ${page('Primera pagina sobre enrutamiento estatico y tablas de rutas en routers Cisco').length} >>
stream
${page('Primera pagina sobre enrutamiento estatico y tablas de rutas en routers Cisco')}
endstream`,
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
      `<< /Length ${page('Segunda pagina dedicada al protocolo OSPF y sus areas de enrutamiento dinamico').length} >>
stream
${page('Segunda pagina dedicada al protocolo OSPF y sus areas de enrutamiento dinamico')}
endstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj
${o}
endobj
`;
    });
    const xref = pdf.length;
    pdf += `xref
0 ${objs.length + 1}
0000000000 65535 f 
${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n 
`).join('')}`;
    pdf += `trailer
<< /Size ${objs.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF`;
    fs.writeFileSync(path.join(root, 'redes/apuntes.pdf'), pdf, 'latin1');
    await vault.reindex();
    const hit = vault.search('ospf areas')[0];
    expect(hit.path).toBe('redes/apuntes.pdf');
    expect(hit.headingPath).toMatch(/^Páginas? /);
    expect(vault.document('redes/apuntes.pdf').status).toBe('indexed');
  });

  it('nunca resuelve rutas fuera del vault', () => {
    expect(() => resolveInVault(root, '../fuera.md')).toThrow(/sale del vault/);
    expect(() => resolveInVault(root, 'C:/Windows/win.ini')).toThrow();
    expect(() => vault.document('../../etc/passwd')).toThrow();
    expect(resolveInVault(root, 'notas/sql.md')).toBe(path.join(root, 'notas', 'sql.md'));
  });

  it('no escribe nada dentro del vault', async () => {
    const snapshot = () => fs.readdirSync(root, { recursive: true }).map(String).sort();
    const before = snapshot();
    await vault.reindex();
    vault.search('sql');
    expect(snapshot()).toEqual(before);
  });
});
