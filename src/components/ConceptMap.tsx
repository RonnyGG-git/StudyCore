import { useEffect, useMemo, useState } from 'react';
import type { ConceptMap as Map_ } from '../../shared/learning';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

const COL_W = 210;
const ROW_H = 46;
const NODE_W = 170;
const NODE_H = 32;

const FILL: Record<string, string> = {
  not_studied: 'rgb(var(--raised))',
  learning: 'rgb(var(--warn) / 0.18)',
  understood: 'rgb(var(--accent) / 0.18)',
  mastered: 'rgb(var(--ok) / 0.22)',
};
const STROKE: Record<string, string> = {
  not_studied: 'rgb(var(--line))',
  learning: 'rgb(var(--warn) / 0.6)',
  understood: 'rgb(var(--accent) / 0.6)',
  mastered: 'rgb(var(--ok) / 0.7)',
};

/** Mapa de conocimientos: fundamentos a la izquierda, flechas de prerrequisito, color según dominio. */
export function ConceptMap({ topicId }: { topicId: number }) {
  const { go } = useNav();
  const [map, setMap] = useState<Map_ | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => void rpc.conceptMap(topicId).then(setMap), [topicId]);

  const layout = useMemo(() => {
    if (!map) return null;
    const cols = new Map<number, typeof map.nodes>();
    for (const n of map.nodes) cols.set(n.depth, [...(cols.get(n.depth) ?? []), n]);
    const pos = new Map<number, { x: number; y: number }>();
    let rows = 0;
    [...cols.entries()].sort((a, b) => a[0] - b[0]).forEach(([d, ns]) => {
      ns.forEach((n, i) => pos.set(n.id, { x: 12 + d * COL_W, y: 12 + i * ROW_H }));
      rows = Math.max(rows, ns.length);
    });
    return { pos, width: 24 + Math.max(1, cols.size) * COL_W - (COL_W - NODE_W), height: 24 + rows * ROW_H - (ROW_H - NODE_H) };
  }, [map]);

  if (!map || !layout) return null;
  if (!map.nodes.length) return <p className="text-faint text-[13px]">El mapa aparece cuando el tema tiene conceptos.</p>;
  const related = (id: number) => new Set(map.edges.filter((e) => e.from === id || e.to === id).flatMap((e) => [e.from, e.to]));
  const lit = hover ? related(hover) : null;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <svg width={layout.width} height={layout.height} role="img" aria-label={`Mapa de ${map.nodes.length} conceptos y sus prerrequisitos`} className="block">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="rgb(var(--faint))" />
          </marker>
        </defs>
        {map.edges.map((e, i) => {
          const a = layout.pos.get(e.from)!;
          const b = layout.pos.get(e.to)!;
          const dim = lit && !(lit.has(e.from) && lit.has(e.to) && (e.from === hover || e.to === hover));
          if (e.kind === 'related') {
            return <line key={i} x1={a.x + NODE_W / 2} y1={a.y + NODE_H / 2} x2={b.x + NODE_W / 2} y2={b.y + NODE_H / 2} stroke="rgb(var(--line))" strokeDasharray="3 4" opacity={dim ? 0.2 : 0.8} />;
          }
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x - 2;
          const y2 = b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="rgb(var(--faint))" strokeWidth={1.3} markerEnd="url(#arrow)" opacity={dim ? 0.15 : 0.9} />;
        })}
        {map.nodes.map((n) => {
          const p = layout.pos.get(n.id)!;
          const dim = lit && !lit.has(n.id) && hover !== n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => go({ page: 'glossary', conceptId: n.id })}
              className="cursor-pointer"
              opacity={dim ? 0.35 : 1}
              role="link"
              aria-label={`${n.name}: dominio ${Math.round(n.mastery * 100)}%`}
            >
              <rect width={NODE_W} height={NODE_H} rx={9} fill={FILL[n.status]} stroke={hover === n.id ? 'rgb(var(--accent))' : STROKE[n.status]} />
              <rect x={8} y={NODE_H - 6} width={(NODE_W - 16) * n.mastery} height={2.5} rx={1.25} fill="rgb(var(--accent))" opacity={n.mastery ? 0.8 : 0} />
              <text x={NODE_W / 2} y={NODE_H / 2 + 1} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill="rgb(var(--fg))">
                {n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name}
              </text>
              <title>{`${n.name} · ${Math.round(n.mastery * 100)}%`}</title>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-3 px-4 py-2 border-t border-line text-[11.5px] text-muted">
        {[['not_studied', 'No estudiado'], ['learning', 'En aprendizaje'], ['understood', 'Comprendido'], ['mastered', 'Dominado']].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5"><span className="size-3 rounded" style={{ background: FILL[k], border: `1px solid ${STROKE[k]}` }} />{l}</span>
        ))}
        <span className="ml-auto">→ prerrequisito · ┄ relacionado · clic para abrir</span>
      </div>
    </div>
  );
}
