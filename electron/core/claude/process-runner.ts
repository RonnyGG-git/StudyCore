import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export interface RunOptions {
  cwd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  spawnError: NodeJS.ErrnoException | null;
  durationMs: number;
}

const MAX_CAPTURE = 4 * 1024 * 1024;
const live = new Set<number>();

/**
 * Ejecuta un proceso SIN shell (los argumentos nunca se interpretan), con límite de tiempo,
 * cancelación y muerte del árbol de procesos completo.
 */
export function runProcess(executable: string, opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let lineBuf = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    let child: ChildProcess;

    try {
      child = spawn(executable, opts.args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ exitCode: null, stdout, stderr, timedOut, cancelled, spawnError: err as NodeJS.ErrnoException, durationMs: 0 });
      return;
    }
    if (child.pid) live.add(child.pid);

    const finish = (exitCode: number | null, spawnError: NodeJS.ErrnoException | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (child.pid) live.delete(child.pid);
      if (lineBuf.trim()) opts.onStdoutLine?.(lineBuf);
      resolve({ exitCode, stdout, stderr, timedOut, cancelled, spawnError, durationMs: Date.now() - started });
    };
    const onAbort = () => {
      cancelled = true;
      killTree(child.pid);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      if (stdout.length < MAX_CAPTURE) stdout += chunk;
      lineBuf += chunk;
      let idx: number;
      while ((idx = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, idx).replace(/\r$/, '');
        lineBuf = lineBuf.slice(idx + 1);
        if (line) opts.onStdoutLine?.(line);
      }
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (chunk: string) => {
      if (stderr.length < MAX_CAPTURE) stderr += chunk;
    });
    child.stdin!.on('error', () => {});
    child.stdin!.end(opts.stdin ?? '');
    child.on('error', (err) => finish(null, err as NodeJS.ErrnoException));
    child.on('close', (code) => finish(code, null));
  });
}

export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ya terminó */
    }
  }
}

/** Al cerrar la app no deben quedar procesos de Claude huérfanos. */
export function killAllLive(): void {
  for (const pid of live) killTree(pid);
  live.clear();
}
