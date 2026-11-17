// Casca das páginas do app (barra superior, miolo e rodapé legal). Esqueleto primeiro, depois o conteúdo em cascata.
import { html, mount } from '../html.js';
import { cascade, animateOnView } from '../motion.js';
import { topbar, wireTopbar } from './topbar.js';

export const legalFooter = () =>
  html`<nav class="ov-footer" aria-label="Avisos legais" data-cx><a href="#/termos">Avisos legais e termos de uso</a><a href="#/privacidade">Política de privacidade</a><a href="#/como-calculamos">Como calculamos</a></nav>`;

// Monta a página: skeleton() desenha o esqueleto com o tamanho do conteúdo final; load() busca os dados;
// body(data) devolve o HTML final. Devolve a função de limpeza da tela. Sem cascata ao voltar (entered por tela).
export function appPage(root, { active, user, cls = 'overview', skeleton, load, body, entered }) {
  const ac = new AbortController();
  const shell = (inner) => html`<div class="app-shell" data-dashboard>${topbar({ active, user })}<main class="${cls}" id="main">${inner}</main></div>`;
  mount(root, shell(skeleton()));
  wireTopbar(root, { signal: ac.signal });
  let off = () => {};
  load()
    .then((data) => {
      if (ac.signal.aborted) return;
      mount(root.querySelector('#main'), body(data));
      if (!entered.done) {
        cascade(root.querySelector('#main'));
        entered.done = true;
      }
      off = animateOnView(root);
      root.dispatchEvent(new CustomEvent('page:ready', { detail: data }));
    })
    .catch((e) => {
      if (ac.signal.aborted) return;
      mount(root.querySelector('#main'), html`<div class="alert alert-error" role="alert">${e.message || 'Não foi possível carregar.'}</div>`);
    });
  return () => {
    ac.abort();
    off();
  };
}
