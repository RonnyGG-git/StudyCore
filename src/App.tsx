import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClaudeStatus, Settings, Theme } from '../shared/types';
import { Rewards } from './components/Rewards';
import { Sidebar } from './components/Sidebar';
import { api } from './lib/api';
import { NavContext, type Route } from './lib/nav';
import { AskPage } from './pages/AskPage';
import { AssessmentPage } from './pages/AssessmentPage';
import { CardsPage } from './pages/CardsPage';
import { ChallengesPage } from './pages/ChallengesPage';
import { DashboardPage } from './pages/DashboardPage';
import { GlossaryPage } from './pages/GlossaryPage';
import { LessonPage } from './pages/LessonPage';
import { LibraryPage } from './pages/LibraryPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { PlannerPage } from './pages/PlannerPage';
import { ProgressPage } from './pages/ProgressPage';
import { SettingsPage } from './pages/SettingsPage';
import { TopicPage } from './pages/TopicPage';
import { TopicsPage } from './pages/TopicsPage';
import { TutorPage } from './pages/TutorPage';

function applyTheme(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Ruta inicial desde el hash (#topic/3, #lesson/5, #progress…): permite abrir la app en una pantalla concreta. */
function routeFromHash(): Route {
  const [page, arg] = window.location.hash.replace(/^#/, '').split('/');
  const n = arg ? Number(arg) : undefined;
  switch (page) {
    case 'ask': return { page: 'ask', conversationId: n ?? null };
    case 'library': return { page: 'library', doc: arg ? decodeURIComponent(arg) : undefined };
    case 'topic': return n ? { page: 'topic', id: n } : { page: 'topics' };
    case 'lesson': return n ? { page: 'lesson', id: n } : { page: 'topics' };
    case 'assessment': return n ? { page: 'assessment', id: n } : { page: 'topics' };
    case 'tutor': return { page: 'tutor', topicId: n ?? 0 };
    case 'challenges': return { page: 'challenges', id: n };
    case 'glossary': return { page: 'glossary', conceptId: n };
    case 'topics': case 'cards': case 'progress': case 'planner': case 'settings': return { page } as Route;
    default: return { page: 'dashboard' };
  }
}

const routeKey = (r: Route) => JSON.stringify(r);

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [claude, setClaude] = useState<ClaudeStatus | null>(null);
  const [route, setRoute] = useState<Route>(routeFromHash);

  useEffect(() => {
    void api.getSettings().then(setSettings);
    void api.claudeStatus(false).then(setClaude);
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.theme);
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [settings]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    const r = await api.updateSettings(patch);
    if (r.ok) setSettings(r.value);
    return r;
  }, []);

  const refreshClaude = useCallback(async () => {
    setClaude(null);
    setClaude(await api.claudeStatus(true));
  }, []);

  const nav = useMemo(() => ({ route, go: setRoute }), [route]);

  if (!settings) return <div className="h-full bg-bg" />;
  if (!settings.vaultPath) return <OnboardingPage settings={settings} claude={claude} onSave={saveSettings} />;

  const key = routeKey(route);
  return (
    <NavContext.Provider value={nav}>
      <div className="h-full flex">
        <Sidebar theme={settings.theme} onTheme={(theme) => void saveSettings({ theme })} claude={claude} />
        <main key={key} className="flex-1 min-w-0 overflow-hidden animate-[rise_220ms_cubic-bezier(0.2,0.7,0.2,1)_both]">
          {route.page === 'dashboard' && <DashboardPage claude={claude} />}
          {route.page === 'topics' && <TopicsPage create={route.create} />}
          {route.page === 'topic' && <TopicPage id={route.id} />}
          {route.page === 'lesson' && <LessonPage id={route.id} claude={claude} />}
          {route.page === 'assessment' && <AssessmentPage id={route.id} create={route.create} />}
          {route.page === 'tutor' && <TutorPage topicId={route.topicId || null} claude={claude} />}
          {route.page === 'cards' && <CardsPage topicId={route.topicId} />}
          {route.page === 'challenges' && <ChallengesPage id={route.id} create={route.create} />}
          {route.page === 'glossary' && <GlossaryPage conceptId={route.conceptId} topicId={route.topicId} />}
          {route.page === 'progress' && <ProgressPage />}
          {route.page === 'planner' && <PlannerPage />}
          {route.page === 'library' && <LibraryPage initialDoc={route.doc} initialQuery={route.query} />}
          {route.page === 'ask' && <AskPage conversationId={route.conversationId ?? null} draft={route.draft} claude={claude} />}
          {route.page === 'settings' && <SettingsPage settings={settings} claude={claude} onSave={saveSettings} onRefreshClaude={refreshClaude} />}
        </main>
      </div>
      <Rewards />
    </NavContext.Provider>
  );
}
