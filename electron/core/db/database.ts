import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations';

export type Row = Record<string, any>;

/** Envoltorio fino sobre node:sqlite: sin módulos nativos que recompilar para Electron. */
export class Db {
  readonly raw: DatabaseSync;

  constructor(readonly file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;');
    this.migrate();
  }

  get version(): number {
    return Number(this.get('PRAGMA user_version')?.user_version ?? 0);
  }

  private migrate() {
    for (const m of MIGRATIONS) {
      if (m.version <= this.version) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.raw.exec(`PRAGMA user_version = ${m.version}`);
      });
    }
  }

  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (err) {
      this.raw.exec('ROLLBACK');
      throw err;
    }
  }

  /** Copia consistente de la base aunque esté en uso (VACUUM INTO). */
  backupTo(target: string) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    this.raw.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  }

  close() {
    this.raw.close();
  }
}
