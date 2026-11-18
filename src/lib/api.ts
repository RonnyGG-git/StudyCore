import type { StudyCoreApi } from '../../shared/types';

declare global {
  interface Window {
    studycore: StudyCoreApi;
  }
}

export const api: StudyCoreApi = window.studycore;

export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
