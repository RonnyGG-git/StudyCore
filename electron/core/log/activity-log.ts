import fs from 'node:fs';
import path from 'node:path';
import type { ActivityEntry } from '../../../shared/types';
import type { Db } from '../db/database';
import { redact } from '../claude/claude-client';

/** Registro de actividad: todo en la BD; advertencias y errores también en un archivo de texto. */
export class ActivityLog {
  constructor(private db: Db, private logFile: string | null) {}

  write(level: ActivityEntry['level'], category: string, message: string, data?: unknown) {
    const msg = redact(message);
    const json = data === undefined ? null : redact(JSON.stringify(data));
    try {
      this.db.run('INSERT INTO activity_log (level, category, message, data) VALUES (?,?,?,?)', level, category, msg, json);
    } catch {
      /* el registro nunca debe tumbar la operación principal */
    }
    if (level !== 'info' && this.logFile) {
      try {
        fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
        fs.appendFileSync(this.logFile, `${new Date().toISOString()} [${level}] ${category}: ${msg}${json ? ` ${json}` : ''}\n`);
      } catch {
        /* idem */
      }
    }
  }

  info(category: string, message: string, data?: unknown) {
    this.write('info', category, message, data);
  }
  warn(category: string, message: string, data?: unknown) {
    this.write('warn', category, message, data);
  }
  error(category: string, message: string, data?: unknown) {
    this.write('error', category, message, data);
  }

  recent(limit = 12): ActivityEntry[] {
    return this.db.all<ActivityEntry>('SELECT id, at, level, category, message FROM activity_log ORDER BY id DESC LIMIT ?', limit);
  }
}
