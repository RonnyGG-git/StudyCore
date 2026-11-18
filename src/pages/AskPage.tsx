import { MessagesSquare, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ClaudeStatus, ConversationSummary } from '../../shared/types';
import { Chat } from '../components/Chat';
import { Button } from '../components/ui';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { useNav } from '../lib/nav';

/** Consultas libres al vault, con historial de conversaciones. */
export function AskPage({ conversationId, draft, claude }: { conversationId: number | null; draft?: string; claude: ClaudeStatus | null }) {
  const { go } = useNav();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [current, setCurrent] = useState<number | null>(conversationId);
  const refresh = useCallback(() => void api.listConversations().then(setList), []);
  useEffect(refresh, [refresh]);

  return (
    <div className="h-full flex">
      <aside className="w-[260px] shrink-0 border-r border-line flex flex-col">
        <div className="p-3">
          <Button className="w-full" icon={Plus} onClick={() => go({ page: 'ask', conversationId: null })}>Nueva consulta</Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {list.length === 0 && <p className="text-faint text-[12.5px] px-3 py-2">Tus consultas aparecerán aquí.</p>}
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => go({ page: 'ask', conversationId: c.id })}
              className={`w-full text-left rounded-lg px-3 py-2 mb-0.5 transition-colors ${c.id === current ? 'bg-raised' : 'hover:bg-raised/60'}`}
            >
              <div className="text-[13px] truncate">{c.title}</div>
              <div className="text-faint text-[11.5px]">{relativeTime(c.updatedAt)} · {Math.ceil(c.messages / 2)} respuesta{c.messages > 2 ? 's' : ''}</div>
            </button>
          ))}
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <Chat
          conversationId={conversationId}
          draft={draft}
          claude={claude}
          onConversation={(id) => {
            setCurrent(id);
            refresh();
          }}
          placeholder="Pregunta, pide un ejemplo o que te lo explique distinto…"
          empty={{ icon: MessagesSquare, title: 'Consulta tu vault', text: 'Claude busca en tus notas, te explica y cita el documento y el apartado exactos. Lo que no esté en tus notas se marca aparte.' }}
        />
      </div>
    </div>
  );
}
