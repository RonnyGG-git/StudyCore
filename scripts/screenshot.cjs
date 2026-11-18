// Captura la ventana real de StudyCore: node scripts/screenshot.cjs <salida.png> [pagina] [claro|oscuro]
// Usa STUDYCORE_DATA_DIR si está definido (para no tocar los datos reales).
const { spawnSync } = require('node:child_process');
const [out, page = '', theme = ''] = process.argv.slice(2);
const r = spawnSync(require('electron'), ['.'], {
  stdio: 'inherit',
  env: { ...process.env, STUDYCORE_SCREENSHOT: out, STUDYCORE_PAGE: page, STUDYCORE_FORCE_THEME: theme },
  timeout: 90_000,
});
process.exit(r.status ?? 1);
