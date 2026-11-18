import { dialog, ipcMain, shell, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import { z } from 'zod';
import type { AppCore } from '../core/app-core';
import { errorText } from '../core/app-core';
import { createRpc, invokeRpc } from '../core/rpc';
import { isInside } from '../core/vault/paths';

/**
 * Cada canal valida sus argumentos con zod antes de tocar un servicio:
 * la interfaz no es de confianza por defecto.
 */
export function registerIpc(core: AppCore, getWin: () => BrowserWindow | null) {
  const handle = <S extends z.ZodTuple>(channel: string, schema: S, fn: (...args: z.infer<S>) => unknown) => {
    ipcMain.handle(channel, async (_e, ...raw: unknown[]) => {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        core.log.warn('ipc', `Petición inválida en ${channel}`);
        throw new Error('Petición no válida.');
      }
      return fn(...(parsed.data as z.infer<S>));
    });
  };
  const send = (channel: string, payload: unknown) => getWin()?.webContents.send(channel, payload);
  const none = z.tuple([]);

  // Motor educativo (fases 2-6): un único canal con una tabla de métodos validados.
  const table = createRpc(core, (requestId, text) => send('claude:progress', { requestId, text }));
  core.game.onReward = (r) => send('game:reward', r);
  ipcMain.handle('rpc', async (_e, method: unknown, ...args: unknown[]) => {
    if (typeof method !== 'string') throw new Error('Petición no válida.');
    try {
      return await invokeRpc(table, method, args);
    } catch (e) {
      core.log.warn('ipc', `${method}: ${errorText(e)}`);
      throw e;
    }
  });

  handle('settings:get', none, () => core.settings.get());
  handle('settings:update', z.tuple([z.record(z.string(), z.unknown())]), (patch) => core.updateSettings(patch as any));
  handle('dialog:folder', z.tuple([z.string().max(120)]), async (title) => {
    const win = getWin();
    const r = win ? await dialog.showOpenDialog(win, { title, properties: ['openDirectory', 'createDirectory'] }) : null;
    return r && !r.canceled && r.filePaths[0] ? r.filePaths[0] : null;
  });
  handle('claude:status', z.tuple([z.boolean()]), (refresh) => core.getClaudeStatus(refresh));
  handle('dashboard:get', none, () => core.dashboard());
  handle('vault:stats', none, () => core.vault.stats());
  handle('vault:reindex', none, () => core.reindex((p) => send('vault:indexProgress', p)));
  handle('vault:tree', none, () => core.vault.tree());
  handle('vault:document', z.tuple([z.string().min(1).max(1024)]), (p) => {
    try {
      return { ok: true, value: core.vault.document(p) };
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  });
  handle('vault:search', z.tuple([z.string().max(500), z.number().int().min(1).max(100).optional()]), (q, limit) => core.vault.search(q, limit ?? 25));
  handle(
    'ask:send',
    z.tuple([z.object({ conversationId: z.number().int().positive().nullable(), question: z.string().min(1).max(4000), requestId: z.string().min(1).max(64) })]),
    (input) => core.askQuestion(input, (text) => send('claude:progress', { requestId: input.requestId, text })),
  );
  handle('claude:cancel', z.tuple([z.string().min(1).max(64)]), (id) => core.cancel(id));
  handle('conversations:list', none, () => core.ask.list());
  handle('conversations:get', z.tuple([z.number().int().positive()]), (id) => core.ask.get(id));
  handle('conversations:rename', z.tuple([z.number().int().positive(), z.string().max(200)]), (id, t) => core.ask.rename(id, t));
  handle('messages:saveNote', z.tuple([z.number().int().positive()]), (id) => {
    try {
      return core.saveMessageAsNote(id);
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
  });
  handle('data:backup', none, () => core.backup());
  // Solo se revelan rutas propias de StudyCore o del vault, nunca rutas arbitrarias.
  handle('shell:reveal', z.tuple([z.string().min(1).max(1024)]), (target) => {
    const { outputDir, vaultPath } = core.settings.get();
    const allowed = [outputDir, vaultPath].filter(Boolean).some((root) => isInside(root, target));
    if (!allowed || !fs.existsSync(target)) return;
    if (fs.statSync(target).isDirectory()) void shell.openPath(target);
    else shell.showItemInFolder(target);
  });
}
