import fs from 'node:fs';
import path from 'node:path';
import type { ClaudeStatus, DashboardData, IndexProgress, Result, Settings } from '../../shared/types';
import { ClaudeClient } from './claude/claude-client';
import { killAllLive } from './claude/process-runner';
import { Db } from './db/database';
import { ActivityLog } from './log/activity-log';
import { SettingsStore } from './settings';
import { AskService, type ClaudeRunner } from './tutor/ask-service';
import { QuizService } from './assess/quiz-service';
import { ClaudeGateway, type TaskContext } from './claude/gateway';
import { exportData } from './data/export';
import { GameService } from './game/game-service';
import { GlossaryService } from './learning/glossary-service';
import { LearningService } from './learning/learning-service';
import { CardsService } from './memory/cards-service';
import { PlannerService } from './planner/planner-service';
import { ChallengeService } from './practice/challenge-service';
import { isInside } from './vault/paths';
import { VaultService } from './vault/vault-service';

export interface AppCoreOptions {
  dataDir: string;
  defaultOutputDir: string;
  claude?: ClaudeRunner & { status(): Promise<ClaudeStatus> };
}

/**
 * Composición de los servicios del proceso principal. Independiente de Electron para poder
 * probarlo con Node y una CLI de Claude simulada.
 */
export class AppCore {
  readonly db: Db;
  readonly log: ActivityLog;
  readonly settings: SettingsStore;
  readonly vault: VaultService;
  readonly claude: ClaudeRunner & { status(): Promise<ClaudeStatus> };
  readonly ask: AskService;
  readonly gateway: ClaudeGateway;
  readonly game: GameService;
  readonly learning: LearningService;
  readonly quiz: QuizService;
  readonly glossary: GlossaryService;
  readonly cards: CardsService;
  readonly challenges: ChallengeService;
  readonly planner: PlannerService;
  private claudeStatus: ClaudeStatus | null = null;
  private indexing: Promise<Result<IndexProgress>> | null = null;
  private controllers = new Map<string, AbortController>();

  constructor(private opts: AppCoreOptions) {
    this.db = new Db(path.join(opts.dataDir, 'studycore.db'));
    this.log = new ActivityLog(this.db, path.join(opts.dataDir, 'logs', 'studycore.log'));
    this.settings = new SettingsStore(this.db, { vaultPath: '', outputDir: opts.defaultOutputDir, model: '', effort: '', theme: 'system' });
    this.vault = new VaultService(this.db, () => this.settings.get().vaultPath);
    this.claude = opts.claude ?? new ClaudeClient();
    this.ask = new AskService({
      db: this.db,
      vault: this.vault,
      claude: this.claude,
      log: this.log,
      settings: () => this.settings.get(),
      contextFor: (conv) => this.learning.conversationContext(conv),
    });
    this.gateway = new ClaudeGateway(this.db, this.claude, this.log, () => this.settings.get().vaultPath, () => this.settings.get());
    this.game = new GameService(this.db, this.log);
    this.learning = new LearningService({ db: this.db, vault: this.vault, gateway: this.gateway, game: this.game, log: this.log, ask: this.ask });
    this.quiz = new QuizService({ db: this.db, gateway: this.gateway, game: this.game, log: this.log, learning: this.learning });
    this.glossary = new GlossaryService(this.db, this.vault, this.gateway, this.log, this.learning);
    this.cards = new CardsService(this.db, this.gateway, this.game, this.log, this.learning);
    this.challenges = new ChallengeService(this.db, this.gateway, this.game, this.log, this.learning);
    this.planner = new PlannerService(this.db, this.gateway, this.game, this.learning, this.cards, this.quiz);
  }

