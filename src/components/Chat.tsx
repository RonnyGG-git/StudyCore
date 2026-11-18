import { ArrowUp, BadgeCheck, BookMarked, Check, Copy, FileText, Lightbulb, Loader2, SearchX, ShieldAlert, Square, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ClaudeErrorKind, ClaudeStatus, MessageSource } from '../../shared/types';
import { ERROR_HINT } from '../hooks/useTask';
import { api, newRequestId } from '../lib/api';
import { Markdown } from '../lib/markdown';
import { useNav } from '../lib/nav';
import { Button, EmptyState, ErrorBanner, Kbd } from './ui';

interface Pending {
  requestId: string;
  question: string;
  steps: string[];
  startedAt: number;
}

export interface ChatProps {
  conversationId: number | null;
  onConversation?: (id: number) => void;
  draft?: string;
  claude: ClaudeStatus | null;
  placeholder?: string;
  empty: { icon: LucideIcon; title: string; text: string };
  compact?: boolean;
  /** Cambia cuando otra parte de la interfaz añadió mensajes (p. ej. una acción de lección). */
  refreshKey?: number;
}

/** Conversación con Claude (consultas al vault, tutor o chat de lección) con fuentes verificadas. */
export function Chat({ conversationId, onConversation, draft, claude, placeholder, empty, compact, refreshKey }: ChatProps) {
  const [convId, setConvId] = useState<number | null>(conversationId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<{ kind: ClaudeErrorKind; text: string; question: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const autoSent = useRef(false);

  useEffect(() => setConvId(conversationId), [conversationId]);
  useEffect(() => {
    if (convId) void api.getConversation(convId).then((c) => setMessages(c?.messages_ ?? []));
    else setMessages([]);
  }, [convId, refreshKey]);
  useEffect(
    () =>
      api.onClaudeProgress((p) =>
        setPending((cur) => (cur && cur.requestId === p.requestId && cur.steps[cur.steps.length - 1] !== p.text ? { ...cur, steps: [...cur.steps, p.text].slice(-6) } : cur)),
      ),
    [],
  );
  useEffect(() => {
    // Sin return implícito: en Chromium reciente scrollIntoView devuelve una Promise y React la tomaría como limpieza.
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, pending?.steps.length]);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || pending) return;
      const requestId = newRequestId();
      setError(null);
      setInput('');
      setPending({ requestId, question, steps: [], startedAt: Date.now() });
      const r = await api.ask({ conversationId: convId, question, requestId });
      setPending(null);
      if (r.ok) {
        const conv = await api.getConversation(r.conversationId);
        setConvId(r.conversationId);
        setMessages(conv?.messages_ ?? []);
        onConversation?.(r.conversationId);
      } else {
        setInput(question);
        if (r.errorKind !== 'cancelled') setError({ kind: r.errorKind, text: r.error, question });
      }
    },
    [convId, pending, onConversation],
  );

  useEffect(() => {
    if (draft && !autoSent.current) {
      autoSent.current = true;
      void send(draft);
    }
  }, [draft, send]);

  const ready = claude?.loggedIn !== false;
  const pad = compact ? 'px-5' : 'px-8';

  return (
    <section className="h-full min-w-0 flex flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className={`${compact ? '' : 'max-w-[780px]'} mx-auto ${pad} py-6 space-y-7 [&>*]:min-w-0`}>
          {messages.length === 0 && !pending && (
            <EmptyState icon={empty.icon} title={empty.title}>{empty.text}</EmptyState>
          )}
          {messages.map((m) => (m.role === 'user' ? <UserBubble key={m.id} text={m.content} /> : <Answer key={m.id} m={m} />))}
          {pending && (
            <>
              <UserBubble text={pending.question} />
              <Thinking pending={pending} onCancel={() => void api.cancel(pending.requestId)} />
            </>
          )}
          {error && (
            <ErrorBanner action={<Button size="sm" onClick={() => void send(error.question)}>Reintentar</Button>}>
              <div className="font-medium">{ERROR_HINT[error.kind] ?? 'No se pudo completar la consulta.'}</div>
              <div className="text-muted text-[12.5px] mt-0.5 break-words">{error.text}</div>
            </ErrorBanner>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className={`border-t border-line bg-bg/80 backdrop-blur ${pad} py-3.5`}>
        <form
          className={`${compact ? '' : 'max-w-[780px]'} mx-auto flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 pl-4 focus-within:border-accent/60 transition-colors`}
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={Math.min(6, Math.max(1, input.split('\n').length))}
            disabled={!ready}
            aria-label="Mensaje"
            placeholder={ready ? placeholder ?? 'Escribe tu pregunta…' : 'Claude Code no está disponible. Revisa Ajustes.'}
            className="flex-1 resize-none bg-transparent outline-none py-2 text-[14.5px] placeholder:text-faint max-h-40"
          />
          <Button variant="primary" type="submit" className="!px-2.5" disabled={!input.trim() || !!pending || !ready} aria-label="Enviar">
            <ArrowUp className="size-4" />
          </Button>
        </form>
        {!compact && (
          <p className="max-w-[780px] mx-auto text-faint text-[11.5px] mt-2 px-1">
            <Kbd>Enter</Kbd> enviar · <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> nueva línea · Claude solo puede leer tu vault.
          </p>
        )}
      </div>
    </section>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end animate-rise">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 text-[14.5px] whitespace-pre-wrap">{text}</div>
    </div>
  );
}

function Thinking({ pending, onCancel }: { pending: Pending; onCancel: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.round((Date.now() - pending.startedAt) / 1000);
  return (
    <div className="animate-rise rounded-2xl border border-line bg-surface p-4" role="status">
      <div className="flex items-center gap-2.5">
        <Loader2 className="size-4 text-accent animate-spin" />
        <span className="font-medium text-[13.5px]">Preparando la respuesta</span>
        <span className="text-faint text-[12px] tabular-nums">{secs} s</span>
        <Button size="sm" variant="ghost" icon={Square} className="ml-auto" onClick={onCancel}>Detener</Button>
      </div>
      <ol className="mt-3 space-y-1 border-l border-line ml-2 pl-4">
        {(pending.steps.length ? pending.steps : ['Iniciando Claude Code…']).map((s, i, all) => (
          <li key={`${i}-${s}`} className={`text-[12.5px] animate-rise ${i === all.length - 1 ? 'text-fg' : 'text-faint'}`}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

export function Answer({ m }: { m: ChatMessage }) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const byRef = new Map(m.sources.map((s) => [s.ref.toUpperCase(), s]));
  const verified = m.sources.filter((s) => s.verified).length;

  const chip = (ref: string) => {
    const s = byRef.get(ref.toUpperCase());
    return (
      <button
        onClick={() => {
          setHighlight(ref.toUpperCase());
          document.getElementById(`src-${m.id}-${ref.toUpperCase()}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }}
        title={s ? `${s.path} › ${s.heading}` : 'Fuente no declarada por Claude'}
        className={`inline-flex items-center align-[1px] mx-0.5 px-1.5 h-[18px] rounded-md text-[10.5px] font-semibold font-mono transition-colors ${
          !s ? 'bg-bad/10 text-bad' : s.verified ? 'bg-accent-soft text-accent hover:bg-accent/20' : 'bg-warn/15 text-warn'
        }`}
      >
        {ref}
      </button>
    );
  };

  const save = async () => {
    setSaveError(null);
    const r = await api.saveMessageAsNote(m.id);
    if (r.ok) setSaved(r.value);
    else setSaveError(r.error);
  };

  return (
    <article className="animate-rise min-w-0">
      <Markdown text={m.content} renderRef={chip} />
      {m.complementary.trim() && (
        <div className="mt-5 rounded-xl border border-dashed border-line bg-raised/40 px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-muted mb-1">
            <Lightbulb className="size-3.5" /> Conocimiento general de Claude · no está en tus notas
          </div>
          <Markdown text={m.complementary} className="!text-[13.5px] text-muted" />
        </div>
      )}
      {m.notInVault.length > 0 && (
        <div className="mt-3 flex items-start gap-2 text-[12.5px] text-muted">
          <SearchX className="size-3.5 mt-[3px] shrink-0" />
          <span><span className="font-medium">Tu vault no cubre:</span> {m.notInVault.join(' · ')}</span>
        </div>
      )}
      {m.sources.length > 0 ? (
        <div className="mt-5">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-muted mb-2">
            <BookMarked className="size-3.5" /> Fuentes del vault · {verified}/{m.sources.length} verificadas
          </div>
          <div className="grid grid-cols-1 gap-2">
            {m.sources.map((s, i) => (
              <SourceCard key={`${s.ref}-${i}`} s={s} id={`src-${m.id}-${s.ref.toUpperCase()}`} active={highlight === s.ref.toUpperCase()} />
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] text-warn flex items-center gap-1.5"><ShieldAlert className="size-3.5" /> Esta respuesta no cita ningún documento de tu vault.</p>
      )}
      <div className="mt-4 flex items-center gap-1.5 flex-wrap">
        <Button size="sm" variant="ghost" icon={copied ? Check : Copy} onClick={() => void navigator.clipboard.writeText(m.content).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}>
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
        {saved ? (
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => void api.revealPath(saved)}>Guardada · mostrar</Button>
        ) : (
          <Button size="sm" variant="ghost" icon={FileText} onClick={() => void save()}>Guardar como nota</Button>
        )}
        {saveError && <span className="text-bad text-[12px]">{saveError}</span>}
      </div>
    </article>
  );
}

export function SourceCard({ s, id, active }: { s: MessageSource; id?: string; active?: boolean }) {
  const { go } = useNav();
  return (
    <button
      id={id}
      onClick={() => go({ page: 'library', doc: s.path })}
      className={`group min-w-0 w-full text-left rounded-xl border px-3.5 py-2.5 transition-all ${active ? 'border-accent/60 bg-accent-soft/40' : 'border-line bg-surface hover:border-accent/40'}`}
    >
      <div className="flex items-center gap-2 text-[12px] min-w-0">
        <span className={`font-mono font-semibold shrink-0 ${s.verified ? 'text-accent' : 'text-warn'}`}>{s.ref}</span>
        <span className="truncate font-medium min-w-0">{s.path}</span>
        {s.heading && <span className="text-faint truncate min-w-0 hidden lg:inline">› {s.heading}</span>}
        <span className={`ml-auto inline-flex items-center gap-1 shrink-0 ${s.verified ? 'text-ok' : 'text-warn'}`} title={s.reason}>
          {s.verified ? <BadgeCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
          {s.verified ? 'Verificada' : 'Sin verificar'}
        </span>
      </div>
      <p className="mt-1 text-[12.5px] text-muted line-clamp-2">«{s.quote}»</p>
      {!s.verified && s.reason && <p className="mt-0.5 text-[11.5px] text-warn">{s.reason}</p>}
    </button>
  );
}
