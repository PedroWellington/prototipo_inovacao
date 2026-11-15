// Lista de ranking com chave: quando os pesos mudam, as linhas existentes são reaproveitadas e deslizam até a
// nova posição (FLIP, só transform). Duas leituras de layout por atualização, nenhuma por quadro.
import { html, mount } from './html.js';

const FLIP_MS = 470;
const EASE = 'cubic-bezier(.22,1,.36,1)';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Posição de cada linha antes da mudança (leitura 1). Chame antes de mexer no painel em volta da lista.
export function measure(ol) {
  const before = new Map();
  if (ol) for (const li of ol.children) before.set(li.dataset.key, li.getBoundingClientRect().top);
  return before;
}

// ol: o <ol> da lista; rows: itens já na ordem nova, cada um com .key; row(r) devolve o conteúdo do <li>.
export function updateRankList(ol, rows, row, before = measure(ol)) {
  const old = new Map([...ol.children].map((li) => [li.dataset.key, li]));
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    let li = old.get(String(r.key));
    if (li) old.delete(String(r.key));
    else {
      li = document.createElement('li');
      li.dataset.key = r.key;
    }
    mount(li, row(r)); // só o conteúdo da linha muda (posição, nota, seleção); o <li> continua o mesmo
    frag.append(li);
  }
  old.forEach((li) => li.remove());
  ol.append(frag); // reordena movendo os mesmos nós
  if (reduced() || !before.size) return;
  for (const li of ol.children) {
    const top0 = before.get(li.dataset.key);
    if (top0 == null) continue;
    const dy = top0 - li.getBoundingClientRect().top; // leitura 2 (o navegador agrupa num só layout)
    if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${Math.round(dy)}px)` }, { transform: 'none' }], { duration: FLIP_MS, easing: EASE });
  }
}

export const rankListShell = (label) => html`<ol class="rank-list" data-rank-list aria-label="${label}"></ol>`;