  updateSettings(patch: Partial<Settings>): Result<Settings> {
    try {
      const before = this.settings.get();
      const next = this.settings.update(patch);
      if (before.vaultPath !== next.vaultPath) {
        // Otro vault: el índice anterior ya no sirve. Las conversaciones se conservan.
        this.db.tx(() => {
          this.db.run('DELETE FROM vault_fts');
          this.db.run('DELETE FROM vault_documents');
        });
        this.log.info('vault', `Vault configurado: ${next.vaultPath}`);
      }
      return { ok: true, value: next };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  }

  reindex(onProgress: (p: IndexProgress) => void): Promise<Result<IndexProgress>> {
    if (this.indexing) return this.indexing;
    this.indexing = (async (): Promise<Result<IndexProgress>> => {
      try {
        const started = Date.now();
        const p = await this.vault.reindex(onProgress);
        this.log.info('vault', `Índice actualizado: +${p.added} nuevos, ${p.updated} modificados, ${p.removed} eliminados (${((Date.now() - started) / 1000).toFixed(1)} s)`);
        return { ok: true, value: p };
      } catch (e) {
        const msg = errorText(e);
        this.log.error('vault', `Fallo al indexar: ${msg}`);
        onProgress({ phase: 'error', processed: 0, total: 0, message: msg });
        return { ok: false, error: msg };
      }
    })().finally(() => (this.indexing = null));
    return this.indexing;
  }

  async getClaudeStatus(refresh: boolean): Promise<ClaudeStatus> {
    if (!this.claudeStatus || refresh) {
      this.claudeStatus = await this.claude.status();
      if (!this.claudeStatus.loggedIn) this.log.warn('claude', this.claudeStatus.detail);
    }
    return this.claudeStatus;
  }

  async askQuestion(input: { conversationId: number | null; question: string; requestId: string }, onProgress: (t: string) => void) {
    const ctrl = new AbortController();
    this.controllers.set(input.requestId, ctrl);
    try {
      return await this.ask.ask(input, onProgress, ctrl.signal);
    } finally {
      this.controllers.delete(input.requestId);
    }
  }

  /** Ejecuta una tarea larga cancelable, informando del progreso con el mismo requestId. */
  async withRequest<T>(requestId: string, onProgress: (t: string) => void, fn: (ctx: TaskContext) => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    this.controllers.set(requestId, ctrl);
    try {
      return await fn({ signal: ctrl.signal, onProgress });
    } finally {
      this.controllers.delete(requestId);
    }
  }

  exportAll(): Result<string> {
    try {
      const file = exportData(this.db, this.game, this.settings.get().outputDir);
      this.log.info('datos', `Datos exportados: ${path.basename(file)}`);
      return { ok: true, value: file };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  }

  cancel(requestId: string) {
    this.controllers.get(requestId)?.abort();
  }

  dashboard(): DashboardData {
    const u = this.db.get<{ runs: number; failed: number; cost: number; avg: number }>(
      "SELECT COUNT(*) runs, SUM(status='error') failed, COALESCE(SUM(cost_usd),0) cost, COALESCE(AVG(CASE WHEN status='ok' THEN duration_ms END),0) avg FROM claude_runs",
    )!;
    return {
      vault: this.vault.stats(),
      claude: this.claudeStatus,
      conversations: this.ask.list(5),
      activity: this.log.recent(10),
      usage: { runs: u.runs, failed: u.failed ?? 0, costUsd: u.cost, avgSeconds: Math.round(u.avg / 1000) },
    };
  }

  /** Guarda una respuesta como nota Markdown en la carpeta de resultados (nunca en el vault). */
  saveMessageAsNote(messageId: number): Result<string> {
    const m = this.ask.message(messageId);
    if (!m || m.role !== 'assistant') return { ok: false, error: 'Mensaje no encontrado.' };
    const q = this.db.get<{ content: string; title: string }>(
      "SELECT u.content, c.title FROM messages a JOIN conversations c ON c.id = a.conversation_id JOIN messages u ON u.conversation_id = a.conversation_id AND u.role = 'user' AND u.id < a.id WHERE a.id = ? ORDER BY u.id DESC LIMIT 1",
      messageId,
    );
    const { outputDir, vaultPath } = this.settings.get();
    const dir = path.join(outputDir, 'Consultas');
    if (vaultPath && isInside(vaultPath, dir)) return { ok: false, error: 'La carpeta de resultados está dentro del vault.' };
    const day = new Date().toISOString().slice(0, 10);
    const base = `${day} ${safeFileName(q?.title ?? 'Consulta')}`;
    fs.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, `${base}.md`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).md`);

    const lines = [
      '---',
      'origen: StudyCore',
      `fecha: ${day}`,
      'tipo: consulta',
      '---',
      `# ${q?.title ?? 'Consulta'}`,
      '',
      `> **Pregunta:** ${q?.content ?? ''}`,
      '',
      m.content,
      '',
    ];
    if (m.complementary.trim()) lines.push('## Complemento (conocimiento general, no está en el vault)', '', m.complementary, '');
    if (m.notInVault.length) lines.push('## No cubierto por el vault', '', ...m.notInVault.map((x) => `- ${x}`), '');
    if (m.sources.length) {
      lines.push('## Fuentes', '');
      for (const s of m.sources) {
        const link = `[[${s.path.replace(/\.md$/i, '')}${s.heading ? `#${s.heading.split(' › ').pop()}` : ''}]]`;
        lines.push(`- **${s.ref}** ${link}${s.verified ? '' : ' — ⚠ cita no verificada'}`, `  > ${s.quote}`);
      }
    }
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    this.log.info('resultados', `Nota guardada: ${path.basename(file)}`);
    return { ok: true, value: file };
  }

  backup(): Result<string> {
    try {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const file = path.join(this.settings.get().outputDir, 'Copias de seguridad', `studycore-${stamp}.db`);
      this.db.backupTo(file);
      this.log.info('datos', `Copia de seguridad creada: ${path.basename(file)}`);
      return { ok: true, value: file };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  }

  private closed = false;

  shutdown() {
    if (this.closed) return;
    this.closed = true;
    for (const c of this.controllers.values()) c.abort();
    killAllLive();
    this.db.close();
  }
}

export function safeFileName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[. ]+$/, '') || 'nota';
}

export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'issues' in e) return 'Datos no válidos.';
  return e instanceof Error ? e.message : String(e);
}
