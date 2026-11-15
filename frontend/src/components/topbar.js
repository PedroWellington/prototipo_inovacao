// Barra superior grafite do app (visão geral, explorador e conta). Só estrutura: visual em styles/components.css.
// Ordem: as três seções da Visão geral (mesma página: rolam) e, por último, em destaque, o Explorador (outra tela).
import { PRODUCT_NAME } from '../brand.js';
import { html } from '../html.js';
import { aboutLink, icon, logo } from '../icons.js';
import { initials } from '../lib.js';

const NAV = [
  { key: 'home', label: 'Visão geral', href: '#/home' },
  { key: 'analises', label: 'Minhas análises', href: '#/home?s=analises' },
  { key: 'fontes', label: 'Dados e fontes', href: '#/home?s=fontes' },
];

// active: 'home' | 'analises' | 'fontes' | 'explorer' | null.
export function topbar({ active, user, profile }) {
  const name = profile?.company_name || user?.name || '';
  return html`<header class="topbar on-dark">
    <a href="#/home" class="logo-link" data-nav="home">${logo()}</a>
    <button type="button" class="topbar-menu" data-topbar-menu aria-expanded="false" aria-controls="topnav">${icon('list', 18)}<span>Menu</span></button>
    <nav class="topnav" id="topnav" aria-label="Navegação principal">
      ${NAV.map(
        (n) => html`<a class="topnav-link ${n.key === active ? 'is-active' : ''}" href="${n.href}" data-nav="${n.key}" ${n.key === active ? 'aria-current="page"' : ''}>${n.label}</a>`,
      )}
      <a class="topnav-cta ${active === 'explorer' ? 'is-active' : ''}" href="#/explorer" data-nav="explorer" ${active === 'explorer' ? 'aria-current="page"' : ''}>${icon('map', 15)}Explorador</a>
    </nav>
    <div class="topbar-right">
      <span class="hide-sm">${aboutLink()}</span>
      <a class="topbar-profile" href="#/conta">
        <span class="topbar-avatar" aria-hidden="true">${initials(name || PRODUCT_NAME)}</span><span class="sr-only-sm">Minha conta</span>
      </a>
    </div>
  </header>`;
}

// Liga o menu do celular e, na Visão geral, a rolagem suave até as seções (sem recarregar a tela).
// onSection(key): se a tela atual tem as seções, rola e devolve true; senão o link segue normal.
export function wireTopbar(root, { onSection, signal } = {}) {
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
    const a = e.target.closest('[data-nav]');
    if (!a) return;
    close();
    if (onSection && a.dataset.nav !== 'explorer' && onSection(a.dataset.nav)) e.preventDefault();
  }, { signal });
}

// Marca o item ativo (e aria-current) sem redesenhar a barra.
export function setActiveNav(root, key) {
  for (const a of root.querySelectorAll('.topbar [data-nav]')) {
    if (a.classList.contains('logo-link')) continue;
    const on = a.dataset.nav === key;
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
