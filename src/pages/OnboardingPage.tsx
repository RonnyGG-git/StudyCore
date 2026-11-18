import { CheckCircle2, FolderOpen, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { ClaudeStatus, Result, Settings } from '../../shared/types';
import { Logo } from '../components/Sidebar';
import { Button, ErrorBanner } from '../components/ui';
import { api } from '../lib/api';

export function OnboardingPage({ settings, claude, onSave }: { settings: Settings; claude: ClaudeStatus | null; onSave: (p: Partial<Settings>) => Promise<Result<Settings>> }) {
  const [vault, setVault] = useState('');
  const [output, setOutput] = useState(settings.outputDir);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = async (title: string, set: (v: string) => void) => {
    const dir = await api.chooseFolder(title);
    if (dir) set(dir);
  };

  const start = async () => {
    setSaving(true);
    setError(null);
    const r = await onSave({ vaultPath: vault, outputDir: output });
    setSaving(false);
    if (!r.ok) setError(r.error);
    else void api.reindex();
  };

  return (
    <div className="h-full overflow-y-auto grid place-items-center px-6 py-10 bg-[radial-gradient(ellipse_at_top,rgb(var(--accent)/0.08),transparent_60%)]">
      <div className="w-full max-w-[520px] animate-rise">
        <Logo size={44} />
        <h1 className="font-display text-[30px] font-semibold tracking-tight mt-5 leading-tight">Convierte tus notas en aprendizaje</h1>
        <p className="text-muted mt-2 text-[15px]">
          StudyCore lee tu vault de Obsidian y usa Claude Code como profesor. Tus notas originales nunca se modifican.
        </p>

        <div className="mt-8 space-y-4">
          <FolderField label="Vault de Obsidian" hint="La carpeta con tus notas. Solo se lee." value={vault} onPick={() => pick('Selecciona tu vault de Obsidian', setVault)} />
          <FolderField label="Carpeta de resultados" hint="Donde StudyCore guarda resúmenes, notas exportadas y copias. Fuera del vault." value={output} onPick={() => pick('Carpeta de resultados de StudyCore', setOutput)} />
        </div>

        <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
          {claude == null ? <Loader2 className="size-4 animate-spin text-muted" /> : claude.loggedIn ? <CheckCircle2 className="size-4 text-ok" /> : <XCircle className="size-4 text-bad" />}
          <span className="text-muted">
            {claude == null ? 'Comprobando Claude Code…' : `Claude Code ${claude.version ?? ''} — ${claude.detail}`}
          </span>
        </div>

        {error && <div className="mt-4"><ErrorBanner>{error}</ErrorBanner></div>}

        <Button variant="primary" className="w-full mt-6 h-11 text-[14.5px]" disabled={!vault || !output} loading={saving} onClick={start}>
          Empezar
        </Button>
        <p className="flex items-center gap-1.5 justify-center text-faint text-[12px] mt-4">
          <ShieldCheck className="size-3.5" /> Claude solo recibe permisos de lectura dentro del vault.
        </p>
      </div>
    </div>
  );
}

function FolderField({ label, hint, value, onPick }: { label: string; hint: string; value: string; onPick: () => void }) {
  return (
    <div>
      <div className="text-[13px] font-medium mb-1.5">{label}</div>
      <button onClick={onPick} className="w-full flex items-center gap-3 rounded-xl border border-line bg-surface hover:border-accent/50 px-4 py-3 text-left transition-colors">
        <FolderOpen className="size-4 text-accent shrink-0" />
        <span className={`truncate ${value ? '' : 'text-faint'}`}>{value || 'Elegir carpeta…'}</span>
      </button>
      <p className="text-faint text-[12px] mt-1.5">{hint}</p>
    </div>
  );
}
