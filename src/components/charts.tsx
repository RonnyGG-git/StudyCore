import { useState } from 'react';

/** Barras verticales con etiqueta, valor al pasar el ratón y lectura accesible. */
export function Bars({ data, height = 120, format = (v: number) => String(v), label }: { data: { label: string; value: number; hint?: string }[]; height?: number; format?: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure aria-label={label} className="w-full">
      <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label={`${label}: ${data.map((d) => `${d.label} ${format(d.value)}`).join(', ')}`}>
        {data.map((d, i) => (
          <div key={i} className="relative flex-1 h-full flex items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div
              className={`w-full rounded-t-[4px] transition-[height,background] duration-500 ${d.value ? (hover === i ? 'bg-accent' : 'bg-accent/60') : 'bg-line/60'}`}
              style={{ height: d.value ? `${Math.max(4, (d.value / max) * 100)}%` : 3 }}
            />
            {hover === i && (
              <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-fg text-bg text-[11px] px-2 py-1 z-10 pointer-events-none">
                {d.hint ?? d.label} · <b>{format(d.value)}</b>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[10px] text-faint truncate">{data.length <= 14 || i % 5 === 0 ? d.label : ''}</div>
        ))}
      </div>
    </figure>
  );
}

/** Línea de rendimiento (0-100 %) con puntos solo donde hay datos. */
export function Line({ data, height = 110, label }: { data: { label: string; value: number | null }[]; height?: number; label: string }) {
  const w = 600;
  const pts = data.map((d, i) => ({ x: (i / Math.max(1, data.length - 1)) * w, y: d.value == null ? null : height - (d.value / 100) * (height - 10) - 5, ...d }));
  const valid = pts.filter((p) => p.y != null) as { x: number; y: number; label: string; value: number }[];
  const path = valid.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <figure aria-label={label}>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full overflow-visible" role="img" aria-label={`${label}: ${valid.map((p) => `${p.label} ${p.value}%`).join(', ') || 'sin datos'}`} preserveAspectRatio="none" style={{ height }}>
        {[25, 50, 75].map((g) => (
          <line key={g} x1={0} x2={w} y1={height - (g / 100) * (height - 10) - 5} y2={height - (g / 100) * (height - 10) - 5} stroke="rgb(var(--line))" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ))}
        {valid.length > 1 && <path d={path} fill="none" stroke="rgb(var(--accent))" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        {valid.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="rgb(var(--accent))" vectorEffect="non-scaling-stroke">
            <title>{`${p.label}: ${p.value}%`}</title>
          </circle>
        ))}
      </svg>
      {!valid.length && <p className="text-faint text-[12px] -mt-14 text-center">Aún sin respuestas en este periodo</p>}
    </figure>
  );
}

/** Anillo de progreso. */
export function Ring({ value, size = 64, stroke = 6, children, tone = 'accent' }: { value: number; size?: number; stroke?: number; children?: React.ReactNode; tone?: 'accent' | 'ok' | 'warn' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--line))" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`rgb(var(--${tone}))`} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} className="transition-[stroke-dashoffset] duration-700 ease-out" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function ProgressBar({ value, className = '', tone = 'accent' }: { value: number; className?: string; tone?: 'accent' | 'ok' }) {
  return (
    <div className={`h-1.5 rounded-full bg-line/70 overflow-hidden ${className}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone === 'ok' ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}
