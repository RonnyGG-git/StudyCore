import { useCallback, useEffect, useState } from 'react';
import type { IndexProgress } from '../../shared/types';
import { api } from '../lib/api';

/** Lanza el indexado del vault y sigue su progreso real (eventos del proceso principal). */
export function useIndexer(onDone?: (p: IndexProgress) => void) {
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => api.onIndexProgress(setProgress), []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const r = await api.reindex();
    setRunning(false);
    if (r.ok) onDone?.(r.value);
    else setError(r.error);
    return r;
  }, [onDone]);

  return { run, running, progress, error };
}

export function describeProgress(p: IndexProgress | null): string {
  if (!p) return 'Preparando…';
  if (p.phase === 'scanning') return 'Explorando carpetas…';
  if (p.phase === 'indexing') return `Indexando ${p.processed} de ${p.total}`;
  if (p.phase === 'error') return p.message ?? 'Error';
  const parts = [p.added ? `${p.added} nuevos` : '', p.updated ? `${p.updated} actualizados` : '', p.removed ? `${p.removed} eliminados` : ''].filter(Boolean);
  return parts.length ? `Índice al día · ${parts.join(', ')}` : 'Índice al día · sin cambios';
}
