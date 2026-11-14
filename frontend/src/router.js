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

async function route() {
  const id = ++navId;
  const path = location.hash.replace(/^#/, '').split('?')[0] || '/';
  const user = await loadUser();
  const target = resolve(path, user);
  if (target !== path) {
    history.replaceState(null, '', '#' + target);
    return route();
  }
  const view = await ROUTES[target].load();
  if (id !== navId) return; // outra navegação começou enquanto carregava
  if (cleanup) cleanup();
  const root = document.getElementById('app');
  root.classList.remove('view-enter');
  if (!firstView) {
    void root.offsetWidth; // reinicia a animação de entrada (só nas trocas de tela)
    root.classList.add('view-enter');
  }
  firstView = false;
  cleanup = (await view(root)) || null;
  document.querySelector('[autofocus]')?.focus();
}

export function startRouter() {
  window.addEventListener('hashchange', route);
  route();
}
