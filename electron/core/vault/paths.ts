import fs from 'node:fs';
import path from 'node:path';

/** true si `child` es `parent` o está dentro de él (comparación sin distinguir mayúsculas en Windows). */
export function isInside(parent: string, child: string): boolean {
  const norm = (p: string) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  const rel = path.relative(norm(parent), norm(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resuelve una ruta relativa del vault y garantiza que no sale de él,
 * ni con `..` ni a través de enlaces simbólicos.
 */
export function resolveInVault(vaultRoot: string, relPath: string): string {
  if (!vaultRoot) throw new Error('No hay un vault configurado.');
  if (path.isAbsolute(relPath)) throw new Error('Se esperaba una ruta relativa al vault.');
  const abs = path.resolve(vaultRoot, relPath);
  if (!isInside(vaultRoot, abs)) throw new Error('La ruta sale del vault.');
  if (fs.existsSync(abs)) {
    const real = fs.realpathSync(abs);
    if (!isInside(fs.realpathSync(vaultRoot), real)) throw new Error('La ruta sale del vault (enlace).');
  }
  return abs;
}

export function toRel(vaultRoot: string, abs: string): string {
  return path.relative(vaultRoot, abs).split(path.sep).join('/');
}
