import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AppCore } from '../../electron/core/app-core';

// Usa la CLI real de Claude Code y el vault real (solo lectura). STUDYCORE_REAL_VAULT y STUDYCORE_REAL_DATA lo ajustan.
const VAULT = process.env.STUDYCORE_REAL_VAULT || 'C:/RONNY/MIND/CEREBRO';

it('consulta real: responde, cita el vault con fuentes verificadas y sigue la conversación', async () => {
  const dataDir = process.env.STUDYCORE_REAL_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'studycore-real-'));
  const core = new AppCore({ dataDir, defaultOutputDir: path.join(dataDir, 'salida') });
  try {
    expect((await core.getClaudeStatus(true)).loggedIn).toBe(true);
    expect(core.updateSettings({ vaultPath: VAULT, model: 'sonnet' }).ok).toBe(true);
    await core.reindex(() => {});

    const steps: string[] = [];
    const r = await core.askQuestion({ conversationId: null, question: '¿Qué es VLSM y por qué se usa al hacer subneteo?', requestId: 'real-1' }, (t) => steps.push(t));
    if (!r.ok) throw new Error(`${r.errorKind}: ${r.error}`);
    console.log('PASOS', steps);
    console.log('RESPUESTA', r.message.content.slice(0, 600));
    console.log('FUENTES', r.message.sources.map((s) => `${s.ref} ${s.verified ? '✔' : '✘'} ${s.path} › ${s.heading} :: ${s.quote.slice(0, 80)} ${s.reason ?? ''}`));
    expect(r.message.sources.length).toBeGreaterThan(0);
    expect(r.message.sources.some((s) => s.verified && s.path.includes('VLSM'))).toBe(true);

    const r2 = await core.askQuestion({ conversationId: r.conversationId, question: 'Dame un ejemplo corto con una red /24.', requestId: 'real-2' }, () => {});
    if (!r2.ok) throw new Error(`${r2.errorKind}: ${r2.error}`);
    console.log('SEGUIMIENTO', r2.message.content.slice(0, 400));
    expect(core.ask.get(r.conversationId)!.messages).toBe(4);
    console.log('USO', core.dashboard().usage);
  } finally {
    core.shutdown();
  }
});
