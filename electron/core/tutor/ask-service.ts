import type { AskResult, ChatMessage, Conversation, ConversationSummary, MessageSource } from '../../../shared/types';
import type { ClaudeClient, ClaudeRequest, ClaudeResult } from '../claude/claude-client';
import type { Db } from '../db/database';
import type { ActivityLog } from '../log/activity-log';
import type { VaultService } from '../vault/vault-service';
import { verifySources } from './citations';
import { ASK_SYSTEM_PROMPT, AskOutputSchema, buildAskPrompt, toCliSchema, type AskOutput } from './prompts';

export interface ClaudeRunner {
  run(req: ClaudeRequest): Promise<ClaudeResult>;
}

export interface AskDeps {
  db: Db;
  vault: VaultService;
  claude: ClaudeRunner | ClaudeClient;
  log: ActivityLog;
  settings: () => { model: string; effort: string };
  /** Contexto pedagógico para conversaciones de tutor o de lección (ruta, nivel, debilidades…). */
  contextFor?: (conv: ConversationRow) => ConversationContext | null;
}

export interface ConversationRow {
  id: number;
  kind: string;
  session_id: string | null;
  topic_id: number | null;
  lesson_id: number | null;
}

export interface ConversationContext {
  system: string;
  context: string;
  scope: string[];
  retrievalHint: string;
}

const ASK_SCHEMA = toCliSchema(AskOutputSchema);

