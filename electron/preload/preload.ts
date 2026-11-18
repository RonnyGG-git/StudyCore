import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { StudyCoreApi } from '../../shared/types';

// Superficie mínima y tipada: la interfaz nunca accede a Node ni a ipcRenderer directamente.
const on = <T>(channel: string, cb: (p: T) => void) => {
  const listener = (_e: IpcRendererEvent, p: T) => cb(p);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api: StudyCoreApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  chooseFolder: (title) => ipcRenderer.invoke('dialog:folder', title),
  claudeStatus: (refresh) => ipcRenderer.invoke('claude:status', refresh),
  dashboard: () => ipcRenderer.invoke('dashboard:get'),
  vaultStats: () => ipcRenderer.invoke('vault:stats'),
  reindex: () => ipcRenderer.invoke('vault:reindex'),
  vaultTree: () => ipcRenderer.invoke('vault:tree'),
  openDocument: (p) => ipcRenderer.invoke('vault:document', p),
  search: (q, limit) => ipcRenderer.invoke('vault:search', q, limit),
  ask: (input) => ipcRenderer.invoke('ask:send', input),
  cancel: (id) => ipcRenderer.invoke('claude:cancel', id),
  listConversations: () => ipcRenderer.invoke('conversations:list'),
  getConversation: (id) => ipcRenderer.invoke('conversations:get', id),
  renameConversation: (id, title) => ipcRenderer.invoke('conversations:rename', id, title),
  saveMessageAsNote: (id) => ipcRenderer.invoke('messages:saveNote', id),
  backup: () => ipcRenderer.invoke('data:backup'),
  revealPath: (t) => ipcRenderer.invoke('shell:reveal', t),
  onIndexProgress: (cb) => on('vault:indexProgress', cb),
  onClaudeProgress: (cb) => on('claude:progress', cb),
  call: (method, ...args) => ipcRenderer.invoke('rpc', method, ...args),
  onReward: (cb) => on('game:reward', cb),
};

contextBridge.exposeInMainWorld('studycore', api);
