import { randomUUID } from 'node:crypto';
import type { ClaudeErrorKind, ClaudeStatus } from '../../../shared/types';
import { resolveExecutable } from './executables';
import { runProcess } from './process-runner';

export interface ClaudeRequest {
  prompt: string;
  systemPrompt: string;
  /** Carpeta de trabajo: el vault. Claude solo puede leer dentro de ella. */
  cwd: string;
  jsonSchema?: object;
  /** Reanudar una conversación existente. */
  resumeSessionId?: string | null;
  model?: string;
  effort?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (text: string) => void;
}

export interface ClaudeResult {
  ok: boolean;
  sessionId: string | null;
  model: string | null;
  text: string;
  structured: unknown;
  costUsd: number | null;
  durationMs: number;
  errorKind: ClaudeErrorKind | null;
  errorMessage: string | null;
}

/** Únicas herramientas que recibe Claude: leer y buscar. Nunca escribe ni ejecuta comandos. */
export const READ_ONLY_TOOLS = 'Read,Glob,Grep';

const AUTH_RE = /not logged in|please run \/login|invalid api key|authentication[_ ]?(error|failed)|unauthori[sz]ed|\b401\b|no credentials|oauth token (has )?expired/i;
const RATE_RE = /rate[ _-]?limit|usage limit|\b429\b|quota|overloaded|too many requests|limit reached|resets at/i;
const SESSION_RE = /no conversation found|session .*not found|could not find session/i;

export function classifyError(text: string): ClaudeErrorKind {
  if (SESSION_RE.test(text)) return 'session';
  if (AUTH_RE.test(text)) return 'auth';
  if (RATE_RE.test(text)) return 'rate_limit';
  return 'execution';
}

export function redact(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]{16,}/g, 'sk-***')
    .replace(/(bearer\s+)[\w.-]{16,}/gi, '$1***')
    .replace(/("?(?:api[_-]?key|token|password|secret|authorization)"?\s*[:=]\s*"?)[^"\s,}]{6,}/gi, '$1***');
}

export function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/** Entorno limpio: una sesión de Claude Code padre no debe confundirse con la hija. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SSE_PORT;
  return env;
}

export interface ClaudeClientOptions {
  executable?: string | null;
  /** Pruebas: ejecutable = node y prefixArgs = [script que simula la CLI]. */
  prefixArgs?: string[];
}

export class ClaudeClient {
  private exe: string | null;

  constructor(private opts: ClaudeClientOptions = {}) {
    this.exe = opts.executable === undefined ? resolveExecutable('claude') : opts.executable;
  }

  async status(): Promise<ClaudeStatus> {
    const checkedAt = new Date().toISOString();
    if (this.opts.executable === undefined) this.exe = resolveExecutable('claude');
    if (!this.exe) return { executable: null, version: null, loggedIn: false, detail: 'No se encontró Claude Code. Instálalo y reinicia StudyCore.', checkedAt };
    const pre = this.opts.prefixArgs ?? [];
    const v = await runProcess(this.exe, { cwd: process.cwd(), args: [...pre, '--version'], env: cleanEnv(), timeoutMs: 30_000 });
    const version = v.exitCode === 0 ? v.stdout.trim().split(/\r?\n/)[0] : null;
    const a = await runProcess(this.exe, { cwd: process.cwd(), args: [...pre, 'auth', 'status'], env: cleanEnv(), timeoutMs: 30_000 });
    try {
      const j = JSON.parse(a.stdout);
      return j.loggedIn
        ? { executable: this.exe, version, loggedIn: true, detail: `Sesión iniciada · ${j.authMethod ?? 'cuenta'}${j.subscriptionType ? ` · plan ${j.subscriptionType}` : ''}`, checkedAt }
        : { executable: this.exe, version, loggedIn: false, detail: 'Claude Code no tiene sesión. Ejecuta "claude auth login" en una terminal.', checkedAt };
    } catch {
      return { executable: this.exe, version, loggedIn: null, detail: truncate(redact(a.stderr || a.stdout), 200) || 'No se pudo comprobar la sesión.', checkedAt };
    }
  }

