// Barra superior grafite do app (visão geral, explorador e conta). Só estrutura: visual em styles/components.css.
// Ordem combinada: Visão geral · Análises · Comparar · Dados e fontes · Explorar (por último). Cada item é uma
// página com rota própria; o explorador fica vivo ao sair e voltar (router.js).
import { PRODUCT_NAME } from '../brand.js';
import { creditsState, loadCredits } from '../credits.js';
import { fmt, html, raw } from '../html.js';
import { aboutLink, icon, logo } from '../icons.js';
import { initials } from '../lib.js';
import { countUp } from '../motion.js';

const NAV = [
  { key: 'home', label: 'Visão geral', href: '#/home' },
  { key: 'analises', label: 'Análises', href: '#/analises' },
  { key: 'compare', label: 'Comparar', href: '#/comparar' },
  { key: 'fontes', label: 'Dados e fontes', href: '#/dados' },
  { key: 'explorer', label: 'Explorar', href: '#/explorer' },
];

// Botão claro/escuro (public/theme.js troca o tema ao clicar em [data-theme-toggle]).
export const themeButton = () =>
  raw(
    `<button type="button" class="theme-toggle" data-theme-toggle aria-label="Alternar tema claro e escuro" title="Tema claro ou escuro">` +
      `<svg class="ico-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>` +
      `<svg class="ico-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg></button>`,
  );

// active: 'home' | 'explorer' | 'analises' | 'compare' | 'fontes' | null.
export function topbar({ active, user, profile }) {
  const name = profile?.company_name || user?.name || '';
  return html`<header class="topbar on-dark">
    <a href="#/home" class="logo-link" data-nav="home">${logo()}</a>
    <button type="button" class="topbar-menu" data-topbar-menu aria-label="Menu" aria-expanded="false" aria-controls="topnav">${icon('list', 18)}<span>Menu</span></button>
    <nav class="topnav" id="topnav" aria-label="Navegação principal">
      <span class="topnav-pill" aria-hidden="true"></span>
      ${NAV.map(
        (n) => html`<a class="topnav-link ${n.key === active ? 'is-active' : ''}" href="${n.href}" data-nav="${n.key}" ${n.key === active ? html`aria-current="page"` : ''}>${n.label}</a>`,
      )}
    </nav>
    <div class="topbar-right">
      <span class="hide-sm">${aboutLink()}</span>
      ${themeButton()}
      <a class="topbar-credits" href="#/creditos" title="Saldo de créditos · Comprar créditos">${icon('coin', 16)}<span class="tabular" data-credit-balance>${creditsState() ? fmt.int(creditsState().balance) : '–'}</span><span class="sr-only"> créditos. Comprar créditos</span></a>
      <a class="topbar-profile" href="#/conta">
        <span class="topbar-avatar" aria-hidden="true">${initials(name || PRODUCT_NAME)}</span><span class="sr-only-sm">Minha conta</span>
      </a>
    </div>
  </header>`;
}

// A pílula do item ativo desliza por baixo do texto (só transform + width; o texto fica por cima).
function movePill(bar) {
  const pill = bar.querySelector('.topnav-pill');
  const a = bar.querySelector('.topnav-link.is-active');
  if (!pill) return;
  if (!a) return pill.style.setProperty('opacity', '0');
  pill.style.transform = `translateX(${a.offsetLeft}px)`;
  pill.style.width = `${a.offsetWidth}px`;
  pill.style.opacity = '1';
}

// Liga o menu do celular e a pílula.
export function wireTopbar(root, { signal } = {}) {
  const bar = root.querySelector('.topbar');
  if (!bar) return;
  const btn = bar.querySelector('[data-topbar-menu]');
  const close = () => {
    bar.classList.remove('menu-open');
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    const open = !bar.classList.contains('menu-open');
    bar.classList.toggle('menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) bar.querySelector('.topnav a')?.focus();
  }, { signal });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bar.classList.contains('menu-open')) {
      close();
      btn.focus();
    }
  }, { signal });
  bar.addEventListener('click', (e) => {
    if (e.target.closest('[data-nav]')) close();
  }, { signal });
  // Saldo na barra: o valor do servidor; depois, onCredits (credits.js) atualiza com a contagem.
  const n = bar.querySelector('[data-credit-balance]');
  if (n) loadCredits().then((st) => countUp(n, st.balance)).catch(() => {});
  movePill(bar);
  document.fonts?.ready.then(() => movePill(bar)); // a fonte Inter muda a largura dos itens
  addEventListener('resize', () => movePill(bar), { signal, passive: true });
}

// Marca o item ativo (e aria-current) sem redesenhar a barra; a pílula desliza até ele.
export function setActiveNav(root, key) {
  for (const a of root.querySelectorAll('.topbar [data-nav]')) {
    if (a.classList.contains('logo-link')) continue;
    const on = a.dataset.nav === key;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const bar = root.querySelector('.topbar');
  if (bar) movePill(bar);
}
