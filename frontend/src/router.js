import { loadUser } from './session.js';

// Rotas por hash. Cada view exporta render(root) e pode devolver uma função de limpeza.
const ROUTES = {
  '/login': { load: () => import('./views/auth.js').then((m) => m.login), public: true },
  '/register': { load: () => import('./views/auth.js').then((m) => m.register), public: true },
  '/termos': { load: () => import('./views/legal.js').then((m) => m.terms), public: true, open: true },
  '/privacidade': { load: () => import('./views/legal.js').then((m) => m.privacy), public: true, open: true },
  '/como-calculamos': { load: () => import('./views/legal.js').then((m) => m.method), public: true, open: true },
  '/home': { load: () => import('./views/home.js').then((m) => m.render) },
  '/onboarding': { load: () => import('./views/onboarding.js').then((m) => m.render) },
  '/explorer': { load: () => import('./views/explorer.js').then((m) => m.render) },
  '/conta': { load: () => import('./views/account.js').then((m) => m.render) },
};

let cleanup = null;
let navId = 0;
let firstView = true; // a 1ª tela aparece já visível (sem fade): conteúdo na primeira pintura (FCP/LCP)
// O explorador fica vivo ao ir para a visão geral ou a conta: voltar não recria o mapa nem perde cidade,
// critérios e aba. Ele mora numa camada própria; as outras telas, em #view.
const KEEP = '/explorer';
const KEEP_FOR = new Set(['/home', '/conta']); // telas que não descartam o explorador
let alive = null; // { el, cleanup }

export function go(path) {
  if (location.hash === '#' + path) route();
  else location.hash = path;
}

// Decide para onde o usuário deve ir, dado o estado da sessão.
export function resolve(path, user) {
  const r = ROUTES[path];
  if (!r) return user ? (user.onboarding_completed ? '/home' : '/onboarding') : '/login';
  if (r.open) return path;
  if (r.public) return user ? resolve('/', user) : path;
  if (!user) return '/login';
  if (!user.onboarding_completed && path !== '/onboarding') return '/onboarding';
  return path;
}

function layers() {
  const app = document.getElementById('app');
  let main = document.getElementById('view');
  if (!main) {
    main = document.createElement('div');
    main.id = 'view';
    app.append(main);
  }
  return { app, main };
}

function showKeep(on) {
  if (!alive) return;
  alive.el.classList.toggle('is-shown', on);
  alive.el.inert = !on;
}

function dropKeep() {
  if (!alive) return;
  alive.cleanup?.();
  alive.el.remove();
  alive = null;
}

async function route() {
  const id = ++navId;
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const user = await loadUser();
  const target = resolve(path, user);
  if (target !== path) {
    history.replaceState(null, '', '#' + target);
    return route();
  }
  const { app, main } = layers();
  if (target === KEEP && alive) {
    // Volta ao explorador vivo: a tela atual sai por baixo da camada, sem recarregar nada.
    if (cleanup) cleanup();
    cleanup = null;
    showKeep(true);
    main.replaceChildren();
    alive.cleanup.resume?.();
    return;
  }
  if (!KEEP_FOR.has(target) && target !== KEEP) dropKeep();
  const view = await ROUTES[target].load();
  if (id !== navId) return; // outra navegação começou enquanto carregava
  if (cleanup) cleanup();
  cleanup = null;
  if (target === KEEP) {
    const el = document.createElement('div');
    el.className = 'view-layer';
    el.inert = true;
    app.append(el);
    alive = { el, cleanup: null };
    alive.cleanup = (await view(el)) || null;
    if (id !== navId) return;
    requestAnimationFrame(() => showKeep(true)); // entra por cima (opacity + transform) depois de montada
    main.replaceChildren();
    firstView = false;
    return;
  }
  main.classList.remove('view-enter');
  if (!firstView && !alive?.el.classList.contains('is-shown')) {
    void main.offsetWidth; // reinicia a animação de entrada (só nas trocas de tela)
    main.classList.add('view-enter');
  }
  firstView = false;
  window.scrollTo(0, 0); // cada tela começa do topo (a seção pedida, se houver, rola depois)
  cleanup = (await view(main)) || null;
  showKeep(false); // a nova tela já está montada por baixo: o explorador sai sem deixar tela em branco
  document.querySelector('[autofocus]')?.focus();
}

export function startRouter() {
  window.addEventListener('hashchange', route);
  route();
}