  buildArgs(req: ClaudeRequest, newSessionId: string | null): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      // Sin CLAUDE.md, hooks, plugins ni MCP del usuario: comportamiento predecible y aislado.
      '--safe-mode',
      '--strict-mcp-config',
      '--tools', READ_ONLY_TOOLS,
      '--allowedTools', READ_ONLY_TOOLS,
      // Todo lo que pediría permiso (p. ej. leer fuera del vault) se deniega sin preguntar.
      '--permission-mode', 'dontAsk',
      '--system-prompt', req.systemPrompt,
    ];
    if (req.jsonSchema) args.push('--json-schema', JSON.stringify(req.jsonSchema));
    if (req.model) args.push('--model', req.model);
    if (req.effort) args.push('--effort', req.effort);
    if (req.resumeSessionId) args.push('--resume', req.resumeSessionId);
    else if (newSessionId) args.push('--session-id', newSessionId);
    return args;
  }

  async run(req: ClaudeRequest): Promise<ClaudeResult> {
    if (!this.exe) this.exe = this.opts.executable === undefined ? resolveExecutable('claude') : this.opts.executable;
    if (!this.exe) return failed('not_found', 'No se encontró el ejecutable de Claude Code.');

    const newSessionId = req.resumeSessionId ? null : randomUUID();
    let sessionId: string | null = req.resumeSessionId ?? newSessionId;
    let model: string | null = null;
    let result: Record<string, any> | null = null;
    let rateRejected = false;
    const texts: string[] = [];

    const r = await runProcess(this.exe, {
      cwd: req.cwd,
      args: [...(this.opts.prefixArgs ?? []), ...this.buildArgs(req, newSessionId)],
      stdin: req.prompt,
      env: cleanEnv(),
      timeoutMs: req.timeoutMs ?? 6 * 60_000,
      signal: req.signal,
      onStdoutLine: (line) => {
        let ev: any;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.session_id) sessionId = ev.session_id;
        if (ev.type === 'system' && ev.subtype === 'init') {
          model = ev.model ?? null;
          req.onProgress?.('Claude está analizando la petición…');
        } else if (ev.type === 'assistant') {
          for (const c of ev.message?.content ?? []) {
            if (c.type === 'text' && c.text?.trim()) texts.push(c.text);
            else if (c.type === 'tool_use') req.onProgress?.(describeTool(c.name, c.input, req.cwd));
          }
        } else if (ev.type === 'rate_limit_event' && ev.rate_limit_info?.status === 'rejected') {
          rateRejected = true;
        } else if (ev.type === 'result') {
          result = ev;
        }
      },
    });

    const res = result as Record<string, any> | null;
    const base = {
      sessionId,
      model,
      text: res?.result != null ? String(res.result) : texts.join('\n'),
      structured: res?.structured_output ?? null,
      costUsd: typeof res?.total_cost_usd === 'number' ? res.total_cost_usd : null,
      durationMs: r.durationMs,
    };
    const fail = (errorKind: ClaudeErrorKind, errorMessage: string): ClaudeResult => ({ ...base, ok: false, errorKind, errorMessage });

    if (r.spawnError) return fail(r.spawnError.code === 'ENOENT' ? 'not_found' : 'execution', r.spawnError.message);
    if (r.cancelled) return fail('cancelled', 'Cancelado.');
    if (r.timedOut) return fail('timeout', 'Claude tardó demasiado en responder y se detuvo la ejecución.');
    if (rateRejected) return fail('rate_limit', 'Se alcanzó el límite de uso de Claude. Espera a que se restablezca.');
    if (!res || res.is_error || r.exitCode !== 0) {
      const detail = redact(`${res?.result ?? ''} ${res?.api_error_status ?? ''} ${r.stderr}`.trim()) || `La CLI terminó con código ${r.exitCode}.`;
      const kind = res?.api_error_status === 401 || res?.api_error_status === 403 ? 'auth' : classifyError(detail);
      return fail(kind, truncate(detail, 400));
    }
    if (req.jsonSchema && base.structured == null) return fail('invalid_output', 'La respuesta de Claude llegó incompleta (sin el resultado estructurado).');
    return { ...base, ok: true, errorKind: null, errorMessage: null };
  }
}

function failed(kind: ClaudeErrorKind, msg: string): ClaudeResult {
  return { ok: false, sessionId: null, model: null, text: '', structured: null, costUsd: null, durationMs: 0, errorKind: kind, errorMessage: msg };
}

export function describeTool(name: string, input: any, root: string): string {
  const i = input ?? {};
  const rel = (p: unknown) => {
    const s = String(p ?? '').replace(/\\/g, '/');
    const r = root.replace(/\\/g, '/');
    return s.toLowerCase().startsWith(r.toLowerCase()) ? s.slice(r.length).replace(/^\//, '') || '(vault)' : s;
  };
  switch (name) {
    case 'Read': return `Leyendo ${rel(i.file_path)}`;
    case 'Glob': return `Buscando archivos ${i.pattern ?? ''}`;
    case 'Grep': return `Buscando «${truncate(String(i.pattern ?? ''), 50)}» en el vault`;
    case 'StructuredOutput': return 'Redactando la respuesta…';
    default: return `Usando ${name}`;
  }
}
