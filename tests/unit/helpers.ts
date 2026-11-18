import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempDir(prefix = 'studycore-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
}

export const SAMPLE_VAULT: Record<string, string> = {
  'notas/sql.md': [
    '---',
    'tags: [bases-de-datos, sql]',
    '---',
    '# SQL',
    'Lenguaje de consultas para bases de datos relacionales. Ver [[Normalización]].',
    '## Joins',
    'Un INNER JOIN devuelve solo las filas que tienen coincidencia en ambas tablas.',
    'Un LEFT JOIN conserva todas las filas de la tabla izquierda.',
    '```sql',
    '# esto no es un encabezado',
    'SELECT * FROM a JOIN b ON a.id = b.a_id;',
    '```',
    '## Índices',
    'Un índice acelera las búsquedas a cambio de espacio y escrituras más lentas. #rendimiento',
  ].join('\n'),
  'notas/Normalización.md': '# Normalización\nLa tercera forma normal elimina dependencias transitivas. Relacionado con [[sql]].',
  'redes/osi.txt': 'El modelo OSI tiene siete capas: física, enlace, red, transporte, sesión, presentación y aplicación.',
  'docs/libro.pdf': '%PDF-1.4 binario',
  '.obsidian/config.md': '# no debe indexarse',
  'imagenes/foto.png': 'png',
};
