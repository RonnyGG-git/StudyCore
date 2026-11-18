import { useCallback, useEffect, useRef, useState } from 'react';
import type { Gen } from '../../shared/learning';
import type { ClaudeErrorKind } from '../../shared/types';
import { api, newRequestId } from '../lib/api';

export interface TaskState {
  running: boolean;
  steps: string[];
  startedAt: number;
  error: { kind: ClaudeErrorKind | 'validation'; text: string } | null;
}

/**
 * Ejecuta una tarea de Claude con progreso real (herramientas que usa), cancelación y error tipado.
 * El resultado se devuelve a quien llama; si se cancela, devuelve null sin mostrar error.
 */
export function useTask() {
  const [state, setState] = useState<TaskState>({ running: false, steps: [], startedAt: 0, error: null });
  const current = useRef<string | null>(null);

  useEffect(
    () =>
      api.onClaudeProgress((p) => {
        if (p.requestId !== current.current) return;
        setState((s) => (s.steps[s.steps.length - 1] === p.text ? s : { ...s, steps: [...s.steps, p.text].slice(-6) }));
      }),
    [],
  );
  useEffect(() => () => {
    if (current.current) void api.cancel(current.current);
  }, []);

  const run = useCallback(async <T,>(fn: (requestId: string) => Promise<Gen<T>>): Promise<T | null> => {
    const id = newRequestId();
    current.current = id;
    setState({ running: true, steps: [], startedAt: Date.now(), error: null });
    try {
      const r = await fn(id);
      if (current.current !== id) return null;
      current.current = null;
      if (r.ok) {
        setState((s) => ({ ...s, running: false }));
        return r.value;
      }
      setState((s) => ({ ...s, running: false, error: r.errorKind === 'cancelled' ? null : { kind: r.errorKind, text: r.error } }));
      return null;
    } catch (e) {
      current.current = null;
      setState((s) => ({ ...s, running: false, error: { kind: 'execution', text: e instanceof Error ? e.message : String(e) } }));
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    if (current.current) void api.cancel(current.current);
  }, []);
  const clearError = useCallback(() => setState((s) => ({ ...s, error: null })), []);

  return { ...state, run, cancel, clearError };
}

export const ERROR_HINT: Partial<Record<ClaudeErrorKind | 'validation', string>> = {
  not_found: 'No se encontró Claude Code en este equipo.',
  auth: 'Claude Code no tiene sesión iniciada. Ejecuta «claude auth login» en una terminal.',
  rate_limit: 'Se alcanzó el límite de uso de tu plan de Claude. Vuelve a intentarlo cuando se restablezca.',
  timeout: 'Claude tardó demasiado. Inténtalo de nuevo.',
  invalid_output: 'La respuesta de Claude llegó incompleta.',
};
