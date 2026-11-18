import { ArrowLeft, GraduationCap } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TopicDetail, TopicSummary } from '../../shared/learning';
import type { ClaudeStatus } from '../../shared/types';
import { Chat } from '../components/Chat';
import { EmptyState, ErrorBanner, Skeleton } from '../components/ui';
import { useStudyTimer } from '../hooks/useStudyTimer';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

/** Tutor socrático de un tema: conoce la ruta, el nivel y las debilidades del estudiante. */
export function TutorPage({ topicId, claude }: { topicId: number | null; claude: ClaudeStatus | null }) {
  const { go } = useNav();
  const [topic, setTopic] = useState<TopicDetail | null | undefined>(undefined);
  const [conv, setConv] = useState<number | null>(null);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useStudyTimer(conv ? 'tutor' : null);

  useEffect(() => {
    void rpc.topicsList().then(setTopics);
    if (!topicId) return setTopic(null);
    void rpc.topicGet(topicId).then(setTopic);
    rpc.tutorOpen(topicId).then(setConv, (e) => setError(String(e?.message ?? e)));
  }, [topicId]);

  const active = topics.filter((t) => t.status !== 'diagnosing');

  return (
    <div className="h-full flex">
      <aside className="w-[240px] shrink-0 border-r border-line p-3 overflow-y-auto">
        <div className="text-[12px] font-semibold text-muted px-2 mb-2">Tutor por tema</div>
        {active.length === 0 && <p className="text-faint text-[12.5px] px-2">Crea un tema y completa su diagnóstico para hablar con su tutor.</p>}
        {active.map((t) => (
          <button key={t.id} onClick={() => go({ page: 'tutor', topicId: t.id })} className={`w-full text-left rounded-lg px-3 py-2 mb-0.5 text-[13px] transition-colors ${t.id === topicId ? 'bg-raised font-medium' : 'hover:bg-raised/60'}`}>
            {t.title}
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        {topicId && topic && (
          <div className="h-14 border-b border-line px-6 flex items-center gap-3">
            <button onClick={() => go({ page: 'topic', id: topic.id })} className="text-muted hover:text-fg" aria-label="Volver al tema"><ArrowLeft className="size-4" /></button>
            <GraduationCap className="size-4 text-accent" />
            <div className="min-w-0">
              <div className="font-medium text-[14px] truncate">Tutor · {topic.title}</div>
              <div className="text-faint text-[11.5px] truncate">Te guía con preguntas · conoce tu ruta y tus puntos débiles</div>
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0">
          {error ? (
            <div className="p-8"><ErrorBanner>{error}</ErrorBanner></div>
          ) : !topicId ? (
            <EmptyState icon={GraduationCap} title="Elige un tema">El tutor trabaja con el contexto de tu ruta de aprendizaje: elige a la izquierda sobre qué tema quieres hablar.</EmptyState>
          ) : conv == null ? (
            <div className="p-8"><Skeleton className="h-24" /></div>
          ) : (
            <Chat
              conversationId={conv}
              claude={claude}
              placeholder="Plantea una duda o un ejercicio en el que estés atascado…"
              empty={{ icon: GraduationCap, title: 'Tu profesor particular', text: 'Pregúntale dudas, pídele ejemplos o que te guíe paso a paso en un ejercicio. No te dará la solución directamente: te ayudará a razonarla.' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
