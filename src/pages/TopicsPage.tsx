import { ChevronRight, Folder, GraduationCap, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TopicSummary } from '../../shared/learning';
import type { TreeNode } from '../../shared/types';
import { ProgressBar } from '../components/charts';
import { TaskError, TaskProgress } from '../components/TaskProgress';
import { Button, Card, EmptyState, PageHeader, Skeleton } from '../components/ui';
import { useTask } from '../hooks/useTask';
import { api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { useNav } from '../lib/nav';
import { rpc } from '../lib/rpc';

export const LEVEL_LABEL = { principiante: 'Principiante', intermedio: 'Intermedio', avanzado: 'Avanzado' } as const;
export const STATUS_LABEL = { diagnosing: 'Diagnóstico pendiente', active: 'En curso', mastered: 'Dominado' } as const;

export function TopicsPage({ create }: { create?: boolean }) {
  const { go } = useNav();
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const [creating, setCreating] = useState(!!create);
  useEffect(() => void rpc.topicsList().then(setTopics), []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1000px] mx-auto px-8 py-9">
        <PageHeader
          title="Aprender"
          subtitle="Cada tema empieza con un diagnóstico y se convierte en una ruta adaptada a ti."
          actions={!creating && <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Nuevo tema</Button>}
        />
        {creating && <NewTopic onCancel={() => setCreating(false)} onCreated={(assessmentId) => go({ page: 'assessment', id: assessmentId })} />}
        {!topics ? (
          <div className="grid sm:grid-cols-2 gap-4 mt-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}</div>
        ) : topics.length === 0 ? (
          !creating && (
            <Card className="mt-2">
              <EmptyState icon={GraduationCap} title="Aún no estudias ningún tema" action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>Crear mi primer tema</Button>}>
                Escribe un tema (SQL, redes, POO…) y elige las carpetas del vault donde están tus apuntes.
              </EmptyState>
            </Card>
          )
        ) : (
          <div className="grid sm:grid-cols-2 gap-4 mt-2">
            {topics.map((t, i) => (
              <button key={t.id} onClick={() => go({ page: 'topic', id: t.id })} style={{ animationDelay: `${i * 40}ms` }} className="animate-rise text-left rounded-2xl border border-line bg-surface p-5 hover:border-accent/50 hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span className={`px-2 py-0.5 rounded-full ${t.status === 'mastered' ? 'bg-ok/10 text-ok' : t.status === 'diagnosing' ? 'bg-warn/15 text-warn' : 'bg-accent-soft text-accent'}`}>{STATUS_LABEL[t.status]}</span>
                  {t.level && <span className="text-faint">{LEVEL_LABEL[t.level]}</span>}
                  <span className="ml-auto text-faint">{relativeTime(t.updatedAt)}</span>
                </div>
                <h3 className="font-display font-semibold text-[18px] mt-2.5 leading-snug">{t.title}</h3>
                <p className="text-muted text-[13px] mt-1 line-clamp-2 min-h-[2.6em]">{t.objective || 'Completa el diagnóstico para generar tu ruta.'}</p>
                <ProgressBar value={t.progress} className="mt-4" tone={t.status === 'mastered' ? 'ok' : 'accent'} />
                <div className="flex justify-between text-[11.5px] text-faint mt-2">
                  <span>{t.completedLessons}/{t.lessonCount} lecciones · {t.completedModules}/{t.moduleCount} módulos</span>
                  <span>{t.masteredConcepts}/{t.concepts} conceptos dominados</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NewTopic({ onCancel, onCreated }: { onCancel: () => void; onCreated: (assessmentId: number) => void }) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [scope, setScope] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeNode | null>(null);
  const task = useTask();
  useEffect(() => void api.vaultTree().then(setTree), []);

  const submit = async () => {
    const r = await task.run((rid) => rpc.topicCreate({ title, goal, scope }, rid));
    if (r) onCreated(r.assessmentId);
  };
  const toggle = (p: string) => setScope((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s.filter((x) => !x.startsWith(`${p}/`)), p]));

  return (
    <Card className="mb-6 animate-rise">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-5">
          <Sparkles className="size-4 text-accent" />
          <h2 className="font-display font-semibold text-[17px]">Nuevo tema de estudio</h2>
          <button onClick={onCancel} className="ml-auto text-faint hover:text-fg" aria-label="Cerrar"><X className="size-4" /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <label className="block">
              <span className="text-[13px] font-medium">¿Qué quieres aprender?</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej.: Subneteo VLSM, SQL, Programación orientada a objetos" disabled={task.running} className="mt-1.5 w-full h-10 rounded-lg border border-line bg-bg/40 px-3 outline-none focus:border-accent/60" />
            </label>
            <label className="block">
              <span className="text-[13px] font-medium">Tu objetivo <span className="text-faint font-normal">(opcional)</span></span>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={3} placeholder="Ej.: aprobar el parcial, diseñar redes reales, entrevistas técnicas…" disabled={task.running} className="mt-1.5 w-full rounded-lg border border-line bg-bg/40 px-3 py-2 outline-none focus:border-accent/60 resize-none" />
            </label>
            <p className="text-faint text-[12px]">Claude analizará tus documentos y te hará un diagnóstico de unas 8 preguntas. Con tus respuestas diseñará la ruta.</p>
          </div>
          <div>
            <div className="text-[13px] font-medium">Documentos a usar</div>
            <p className="text-faint text-[12px] mb-2">{scope.length ? `${scope.length} carpeta(s) seleccionada(s)` : 'Todo el vault (o elige carpetas para centrarte)'}</p>
            <div className="h-[220px] overflow-y-auto rounded-xl border border-line p-1.5">
              {tree?.children?.filter((c) => c.type === 'dir').map((c) => <ScopeNode key={c.path} node={c} scope={scope} onToggle={toggle} depth={0} />)}
            </div>
          </div>
        </div>
        <div className="mt-5 space-y-3">
          <TaskProgress task={task} title="Preparando tu diagnóstico" onCancel={task.cancel} />
          <TaskError task={task} onRetry={submit} onDismiss={task.clearError} />
        </div>
        {!task.running && (
          <div className="flex justify-end gap-2 mt-5">
            <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
            <Button variant="primary" disabled={title.trim().length < 2} onClick={submit}>Analizar y empezar el diagnóstico</Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function ScopeNode({ node, scope, onToggle, depth }: { node: TreeNode; scope: string[]; onToggle: (p: string) => void; depth: number }) {
  const [open, setOpen] = useState(false);
  const dirs = node.children?.filter((c) => c.type === 'dir') ?? [];
  const checked = scope.includes(node.path) || scope.some((s) => node.path.startsWith(`${s}/`));
  return (
    <div>
      <div className="flex items-center gap-1 h-7 rounded-md hover:bg-raised/60 pr-2" style={{ paddingLeft: 4 + depth * 14 }}>
        <button onClick={() => setOpen(!open)} className={`size-5 grid place-items-center text-faint ${dirs.length ? '' : 'invisible'}`} aria-label={open ? 'Contraer' : 'Expandir'}>
          <ChevronRight className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer text-[13px]">
          <input type="checkbox" checked={checked} onChange={() => onToggle(node.path)} className="accent-[rgb(var(--accent))]" />
          <Folder className="size-3.5 text-accent/80 shrink-0" />
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-faint text-[11px]">{node.documents}</span>
        </label>
      </div>
      {open && dirs.map((c) => <ScopeNode key={c.path} node={c} scope={scope} onToggle={onToggle} depth={depth + 1} />)}
    </div>
  );
}
