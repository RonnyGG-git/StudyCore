import { Check, CircleHelp, Lightbulb, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { QuestionType, QuestionView } from '../../shared/learning';
import { Markdown } from '../lib/markdown';
import { Button } from './ui';

export const TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: 'Selección múltiple',
  true_false: 'Verdadero o falso',
  short_answer: 'Respuesta corta',
  fill_blank: 'Completar espacios',
  matching: 'Relacionar conceptos',
  problem: 'Resolver problema',
  essay: 'Desarrollo',
  case_analysis: 'Análisis de caso',
  code: 'Programación',
};

type Mode = 'practice' | 'exam';

export interface QuestionCardProps {
  q: QuestionView;
  index?: number;
  mode: Mode;
  /** Práctica: corrige al momento. */
  onCheck?: (response: unknown) => Promise<void>;
  /** Examen/diagnóstico: guarda sin corregir. */
  onSave?: (response: unknown) => Promise<void>;
  busy?: boolean;
  locked?: boolean;
  allowUnknown?: boolean;
}

function initial(q: QuestionView): unknown {
  if (q.answer) return q.answer.response;
  if (q.type === 'fill_blank') return Array.from({ length: q.blanks ?? 1 }, () => '');
  if (q.type === 'matching') return (q.left ?? []).map(() => null);
  if (q.type === 'code') return q.starterCode ?? '';
  if (q.type === 'multiple_choice' || q.type === 'true_false') return undefined;
  return '';
}

function complete(q: QuestionView, r: unknown): boolean {
  if (r === null) return true;
  switch (q.type) {
    case 'multiple_choice': return typeof r === 'number';
    case 'true_false': return typeof r === 'boolean';
    case 'fill_blank': return Array.isArray(r) && r.every((x) => String(x).trim());
    case 'matching': return Array.isArray(r) && r.every((x) => x !== null);
    default: return typeof r === 'string' && r.trim().length > 0;
  }
}

