import { Loader2, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ERROR_HINT, type TaskState } from '../hooks/useTask';
import { Button, ErrorBanner } from './ui';

/** Progreso real de una tarea de Claude: pasos que va dando, tiempo y botón para detener. */
export function TaskProgress({ task, title, onCancel }: { task: TaskState; title: string; onCancel: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!task.running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [task.running]);
  if (!task.running) return null;
  const secs = Math.round((Date.now() - task.startedAt) / 1000);
  return (
    <div className="animate-rise rounded-2xl border border-line bg-surface p-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <Loader2 className="size-4 text-accent animate-spin" />
        <span className="font-medium text-[13.5px]">{title}</span>
        <span className="text-faint text-[12px] tabular-nums">{secs} s</span>
        <Button size="sm" variant="ghost" icon={Square} className="ml-auto" onClick={onCancel}>Detener</Button>
      </div>
      <ol className="mt-3 space-y-1 border-l border-line ml-2 pl-4">
        {(task.steps.length ? task.steps : ['Iniciando Claude Code…']).map((s, i, all) => (
          <li key={`${i}-${s}`} className={`text-[12.5px] animate-rise ${i === all.length - 1 ? 'text-fg' : 'text-faint'}`}>{s}</li>
        ))}
      </ol>
      {secs > 20 && <p className="text-faint text-[11.5px] mt-3">Las tareas largas (rutas, lecciones) pueden tardar uno o dos minutos.</p>}
    </div>
  );
}

export function TaskError({ task, onRetry, onDismiss }: { task: TaskState; onRetry?: () => void; onDismiss?: () => void }) {
  if (!task.error) return null;
  return (
    <ErrorBanner
      action={
        <div className="flex gap-1">
          {onRetry && <Button size="sm" onClick={onRetry}>Reintentar</Button>}
          {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>Cerrar</Button>}
        </div>
      }
    >
      <div className="font-medium">{ERROR_HINT[task.error.kind] ?? 'No se pudo completar.'}</div>
      <div className="text-muted text-[12.5px] mt-0.5 break-words">{task.error.text}</div>
    </ErrorBanner>
  );
}
