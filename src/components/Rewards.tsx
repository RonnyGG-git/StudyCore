import { Award, Sparkles, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Reward } from '../../shared/learning';
import { api } from '../lib/api';
import { Button } from './ui';

interface Toast extends Reward {
  key: number;
}

/** Muestra cada recompensa REAL que otorga el proceso principal: XP, logros y subidas de nivel. */
export function Rewards() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [level, setLevel] = useState<{ n: number; name: string } | null>(null);

  useEffect(
    () =>
      api.onReward((r) => {
        const key = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-3), { ...r, key }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.key !== key)), 4200);
        if (r.levelUp) setLevel(r.levelUp);
      }),
    [],
  );

  return (
    <>
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end pointer-events-none" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.key} className="pointer-events-auto animate-rise rounded-xl border border-line bg-surface shadow-[0_12px_32px_-12px_rgb(0_0_0/0.35)] px-4 py-3 min-w-[260px] max-w-[340px]">
            {t.xp > 0 && (
              <div className="flex items-center gap-2.5">
                <span className="size-8 rounded-lg bg-accent-soft text-accent grid place-items-center"><Zap className="size-4" /></span>
                <div className="min-w-0">
                  <div className="font-display font-semibold text-accent">+{t.xp} XP</div>
                  <div className="text-[12px] text-muted truncate">{t.reason}</div>
                </div>
              </div>
            )}
            {t.achievements.map((a) => (
              <div key={a.code} className={`flex items-center gap-2.5 ${t.xp ? 'mt-2 pt-2 border-t border-line' : ''}`}>
                <span className="size-8 rounded-lg bg-warn/15 text-warn grid place-items-center"><Award className="size-4" /></span>
                <div>
                  <div className="text-[11.5px] text-muted">Logro desbloqueado</div>
                  <div className="font-semibold text-[13.5px]">{a.name}</div>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {level && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 backdrop-blur-[2px] animate-rise" role="dialog" aria-modal="true" aria-label="Subida de nivel">
          <div className="relative rounded-2xl border border-line bg-surface px-10 py-9 text-center shadow-2xl max-w-sm">
            <button className="absolute top-3 right-3 text-faint hover:text-fg" onClick={() => setLevel(null)} aria-label="Cerrar"><X className="size-4" /></button>
            <div className="mx-auto size-16 rounded-2xl bg-accent-soft text-accent grid place-items-center"><Sparkles className="size-8" /></div>
            <p className="text-muted mt-5 text-[13px]">¡Has subido de nivel!</p>
            <h2 className="font-display text-[28px] font-semibold tracking-tight mt-1">Nivel {level.n}</h2>
            <p className="text-accent font-medium">{level.name}</p>
            <Button variant="primary" className="mt-6 w-full" onClick={() => setLevel(null)}>Seguir aprendiendo</Button>
          </div>
        </div>
      )}
    </>
  );
}