/** Una pregunta de cualquiera de los 9 tipos, con su retroalimentación razonada cuando ya está corregida. */
export function QuestionCard({ q, index, mode, onCheck, onSave, busy, locked, allowUnknown }: QuestionCardProps) {
  const [resp, setResp] = useState<unknown>(() => initial(q));
  const graded = !!q.answer && q.answer.verdict !== 'pendiente';
  const readOnly = graded || locked || busy;
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => setResp(initial(q)), [q.id, graded]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (r: unknown, immediate = false) => {
    setResp(r);
    if (mode === 'exam' && onSave && complete(q, r)) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void onSave(r), immediate ? 0 : 600);
    }
  };
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const parts = q.type === 'fill_blank' ? q.prompt.split(/_{3,}/) : [];

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 animate-rise">
      <div className="flex items-center gap-2 text-[11.5px] text-faint mb-2">
        {index != null && <span className="font-semibold text-muted">Pregunta {index + 1}</span>}
        <span className="px-1.5 py-0.5 rounded bg-raised">{TYPE_LABEL[q.type]}</span>
        {q.concept && <span className="truncate">· {q.concept}</span>}
        <span className="ml-auto tracking-widest" title={`Dificultad ${q.difficulty}/5`} aria-label={`Dificultad ${q.difficulty} de 5`}>
          {'●'.repeat(q.difficulty)}<span className="opacity-30">{'●'.repeat(5 - q.difficulty)}</span>
        </span>
      </div>

      {q.type !== 'fill_blank' && <Markdown text={q.prompt} className="!text-[15px] font-medium" />}
      {q.scenario && (
        <div className="mt-3 rounded-xl bg-raised/60 px-4 py-3 text-[13.5px]">
          <div className="text-[11.5px] font-semibold text-muted mb-1">Situación</div>
          <Markdown text={q.scenario} />
        </div>
      )}

      <div className="mt-4">
        {q.type === 'multiple_choice' && (
          <div className="grid gap-2" role="radiogroup">
            {q.options!.map((o, i) => {
              const chosen = resp === i;
              return (
                <button
                  key={i}
                  role="radio"
                  aria-checked={chosen}
                  disabled={readOnly}
                  onClick={() => update(i, true)}
                  className={`flex items-start gap-3 text-left rounded-xl border px-3.5 py-2.5 text-[14px] transition-colors ${
                    chosen ? 'border-accent bg-accent-soft/50' : 'border-line hover:border-accent/40'
                  } disabled:cursor-default`}
                >
                  <span className={`mt-0.5 size-5 shrink-0 rounded-full border grid place-items-center text-[11px] font-semibold ${chosen ? 'border-accent bg-accent text-accent-fg' : 'border-line text-muted'}`}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span>{o}</span>
                </button>
              );
            })}
          </div>
        )}

        {q.type === 'true_false' && (
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <Button key={String(v)} variant={resp === v ? 'primary' : 'secondary'} disabled={readOnly} onClick={() => update(v, true)} className="flex-1 h-11">
                {v ? 'Verdadero' : 'Falso'}
              </Button>
            ))}
          </div>
        )}

        {q.type === 'fill_blank' && (
          <p className="text-[15px] leading-[2.4]">
            {parts.map((p, i) => (
              <span key={i}>
                {p}
                {i < parts.length - 1 && (
                  <input
                    aria-label={`Hueco ${i + 1}`}
                    disabled={readOnly}
                    value={(resp as string[])?.[i] ?? ''}
                    onChange={(e) => {
                      const next = [...((resp as string[]) ?? [])];
                      next[i] = e.target.value;
                      update(next);
                    }}
                    className="mx-1 w-36 border-b-2 border-accent/50 focus:border-accent bg-transparent outline-none text-center px-1"
                  />
                )}
              </span>
            ))}
          </p>
        )}

        {q.type === 'matching' && (
          <div className="grid gap-2">
            {q.left!.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div className="rounded-lg bg-raised/70 px-3 py-2 text-[13.5px]">{l}</div>
                <span className="text-faint">→</span>
                <select
                  aria-label={`Pareja de ${l}`}
                  disabled={readOnly}
                  value={(resp as (number | null)[])?.[i] ?? ''}
                  onChange={(e) => {
                    const next = [...((resp as (number | null)[]) ?? [])];
                    next[i] = e.target.value === '' ? null : Number(e.target.value);
                    update(next, true);
                  }}
                  className="h-9 rounded-lg border border-line bg-surface px-2 text-[13.5px]"
                >
                  <option value="">Elige…</option>
                  {q.right!.map((r, j) => <option key={j} value={j}>{r}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        {['short_answer', 'problem', 'essay', 'case_analysis', 'code'].includes(q.type) && (
          <textarea
            aria-label="Tu respuesta"
            disabled={readOnly}
            value={(resp as string) ?? ''}
            onChange={(e) => update(e.target.value)}
            rows={q.type === 'essay' || q.type === 'code' ? 9 : q.type === 'short_answer' ? 3 : 6}
            spellCheck={q.type !== 'code'}
            placeholder={q.type === 'code' ? `Escribe tu código${q.language ? ` (${q.language})` : ''}…` : 'Escribe tu respuesta con tus palabras…'}
            className={`w-full rounded-xl border border-line bg-bg/40 px-3.5 py-3 outline-none focus:border-accent/60 resize-y ${q.type === 'code' ? 'font-mono text-[13px]' : 'text-[14px]'}`}
          />
        )}
      </div>

      {!graded && !locked && (
        <div className="mt-4 flex items-center gap-2">
          {mode === 'practice' && onCheck && (
            <Button variant="primary" disabled={!complete(q, resp) || resp === null} loading={busy} onClick={() => void onCheck(resp)}>Comprobar</Button>
          )}
          {allowUnknown && (
            <Button variant="ghost" icon={CircleHelp} disabled={busy} onClick={() => (mode === 'practice' && onCheck ? void onCheck(null) : update(null, true))}>
              No lo sé
            </Button>
          )}
          {mode === 'exam' && resp === null && <span className="text-[12.5px] text-muted">Marcada como «No lo sé»</span>}
          {mode === 'exam' && resp !== null && q.answer && <span className="text-[12px] text-faint">Respuesta guardada</span>}
        </div>
      )}

      {graded && <FeedbackView q={q} />}
    </div>
  );
}

function FeedbackView({ q }: { q: QuestionView }) {
  const a = q.answer!;
  const tone = a.verdict === 'correcta' ? 'ok' : a.verdict === 'parcial' ? 'warn' : 'bad';
  const Icon = a.verdict === 'correcta' ? Check : a.verdict === 'parcial' ? Lightbulb : X;
  const f = a.feedback;
  return (
    <div className={`mt-4 rounded-xl border px-4 py-3 animate-rise ${tone === 'ok' ? 'border-ok/30 bg-ok/[0.06]' : tone === 'warn' ? 'border-warn/30 bg-warn/[0.07]' : 'border-bad/25 bg-bad/[0.05]'}`}>
      <div className={`flex items-center gap-2 font-semibold text-[13.5px] ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-bad'}`}>
        <Icon className="size-4" />
        {a.verdict === 'correcta' ? 'Correcta' : a.verdict === 'parcial' ? 'Parcialmente correcta' : 'Incorrecta'}
        <span className="ml-auto text-[12px] font-medium tabular-nums">{Math.round(a.score * 100)}%</span>
      </div>
      {f && (
        <div className="mt-2 space-y-2 text-[13.5px]">
          {f.analysis && <Markdown text={f.analysis} className="!text-[13.5px]" />}
          {f.reasoningErrors.length > 0 && (
            <div>
              <div className="text-[12px] font-semibold text-muted">Errores de razonamiento</div>
              <ul className="list-disc pl-5 mt-0.5 space-y-0.5">{f.reasoningErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {a.verdict !== 'correcta' && f.correctAnswer && (
            <div>
              <div className="text-[12px] font-semibold text-muted">Respuesta correcta</div>
              <Markdown text={f.correctAnswer} className="!text-[13.5px]" />
            </div>
          )}
          {f.reviewSuggestion && <p className="text-[12.5px] text-muted">📌 {f.reviewSuggestion}</p>}
        </div>
      )}
    </div>
  );
}