/** Registra cada ejecución de Claude (estado, coste, duración) para estadísticas y diagnóstico. */
export function recordRun(db: Db, kind: string, promptChars: number, r: ClaudeResult): number {
  return db.run(
    `INSERT INTO claude_runs (kind, session_id, model, status, error_kind, error_message, duration_ms, cost_usd, prompt_chars, finished_at)
     VALUES (?,?,?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    kind, r.sessionId, r.model, r.ok ? 'ok' : 'error', r.errorKind, r.errorMessage, r.durationMs, r.costUsd, promptChars,
  ).lastId;
}

export class AskService {
  constructor(private d: AskDeps) {}

  async ask(input: { conversationId: number | null; question: string }, onProgress: (t: string) => void, signal?: AbortSignal): Promise<AskResult> {
    const { db, vault, log } = this.d;
    const question = input.question.trim();
    if (!question) return { ok: false, conversationId: input.conversationId, errorKind: 'execution', error: 'Escribe una pregunta.' };
    if (!vault.root) return { ok: false, conversationId: input.conversationId, errorKind: 'execution', error: 'Configura primero la carpeta del vault en Ajustes.' };

    let conv = input.conversationId ? db.get<ConversationRow>('SELECT id, kind, session_id, topic_id, lesson_id FROM conversations WHERE id = ?', input.conversationId) : undefined;
    const isNew = !conv;
    if (!conv) {
      const id = db.run("INSERT INTO conversations (kind, title) VALUES ('ask', ?)", question.length > 80 ? `${question.slice(0, 79)}…` : question).lastId;
      conv = { id, kind: 'ask', session_id: null, topic_id: null, lesson_id: null };
    }
    const cctx = conv.kind !== 'ask' ? this.d.contextFor?.(conv) ?? null : null;
    const wrap = (p: string) => (cctx ? `CONTEXTO DEL ESTUDIANTE (lo mantiene StudyCore, está actualizado):
${cctx.context}

${p}` : p);
    const userMsgId = db.run("INSERT INTO messages (conversation_id, role, content) VALUES (?, 'user', ?)", conv.id, question).lastId;

    // La recuperación usa también la pregunta anterior para que los seguimientos ("¿y en SQL Server?") encuentren contexto.
    const prev = db.get<{ content: string }>("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' AND id < ? ORDER BY id DESC LIMIT 1", conv.id, userMsgId);
    onProgress('Buscando en tu vault…');
    const provided = vault.retrieve(`${question} ${prev?.content ?? ''} ${cctx?.retrievalHint ?? ''}`.trim(), 8, 3, cctx?.scope ?? []);
    onProgress(provided.length ? `${provided.length} fragmentos relevantes encontrados` : 'El índice no encontró coincidencias; Claude buscará por su cuenta');

    const settings = this.d.settings();
    const base: ClaudeRequest = {
      prompt: wrap(buildAskPrompt(question, provided)),
      systemPrompt: cctx?.system ?? ASK_SYSTEM_PROMPT,
      cwd: vault.root,
      jsonSchema: ASK_SCHEMA,
      model: settings.model || undefined,
      effort: settings.effort || undefined,
      resumeSessionId: conv.session_id,
      signal,
      onProgress,
    };

    let r = await this.d.claude.run(base);
    let runId = recordRun(db, conv.kind, base.prompt.length, r);

    // Sesión perdida (borrada o de otra máquina): se reconstruye el contexto desde la BD.
    if (!r.ok && r.errorKind === 'session') {
      log.warn('claude', 'La sesión de la conversación ya no existe; se reconstruye el contexto.', { conversationId: conv.id });
      onProgress('Reconstruyendo el contexto de la conversación…');
      const retry = { ...base, resumeSessionId: null, prompt: wrap(buildAskPrompt(question, provided, this.transcript(conv.id, userMsgId))) };
      r = await this.d.claude.run(retry);
      runId = recordRun(db, conv.kind, retry.prompt.length, r);
    }
    // Respuesta incompleta o mal formada: un único reintento en la misma sesión.
    let parsed = r.ok ? AskOutputSchema.safeParse(r.structured) : null;
    if ((r.ok && !parsed?.success) || (!r.ok && r.errorKind === 'invalid_output')) {
      log.warn('claude', 'Respuesta estructurada inválida; se reintenta una vez.');
      onProgress('La respuesta llegó incompleta; reintentando…');
      const retry = { ...base, resumeSessionId: r.sessionId, prompt: 'Tu respuesta anterior no cumplió el formato. Entrega de nuevo la respuesta completa con la herramienta StructuredOutput.' };
      r = await this.d.claude.run(retry);
      runId = recordRun(db, conv.kind, retry.prompt.length, r);
      parsed = r.ok ? AskOutputSchema.safeParse(r.structured) : null;
    }

    if (!r.ok || !parsed?.success) {
      db.run('DELETE FROM messages WHERE id = ?', userMsgId);
      if (isNew) db.run('DELETE FROM conversations WHERE id = ?', conv.id);
      const kind = r.ok ? 'invalid_output' : r.errorKind!;
      const error = r.ok ? 'Claude respondió en un formato inesperado. Inténtalo de nuevo.' : r.errorMessage!;
      if (kind !== 'cancelled') log.error('claude', `Consulta fallida: ${error}`, { kind });
      return { ok: false, conversationId: isNew ? null : conv.id, errorKind: kind, error };
    }

    const out: AskOutput = parsed.data;
    const sources = verifySources(out.sources, provided, vault);
    const msgId = db.tx(() => {
      const id = db.run(
        "INSERT INTO messages (conversation_id, role, content, complementary, not_in_vault, run_id) VALUES (?, 'assistant', ?, ?, ?, ?)",
        conv!.id, out.answer_markdown, out.complementary_markdown, JSON.stringify(out.not_in_vault), runId,
      ).lastId;
      for (const s of sources) {
        db.run('INSERT INTO message_sources (message_id, ref, section_id, path, heading, quote, verified, reason) VALUES (?,?,?,?,?,?,?,?)', id, s.ref, s.sectionId, s.path, s.heading, s.quote, s.verified ? 1 : 0, s.reason ?? null);
      }
      db.run("UPDATE conversations SET session_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", r.sessionId, conv!.id);
      return id;
    });
    const unverified = sources.filter((s) => !s.verified).length;
    log.info('consulta', `Respuesta con ${sources.length} fuente(s)${unverified ? `, ${unverified} sin verificar` : ''}`, { conversationId: conv.id });
    return { ok: true, conversationId: conv.id, message: this.message(msgId)! };
  }

  private transcript(conversationId: number, beforeId: number): string {
    return buildTranscript(this.d.db, conversationId, beforeId);
  }

  message(id: number): ChatMessage | null {
    const m = this.d.db.get<{ id: number; role: 'user' | 'assistant'; content: string; complementary: string; not_in_vault: string; created_at: string }>(
      'SELECT id, role, content, complementary, not_in_vault, created_at FROM messages WHERE id = ?', id,
    );
    if (!m) return null;
    const sources = this.d.db
      .all<{ ref: string; path: string; heading: string; quote: string; verified: number; reason: string | null }>('SELECT ref, path, heading, quote, verified, reason FROM message_sources WHERE message_id = ? ORDER BY id', id)
      .map<MessageSource>((s) => ({ ref: s.ref, path: s.path, heading: s.heading, quote: s.quote, verified: !!s.verified, reason: s.reason ?? undefined }));
    return { id: m.id, role: m.role, content: m.content, complementary: m.complementary, notInVault: JSON.parse(m.not_in_vault), sources, createdAt: m.created_at };
  }

  list(limit = 50, kind = 'ask'): ConversationSummary[] {
    return this.d.db.all<ConversationSummary>(
      `SELECT c.id, c.title, c.updated_at AS updatedAt, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messages
         FROM conversations c WHERE c.kind = ? ORDER BY c.updated_at DESC LIMIT ?`, kind, limit,
    );
  }

  createConversation(kind: 'tutor' | 'lesson', title: string, topicId: number, lessonId: number | null): number {
    return this.d.db.run('INSERT INTO conversations (kind, title, topic_id, lesson_id) VALUES (?,?,?,?)', kind, title.slice(0, 120), topicId, lessonId).lastId;
  }

  get(id: number): Conversation | null {
    const c = this.d.db.get<ConversationSummary>(
      'SELECT c.id, c.title, c.updated_at AS updatedAt, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messages FROM conversations c WHERE c.id = ?', id,
    );
    if (!c) return null;
    const ids = this.d.db.all<{ id: number }>('SELECT id FROM messages WHERE conversation_id = ? ORDER BY id', id);
    return { ...c, messages_: ids.map((r) => this.message(r.id)!) };
  }

  rename(id: number, title: string) {
    const t = title.trim().slice(0, 120);
    if (t) this.d.db.run('UPDATE conversations SET title = ? WHERE id = ?', t, id);
  }
}

function buildTranscript(db: Db, conversationId: number, beforeId: number): string {
  return db
    .all<{ role: string; content: string }>('SELECT role, content FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 6', conversationId, beforeId)
    .reverse()
    .map((m) => `${m.role === 'user' ? 'Estudiante' : 'Profesor'}: ${m.content.slice(0, 1200)}`)
    .join('\n');
}
