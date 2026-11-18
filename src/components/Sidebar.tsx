import { BarChart3, BookOpen, BookOpenCheck, Brain, CalendarDays, GraduationCap, LayoutDashboard, MessageCircleQuestion, MessagesSquare, Monitor, Moon, Settings, Sun, Swords, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GameState } from '../../shared/learning';
import type { ClaudeStatus, Theme } from '../../shared/types';
import { api } from '../lib/api';
import { useNav, type Route } from '../lib/nav';
import { rpc } from '../lib/rpc';

type Item = { label: string; icon: LucideIcon; route: Route; match: Route['page'][] };

const SECTIONS: { title: string | null; items: Item[] }[] = [
  { title: null, items: [{ label: 'Inicio', icon: LayoutDashboard, route: { page: 'dashboard' }, match: ['dashboard'] }] },
  {
    title: 'Estudiar',
    items: [
      { label: 'Aprender', icon: GraduationCap, route: { page: 'topics' }, match: ['topics', 'topic', 'lesson', 'assessment'] },
      { label: 'Tutor', icon: MessageCircleQuestion, route: { page: 'tutor', topicId: 0 }, match: ['tutor'] },
      { label: 'Repasar', icon: Brain, route: { page: 'cards' }, match: ['cards'] },
      { label: 'Retos', icon: Swords, route: { page: 'challenges' }, match: ['challenges'] },
    ],
  },
  {
    title: 'Conocimiento',
    items: [
      { label: 'Consultar', icon: MessagesSquare, route: { page: 'ask' }, match: ['ask'] },
      { label: 'Glosario', icon: BookOpenCheck, route: { page: 'glossary' }, match: ['glossary'] },
      { label: 'Biblioteca', icon: BookOpen, route: { page: 'library' }, match: ['library'] },
    ],
  },
  {
    title: 'Progreso',
    items: [
      { label: 'Estadísticas', icon: BarChart3, route: { page: 'progress' }, match: ['progress'] },
      { label: 'Planificador', icon: CalendarDays, route: { page: 'planner' }, match: ['planner'] },
    ],
  },
];

export function Sidebar({ theme, onTheme, claude }: { theme: Theme; onTheme: (t: Theme) => void; claude: ClaudeStatus | null }) {
  const { route, go } = useNav();
  const [game, setGame] = useState<GameState | null>(null);
  const [due, setDue] = useState(0);
  useEffect(() => {
    const load = () => {
      void rpc.game().then(setGame);
      void rpc.cardsOverview().then((o) => setDue(o.due));
    };
    load();
    const off = api.onReward(load);
    const t = setInterval(load, 60_000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [route.page]);

  const next: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const dot = claude == null ? 'bg-faint' : claude.loggedIn ? 'bg-ok' : 'bg-bad';
  const linkCls = (active: boolean) =>
    `relative w-full flex items-center gap-3 h-[34px] px-3 rounded-lg text-[13.5px] transition-colors ${active ? 'bg-raised text-fg font-medium' : 'text-muted hover:text-fg hover:bg-raised/60'}`;

  return (
    <aside className="w-[228px] shrink-0 border-r border-line bg-surface/60 flex flex-col">
      <div className="h-14 flex items-center gap-2.5 px-5">
        <Logo />
        <span className="font-display font-semibold text-[16px] tracking-tight">StudyCore</span>
      </div>

      {game && (
        <button onClick={() => go({ page: 'progress' })} className="mx-3 mb-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left hover:border-accent/40 transition-colors" title="Ver progreso">
          <div className="flex items-center justify-between text-[12px]">
            <span className="font-medium">Nv. {game.level.n} · {game.level.name}</span>
            <span className="text-faint tabular-nums">{game.xp} XP</span>
          </div>
          <div className="h-1.5 rounded-full bg-line/70 overflow-hidden mt-1.5">
            <div className="h-full bg-accent rounded-full transition-[width] duration-700" style={{ width: `${game.progressToNext * 100}%` }} />
          </div>
          <div className="text-[11px] text-faint mt-1">🔥 Racha de {game.streak.current} día{game.streak.current !== 1 ? 's' : ''}</div>
        </button>
      )}

      <nav className="px-3 flex-1 overflow-y-auto" aria-label="Principal">
        {SECTIONS.map((s) => (
          <div key={s.title ?? 'root'} className="mb-2">
            {s.title && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{s.title}</div>}
            {s.items.map((it) => {
              const active = it.match.includes(route.page);
              const Icon = it.icon;
              return (
                <button key={it.label} onClick={() => go(it.route)} aria-current={active ? 'page' : undefined} className={linkCls(active)}>
                  {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent" />}
                  <Icon className={`size-[17px] ${active ? 'text-accent' : ''}`} />
                  {it.label}
                  {it.label === 'Repasar' && due > 0 && <span className="ml-auto text-[11px] px-1.5 rounded-full bg-accent text-accent-fg tabular-nums">{due}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 space-y-0.5 border-t border-line">
        <button onClick={() => go({ page: 'settings' })} className={linkCls(route.page === 'settings')}>
          <Settings className="size-[17px]" />
          Ajustes
          <span className={`ml-auto size-2 rounded-full ${dot}`} title={claude?.detail ?? 'Comprobando Claude Code…'} />
        </button>
        <button onClick={() => onTheme(next[theme])} className={linkCls(false)}>
          <ThemeIcon className="size-[17px]" />
          Tema: {theme === 'light' ? 'Claro' : theme === 'dark' ? 'Oscuro' : 'Sistema'}
        </button>
      </div>
    </aside>
  );
}

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="text-accent">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="currentColor" opacity="0.14" />
      <path d="M9 21.5 16 9l7 12.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="21.5" r="2.4" fill="currentColor" />
    </svg>
  );
}
