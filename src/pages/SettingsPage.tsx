import { CheckCircle2, DatabaseBackup, FolderOpen, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ClaudeStatus, Result, Settings } from '../../shared/types';
import { Button, Card, ErrorBanner, PageHeader } from '../components/ui';
import { describeProgress, useIndexer } from '../hooks/useIndexer';
import { api } from '../lib/api';

const MODELS: { value: Settings['model']; label: string; hint: string }[] = [
  { value: '', label: 'Predeterminado', hint: 'El modelo configurado en Claude Code' },
  { value: 'sonnet', label: 'Sonnet', hint: 'Equilibrio entre calidad y rapidez' },
  { value: 'opus', label: 'Opus', hint: 'Máxima calidad, más lento y más uso' },
  { value: 'haiku', label: 'Haiku', hint: 'El más rápido' },
];
const EFFORTS: { value: Settings['effort']; label: string }[] = [
  { value: '', label: 'Predeterminado' },
  { value: 'low', label: 'Bajo' },
  { value: 'medium', label: 'Medio' },
  { value: 'high', label: 'Alto' },
];

export function SettingsPage({ settings, claude, onSave, onRefreshClaude }: { settings: Settings; claude: ClaudeStatus | null; onSave: (p: Partial<Settings>) => Promise<Result<Settings>>; onRefreshClaude: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<Result<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const indexer = useIndexer();

  const save = async (patch: Partial<Settings>) => {
    setError(null);
    const r = await onSave(patch);
    if (!r.ok) setError(r.error);
    return r;
  };
  const pick = async (key: 'vaultPath' | 'outputDir', title: string) => {
    const dir = await api.chooseFolder(title);
    if (!dir) return;
    const r = await save({ [key]: dir });
    if (r.ok && key === 'vaultPath') void indexer.run();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-8 py-9">
        <PageHeader title="Ajustes" subtitle="Dónde vive tu conocimiento y cómo trabaja el motor." />
        {error && <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div>}

        <Card title="Carpetas" className="mb-4">
          <div className="p-5 pt-2 divide-y divide-line">
            <Row label="Vault de Obsidian" hint="Solo lectura. Cambiarlo reconstruye el índice.">
              <PathButton value={settings.vaultPath} onClick={() => void pick('vaultPath', 'Selecciona tu vault de Obsidian')} />
            </Row>
            <Row label="Índice" hint={indexer.running || indexer.progress ? describeProgress(indexer.progress) : 'Se actualiza de forma incremental.'}>
              <Button size="sm" icon={RefreshCw} loading={indexer.running} onClick={() => void indexer.run()}>Reindexar</Button>
            </Row>
            <Row label="Carpeta de resultados" hint="Notas exportadas y copias de seguridad. Nunca dentro del vault.">
              <div className="flex items-center gap-1.5">
                <PathButton value={settings.outputDir} onClick={() => void pick('outputDir', 'Carpeta de resultados de StudyCore')} />
                <Button size="sm" variant="ghost" onClick={() => void api.revealPath(settings.outputDir)}>Abrir</Button>
              </div>
            </Row>
          </div>
        </Card>

        <Card title="Motor de IA · Claude Code" className="mb-4" action={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void onRefreshClaude()}>Comprobar</Button>}>
          <div className="p-5 pt-2 divide-y divide-line">
            <Row label="Estado" hint={claude?.executable ?? undefined}>
              <span className="inline-flex items-center gap-1.5 text-[13px]">
                {claude == null ? <Loader2 className="size-4 animate-spin text-muted" /> : claude.loggedIn ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-bad" />}
                {claude ? `${claude.version ?? 'sin versión'} · ${claude.detail}` : 'Comprobando…'}
              </span>
            </Row>
            <Row label="Modelo" hint={MODELS.find((m) => m.value === settings.model)?.hint}>
              <Segmented options={MODELS} value={settings.model} onChange={(model) => void save({ model })} />
            </Row>
            <Row label="Esfuerzo de razonamiento" hint="Más esfuerzo: explicaciones más cuidadas, respuestas más lentas.">
              <Segmented options={EFFORTS} value={settings.effort} onChange={(effort) => void save({ effort })} />
            </Row>
            <Row label="Permisos" hint="Fijados por StudyCore, no configurables.">
              <span className="text-[12.5px] text-muted text-right">Solo Read, Glob y Grep · dentro del vault · sin comandos ni MCP</span>
            </Row>
          </div>
        </Card>

        <Card title="Datos">
          <div className="p-5 pt-2">
            <Row label="Copia de seguridad" hint="Copia completa de tu progreso, consultas e índice.">
              <Button
                size="sm"
                icon={DatabaseBackup}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  setBackup(await api.backup());
                  setBusy(false);
                }}
              >
                Crear copia
              </Button>
            </Row>
            {backup && (
              <p className={`text-[12.5px] mt-1 ${backup.ok ? 'text-ok' : 'text-bad'}`}>
                {backup.ok ? <button className="hover:underline text-left" onClick={() => void api.revealPath(backup.value)}>Copia creada: {backup.value}</button> : backup.error}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        {hint && <div className="text-faint text-[12px] mt-0.5 truncate">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function PathButton({ value, onClick }: { value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={value} className="inline-flex items-center gap-2 max-w-[300px] h-8 px-3 rounded-lg border border-line bg-surface hover:border-accent/50 text-[12.5px] transition-colors">
      <FolderOpen className="size-3.5 text-accent shrink-0" />
      <span className="truncate">{value || 'Elegir…'}</span>
    </button>
  );
}

function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-raised p-0.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`h-7 px-2.5 rounded-md text-[12.5px] transition-all ${o.value === value ? 'bg-surface shadow-sm font-medium text-fg' : 'text-muted hover:text-fg'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
