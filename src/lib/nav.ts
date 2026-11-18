import { createContext, useContext } from 'react';
import type { QuizRequest, Recommendation } from '../../shared/learning';

export type Route =
  | { page: 'dashboard' }
  | { page: 'topics'; create?: boolean }
  | { page: 'topic'; id: number }
  | { page: 'lesson'; id: number }
  | { page: 'assessment'; id?: number; create?: QuizRequest }
  | { page: 'tutor'; topicId: number }
  | { page: 'cards'; topicId?: number | null }
  | { page: 'challenges'; id?: number; create?: { topicId: number; moduleId?: number | null } }
  | { page: 'glossary'; conceptId?: number; topicId?: number | null }
  | { page: 'progress' }
  | { page: 'planner' }
  | { page: 'library'; doc?: string; query?: string }
  | { page: 'ask'; conversationId?: number | null; draft?: string }
  | { page: 'settings' };

export interface NavContextValue {
  route: Route;
  go: (r: Route) => void;
}

export const NavContext = createContext<NavContextValue>({ route: { page: 'dashboard' }, go: () => {} });
export const useNav = () => useContext(NavContext);

/** Convierte una recomendación (del sistema o de Claude) en el destino real dentro de la app. */
export function routeFor(r: Recommendation): Route {
  switch (r.action) {
    case 'diagnostic':
      return r.targetId ? { page: 'assessment', id: r.targetId } : { page: 'topic', id: r.topicId! };
    case 'lesson':
      return { page: 'lesson', id: r.targetId! };
    case 'module_quiz':
      return { page: 'assessment', create: { topicId: r.topicId!, kind: 'module_quiz', mode: 'exam', moduleId: r.targetId } };
    case 'review_cards':
      return { page: 'cards' };
    case 'reinforce_concept':
      return { page: 'assessment', create: { topicId: r.topicId!, kind: 'reinforcement', mode: 'practice', conceptIds: [r.targetId!] } };
    case 'challenge':
      return { page: 'challenges', id: r.targetId! };
    case 'tutor':
      return r.topicId ? { page: 'tutor', topicId: r.topicId } : { page: 'ask' };
    case 'new_topic':
      return { page: 'topics', create: true };
  }
}
