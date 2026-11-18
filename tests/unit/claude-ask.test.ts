import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppCore } from '../../electron/core/app-core';
import { ClaudeClient } from '../../electron/core/claude/claude-client';
import { SAMPLE_VAULT, tempDir, writeFiles } from './helpers';

const FAKE = path.resolve(__dirname, '../fixtures/fake-claude.cjs');
const fakeClient = () => new ClaudeClient({ executable: process.execPath, prefixArgs: [FAKE] });

describe('ClaudeClient', () => {
  afterEach(() => {
    delete process.env.FAKE_MODE;
  });

  it('usa solo herramientas de lectura, modo dontAsk, sin MCP ni personalizaciones', () => {
    const args = new ClaudeClient({ executable: 'x' }).buildArgs({ prompt: 'p', systemPrompt: 's', cwd: '.', jsonSchema: { type: 'object' }, model: 'sonnet' }, 'uuid-1');
    const val = (flag: string) => args[args.indexOf(flag) + 1];
    expect(val('--tools')).toBe('Read,Glob,Grep');
    expect(val('--permission-mode')).toBe('dontAsk');
    expect(args).toContain('--safe-mode');
    expect(args).toContain('--strict-mcp-config');
    expect(val('--session-id')).toBe('uuid-1');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args.join(' ')).not.toMatch(/Bash|Write|Edit/);
  });

  it('detecta versión y sesión', async () => {
    const s = await fakeClient().status();
    expect(s).toMatchObject({ version: '9.9.9 (Claude Code)', loggedIn: true });
  });

  it('clasifica errores: ejecución, límite de uso, salida incompleta, tiempo y cancelación', async () => {
    const run = (mode: string, extra: object = {}) => {
      process.env.FAKE_MODE = mode;
      return fakeClient().run({ prompt: 'p', systemPrompt: 's', cwd: process.cwd(), jsonSchema: {}, ...extra });
    };
    expect((await run('error')).errorKind).toBe('execution');
    expect((await run('rate')).errorKind).toBe('rate_limit');
    expect((await run('invalid')).errorKind).toBe('invalid_output');
    expect((await run('slow', { timeoutMs: 1500 })).errorKind).toBe('timeout');
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 800);
    expect((await run('slow', { signal: ctrl.signal })).errorKind).toBe('cancelled');
  });
});

describe('AppCore · consultar al vault', () => {
  let core: AppCore;
  let root: string;
  let out: string;

  beforeEach(async () => {
    root = tempDir('vault-');
    out = tempDir('out-');
    writeFiles(root, SAMPLE_VAULT);
    core = new AppCore({ dataDir: tempDir('data-'), defaultOutputDir: out, claude: fakeClient() });
    expect(core.updateSettings({ vaultPath: root }).ok).toBe(true);
    await core.reindex(() => {});
  });
  afterEach(() => {
    core.shutdown();
    delete process.env.FAKE_MODE;
    delete process.env.FAKE_ARGS_FILE;
  });

  it('responde con fuentes verificadas, separa lo complementario y guarda todo', async () => {
    const argsFile = path.join(out, 'args.json');
    process.env.FAKE_ARGS_FILE = argsFile;
    const progress: string[] = [];
    const r = await core.askQuestion({ conversationId: null, question: '¿Qué es un inner join?', requestId: 'r1' }, (t) => progress.push(t));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message.sources[0]).toMatchObject({ ref: 'S1', path: 'notas/sql.md', verified: true });
    expect(r.message.complementary).toContain('LATERAL');
    expect(r.message.notInVault).toEqual(['FULL OUTER JOIN']);
    expect(progress.some((p) => p.startsWith('Leyendo notas/sql.md'))).toBe(true);
    const sent = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    expect(sent.input).toContain('[S1] documento: notas/sql.md | apartado: SQL › Joins');
    const conv = core.ask.get(r.conversationId)!;
    expect(conv.messages_.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(core.dashboard().usage.runs).toBe(1);
  });

  it('reanuda la sesión en seguimientos y la reconstruye si se perdió', async () => {
    const first = await core.askQuestion({ conversationId: null, question: 'inner join', requestId: 'a' }, () => {});
    if (!first.ok) throw new Error(first.error);
    process.env.FAKE_MODE = 'session';
    const argsFile = path.join(out, 'args2.json');
    process.env.FAKE_ARGS_FILE = argsFile;
    const second = await core.askQuestion({ conversationId: first.conversationId, question: '¿y el left join?', requestId: 'b' }, () => {});
    expect(second.ok).toBe(true);
    const sent = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
    expect(sent.args).toContain('--session-id');
    expect(sent.input).toContain('CONVERSACIÓN PREVIA');
    expect(core.ask.get(first.conversationId)!.messages).toBe(4);
  });

  it('reintenta una vez si la respuesta llega incompleta', async () => {
    process.env.FAKE_MODE = 'invalid-once';
    const r = await core.askQuestion({ conversationId: null, question: 'inner join', requestId: 'c' }, () => {});
    expect(r.ok).toBe(true);
    expect(core.dashboard().usage).toMatchObject({ runs: 2, failed: 1 });
  });

  it('marca citas inventadas como no verificadas', async () => {
    process.env.FAKE_MODE = 'badcite';
    const r = await core.askQuestion({ conversationId: null, question: 'inner join', requestId: 'd' }, () => {});
    expect(r.ok && r.message.sources[0].verified).toBe(false);
  });

  it('un fallo no deja conversaciones a medias y queda registrado', async () => {
    process.env.FAKE_MODE = 'error';
    const r = await core.askQuestion({ conversationId: null, question: 'inner join', requestId: 'e' }, () => {});
    expect(r).toMatchObject({ ok: false, errorKind: 'execution', conversationId: null });
    expect(core.ask.list()).toEqual([]);
    expect(core.log.recent().some((a) => a.level === 'error')).toBe(true);
  });

  it('cancela una consulta en curso', async () => {
    process.env.FAKE_MODE = 'slow';
    const p = core.askQuestion({ conversationId: null, question: 'inner join', requestId: 'f' }, () => {});
    setTimeout(() => core.cancel('f'), 800);
    expect(await p).toMatchObject({ ok: false, errorKind: 'cancelled' });
  });

  it('guarda la respuesta como nota fuera del vault y crea copias de seguridad', async () => {
    const r = await core.askQuestion({ conversationId: null, question: '¿Qué es un inner join?', requestId: 'g' }, () => {});
    if (!r.ok) throw new Error(r.error);
    const note = core.saveMessageAsNote(r.message.id);
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    expect(note.value.startsWith(out)).toBe(true);
    const text = fs.readFileSync(note.value, 'utf8');
    expect(text).toContain('[[notas/sql#Joins]]');
    expect(text).toContain('no está en el vault');
    const b = core.backup();
    expect(b.ok && fs.existsSync(b.value)).toBe(true);
  });

  it('rechaza una carpeta de resultados dentro del vault', () => {
    expect(core.updateSettings({ outputDir: path.join(root, 'StudyCore') }).ok).toBe(false);
  });
});
