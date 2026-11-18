import type { Rpc } from '../../shared/learning';

/** Cliente tipado del motor educativo: cada método viaja por el canal "rpc" y se valida en el proceso principal. */
export const rpc = new Proxy({} as Rpc, {
  get: (_t, method: string) => (...args: unknown[]) => window.studycore.call(method, ...args),
});
