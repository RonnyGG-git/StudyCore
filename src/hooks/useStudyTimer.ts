import { useEffect } from 'react';
import { rpc } from '../lib/rpc';

const TICK = 30;
const IDLE_LIMIT_MS = 90_000;

/**
 * Tiempo de estudio EFECTIVO: solo cuenta en pantallas de estudio, con la ventana enfocada y
 * con interacción reciente. No suma XP: el tiempo solo alimenta estadísticas y objetivos.
 */
export function useStudyTimer(kind: string | null) {
  useEffect(() => {
    if (!kind) return;
    let last = Date.now();
    const mark = () => (last = Date.now());
    const events = ['keydown', 'pointerdown', 'wheel', 'pointermove'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const t = setInterval(() => {
      if (document.hasFocus() && document.visibilityState === 'visible' && Date.now() - last < IDLE_LIMIT_MS) void rpc.trackTime(TICK, kind);
    }, TICK * 1000);
    return () => {
      clearInterval(t);
      events.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [kind]);
}
