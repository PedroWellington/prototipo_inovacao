// Flags públicas do protótipo (GET /api/config): selo "Protótipo" e recursos desligados. Nada de regra de negócio aqui.
export const flags = { prototype: false, demo_mode: false, uploads: true };

export function loadFlags() {
  return fetch('/api/config', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((f) => {
      Object.assign(flags, f);
      if (flags.prototype) document.documentElement.dataset.prototype = '1';
    })
    .catch(() => {}); // sem API: fica como está
}
