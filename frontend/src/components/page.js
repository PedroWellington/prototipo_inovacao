// Casca das páginas do app (barra superior, miolo e rodapé legal). Esqueleto primeiro, depois o conteúdo em cascata.
import { html, mount } from '../html.js';
import { cascade, animateOnView } from '../motion.js';
import { topbar, wireTopbar } from './topbar.js';

export const legalFooter = () =>
  html`<nav class="ov-footer" aria-label="Avisos legais" data-cx><a href="#/termos">Avisos legais e termos de uso</a><a href="#/privacidade">Política de privacidade</a><a href="#/como-calculamos">Como calculamos</a></nav>`;

// Cabeçalho que informa: o título diz o que se vê; meta traz período, data e cobertura. A saudação, se houver,
// fica pequena acima do título. action: o botão principal da tela (o único em cobre).
export const pageHead = ({ eyebrow, greeting = '', title, meta = '', action = '', aside = '' }) =>
  html`<div class="ov-head" data-cx><div>
    ${greeting ? html`<p class="ov-greeting">${greeting}</p>` : ''}<div class="ov-eyebrow">${eyebrow}</div>
    <h1>${title}</h1>${meta ? html`<p class="ov-meta">${meta}</p>` : ''}${action}</div>${aside}</div>`;

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
      // Dois quadros: o conteúdo entra no quadro seguinte ao do esqueleto e a cascata/formas no outro, para
      // nenhum quadro somar desmontar a tela antiga, montar a nova e animar (docs/PERFORMANCE.md, Fase 9).
      requestAnimationFrame(() => {
        if (ac.signal.aborted) return;
        mount(root.querySelector('#main'), body(data));
        requestAnimationFrame(() => {
          if (ac.signal.aborted) return;
          if (!entered.done) {
            cascade(root.querySelector('#main'));
            entered.done = true;
          }
          off = animateOnView(root);
          root.dispatchEvent(new CustomEvent('page:ready', { detail: data }));
        });
      });
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
