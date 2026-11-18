import type { z } from 'zod';
import type { Gen } from '../../../shared/learning';
import type { Db } from '../db/database';
import type { ActivityLog } from '../log/activity-log';
import { recordRun, type ClaudeRunner } from '../tutor/ask-service';
import { toCliSchema } from '../tutor/prompts';

export interface TaskContext {
  signal?: AbortSignal;
  onProgress: (text: string) => void;
}

export interface TaskSpec<S extends z.ZodType> {
  task: string;
  schema: S;
  system: string;
  prompt: string;
  /** Mensaje de progreso inicial que ve el estudiante. */
  label: string;
  timeoutMs?: number;
}

/**
 * Punto único para tareas estructuradas (diagnóstico, rutas, lecciones, quizzes, corrección…):
 * prompt con "TAREA:", esquema JSON validado con zod, un reintento si la salida no cumple,
 * registro de cada ejecución y errores tipados.
 */
export class ClaudeGateway {
  private schemas = new WeakMap<z.ZodType, object>();

  constructor(
    private db: Db,
    private claude: ClaudeRunner,
    private log: ActivityLog,
    private getRoot: () => string,
    private settings: () => { model: string; effort: string },
  ) {}

  async run<S extends z.ZodType>(spec: TaskSpec<S>, ctx: TaskContext): Promise<Gen<z.infer<S>>> {
    const root = this.getRoot();
    if (!root) return { ok: false, errorKind: 'validation', error: 'Configura primero el vault en Ajustes.' };
    let jsonSchema = this.schemas.get(spec.schema);
    if (!jsonSchema) {
      jsonSchema = toCliSchema(spec.schema);
      this.schemas.set(spec.schema, jsonSchema);
    }
    const s = this.settings();
    const prompt = `TAREA: ${spec.task}\n\n${spec.prompt}\n\nEntrega el resultado con la herramienta StructuredOutput.`;
    ctx.onProgress(spec.label);

    let issues = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await this.claude.run({
        prompt: attempt === 1 ? prompt : `${prompt}\n\nATENCIÓN: un intento anterior no cumplió el formato (${issues}). Respeta exactamente el esquema.`,
        systemPrompt: spec.system,
        cwd: root,
        jsonSchema,
        model: s.model || undefined,
        effort: s.effort || undefined,
        timeoutMs: spec.timeoutMs ?? 8 * 60_000,
        signal: ctx.signal,
        onProgress: ctx.onProgress,
      });
      recordRun(this.db, spec.task, prompt.length, r);
      if (!r.ok && r.errorKind !== 'invalid_output') {
        if (r.errorKind !== 'cancelled') this.log.error('claude', `Tarea ${spec.task} fallida: ${r.errorMessage}`);
        return { ok: false, errorKind: r.errorKind!, error: r.errorMessage! };
      }
      const parsed = spec.schema.safeParse(r.structured);
      if (parsed.success) return { ok: true, value: parsed.data };
      issues = r.ok ? parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : 'sin resultado estructurado';
      this.log.warn('claude', `Tarea ${spec.task}: salida inválida (intento ${attempt})`, { issues });
      ctx.onProgress('La respuesta llegó incompleta; reintentando…');
    }
    return { ok: false, errorKind: 'invalid_output', error: 'Claude no entregó un resultado válido tras dos intentos. Inténtalo de nuevo.' };
  }
}

export function fail<T>(error: string): Gen<T> {
  return { ok: false, errorKind: 'validation', error };
}
