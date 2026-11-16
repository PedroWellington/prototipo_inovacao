// Flags públicas (GET /api/config): recursos ligados ou desligados neste ambiente. Nada de regra de negócio aqui;
// nenhuma flag gera texto visível ao usuário.
export const flags = { prototype: false, demo_mode: false, uploads: true };

export let flagsReady = Promise.resolve();

export function loadFlags() {
  flagsReady = fetch('/api/config', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((f) => Object.assign(flags, f))
    .catch(() => {}); // sem API: fica como está
  return flagsReady;
}
