// Barra superior grafite do app (dashboard, explorador e conta). Só estrutura: visual em styles/components.css.
import { PRODUCT_NAME } from '../brand.js';
import { html } from '../html.js';
import { aboutLink, logo } from '../icons.js';
import { initials } from '../lib.js';

const NAV = [
  { key: 'home', label: 'Visão geral', href: '#/home' },
  { key: 'explorer', label: 'Explorador', href: '#/explorer' },
  { key: 'analises', label: 'Minhas análises', href: '#/home?s=analises' },
  { key: 'fontes', label: 'Dados e fontes', href: '#/home?s=fontes' },
];

// active: chave do item atual; slot: conteúdo extra no meio (ex.: o caminho do explorador).
export function topbar({ active, user, profile, slot = '', lead = '' }) {
  const name = profile?.company_name || user?.name || '';
  return html`<header class="topbar on-dark">
    ${lead}
    <a href="#/home" class="logo-link" aria-label="Visão geral">${logo()}</a>
    <span class="topbar-sub hide-md">Inteligência territorial</span>
    <nav class="topnav" aria-label="Navegação principal">${NAV.map(
      (n) => html`<a class="topnav-link ${n.key === active ? 'is-active' : ''}" href="${n.href}" ${n.key === active ? 'aria-current="page"' : ''}>${n.label}</a>`,
    )}</nav>
    ${slot}
    <div class="topbar-right">
      <span class="hide-sm">${aboutLink()}</span>
      <a class="topbar-profile" href="#/conta" aria-label="Minha conta de ${name || PRODUCT_NAME}">
        <span class="topbar-avatar" aria-hidden="true">${initials(name)}</span><span class="hide-sm">Minha conta</span>
      </a>
    </div>
  </header>`;
}
