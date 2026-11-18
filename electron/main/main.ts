import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { AppCore } from '../core/app-core';
import { registerIpc } from './ipc';

// Una sola instancia: dos ventanas escribiendo en la misma base de datos provocarían conflictos.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null;
  let core: AppCore | null = null;

  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  app.whenReady().then(() => {
    core = new AppCore({
      dataDir: process.env.STUDYCORE_DATA_DIR || app.getPath('userData'),
      defaultOutputDir: path.join(app.getPath('documents'), 'StudyCore'),
    });
    core.log.info('app', `StudyCore iniciado (v${app.getVersion()})`);
    registerIpc(core, () => win);

    const dark = core.settings.get().theme === 'dark' || (core.settings.get().theme === 'system' && nativeTheme.shouldUseDarkColors);
    win = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: dark ? '#0f1012' : '#fafaf9',
      title: 'StudyCore',
      autoHideMenuBar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const area = screen.getPrimaryDisplay().workAreaSize;
    win.once('ready-to-show', () => {
      if (area.height < 900) win?.maximize();
      win?.show();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    const hash = process.env.STUDYCORE_PAGE || undefined;
    if (devUrl) void win.loadURL(hash ? `${devUrl}#${hash}` : devUrl);
    else void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), { hash });

    // Prueba de humo: STUDYCORE_SCREENSHOT=ruta.png [STUDYCORE_PAGE=vault] captura la ventana real y cierra.
    const shot = process.env.STUDYCORE_SCREENSHOT;
    if (shot) {
      win.webContents.on('console-message', (e) => {
        if (e.level === 'error' || e.level === 'warning') process.stdout.write(`[renderer:${e.level}] ${e.message}
`);
      });
      win.webContents.once('did-finish-load', async () => {
        await new Promise((r) => setTimeout(r, Number(process.env.STUDYCORE_SHOT_DELAY || 2500)));
        const scroll = Number(process.env.STUDYCORE_SCROLL || 0);
        if (scroll) {
          await win!.webContents.executeJavaScript(`document.querySelectorAll('main .overflow-y-auto').forEach((e) => (e.scrollTop = ${scroll}))`);
          await new Promise((r) => setTimeout(r, 600));
        }
        const img = await win!.webContents.capturePage();
        fs.writeFileSync(shot, img.toPNG());
        app.quit();
      });
    }
  });

  app.on('before-quit', () => core?.shutdown());
  app.on('window-all-closed', () => app.quit());
}
