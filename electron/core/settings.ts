import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Settings } from '../../shared/types';
import type { Db } from './db/database';
import { isInside } from './vault/paths';

export const SettingsPatchSchema = z
  .object({
    vaultPath: z.string().max(1024),
    outputDir: z.string().max(1024),
    model: z.enum(['', 'sonnet', 'opus', 'haiku']),
    effort: z.enum(['', 'low', 'medium', 'high']),
    theme: z.enum(['system', 'light', 'dark']),
  })
  .partial();

export class SettingsStore {
  constructor(private db: Db, private defaults: Settings) {}

  get(): Settings {
    const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    return { ...this.defaults, ...SettingsPatchSchema.parse(stored) };
  }

  /** Valida y guarda. Devuelve el error en español si la combinación no es segura. */
  update(patch: unknown): Settings {
    const p = SettingsPatchSchema.parse(patch);
    const next = { ...this.get(), ...p };
    if (p.vaultPath !== undefined && p.vaultPath) {
      next.vaultPath = path.resolve(p.vaultPath);
      if (!fs.existsSync(next.vaultPath) || !fs.statSync(next.vaultPath).isDirectory()) throw new Error('La carpeta del vault no existe.');
    }
    if (p.outputDir !== undefined) next.outputDir = path.resolve(p.outputDir || this.defaults.outputDir);
    if (next.vaultPath && next.outputDir && isInside(next.vaultPath, next.outputDir)) {
      throw new Error('La carpeta de resultados no puede estar dentro del vault: StudyCore nunca escribe en tus notas originales.');
    }
    this.db.tx(() => {
      for (const [k, v] of Object.entries(next)) this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
    });
    return next;
  }
}
