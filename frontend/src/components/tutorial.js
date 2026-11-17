// Tutorial de primeira vez: 5 passos curtos sobre a Visão geral. Uma vez só por conta: o servidor guarda
// tutorial_concluido_em (POST /api/auth/tutorial); concluir, pular, Esc ou clicar fora contam como concluído.
// "Ver tutorial novamente" (Minha conta) roda com replay: true e não grava nada.
// Visual: recorte sobre o resto (um só elemento que se move por transform) e cartão pequeno; no celular, barra
// inferior. Foco preso no cartão, aria-modal, passo anunciado. prefers-reduced-motion troca sem animação.
import { post } from '../api.js';
import { html, mount } from '../html.js';

// Cada passo: os alvos possíveis (o primeiro visível vale; no celular o menu vira o botão "Menu") e uma frase.
const STEPS = (days) => [
  { targets: ['.topnav', '[data-topbar-menu]'], text: 'No menu: Visão geral, Análises, Comparar, Dados e fontes e Explorar, onde fica o mapa.' },
  { targets: ['.metric.is-primary'], text: `Cada crédito abre 1 cidade por ${days} dias; reabrir no prazo não gasta crédito.` },
  { targets: ['#ovCrit', '[href="#/criterios"]'], text: 'Aqui você define o que quer perto e o que quer longe, com peso de 1 a 5.' },
  { targets: ['.ov-cta'], text: 'No mapa, a cor e o número de cada bairro mostram quanto ele combina com seus critérios; clique para ver o detalhe.' },
  { targets: ['.ov-meta', '[data-nav="fontes"]'], text: 'Cada número traz fonte, data e cobertura; a lista completa fica em Dados e fontes.' },
];

let running = false; // nunca dois ao mesmo tempo nem de novo na mesma sessão
let shownThisSession = false;

const visible = (el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

export function startTutorial({ days = 30, replay = false, onDone = () => {} } = {}) {
  if (running || (!replay && shownThisSession)) return;
  running = true;
  shownThisSession = true;
  const steps = STEPS(days);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const opener = document.activeElement;
  const root = document.createElement('div');
  root.className = 'tour';
  mount(
    root,
    html`<div class="tour-scrim" data-tour-close></div><div class="tour-hole" aria-hidden="true"></div>
      <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourStep" aria-describedby="tourText">
        <p class="tour-step" id="tourStep"></p>
        <p class="tour-text" id="tourText" aria-live="polite"></p>
        <div class="tour-actions"><button type="button" class="btn btn-ghost btn-sm" data-tour-close>Pular</button>
          <button type="button" class="btn btn-primary btn-sm" data-tour-next></button></div>
      </div>`,
  );
  document.body.append(root);
  const hole = root.querySelector('.tour-hole');
  const card = root.querySelector('.tour-card');
  let i = 0;

  function show() {
    const s = steps[i];
    const el = s.targets.map((q) => document.querySelector(q)).find(visible);
    root.querySelector('#tourStep').textContent = `${i + 1} de ${steps.length}`;
    root.querySelector('#tourText').textContent = s.text;
    root.querySelector('[data-tour-next]').textContent = i === steps.length - 1 ? 'Concluir' : 'Próximo';
    if (el) el.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' });
    // Mede depois da rolagem; o recorte e o cartão só se movem por transform.
    setTimeout(() => place(el), reduced ? 0 : 320);
  }

  function place(el) {
    const pad = 8;
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    hole.style.width = `${Math.round(r.width + pad * 2)}px`;
    hole.style.height = `${Math.round(r.height + pad * 2)}px`;
    hole.style.transform = `translate(${Math.round(r.left - pad)}px, ${Math.round(r.top - pad)}px)`;
    if (matchMedia('(max-width: 640px)').matches) return (card.style.transform = ''); // celular: barra inferior fixa
    const w = card.offsetWidth, h = card.offsetHeight;
    const below = r.top + r.height + pad + 12 + h < innerHeight;
    const x = Math.max(16, Math.min(innerWidth - w - 16, r.left));
    const y = below ? r.top + r.height + pad + 12 : Math.max(16, r.top - pad - 12 - h);
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function finish() {
    if (!running) return;
    running = false;
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    root.remove();
    opener?.focus?.();
    if (!replay) post('/api/auth/tutorial').catch(() => {}); // pular no passo 1 também conta como concluído
    onDone();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      return finish();
    }
    if (e.key !== 'Tab') return;
    const f = [...card.querySelectorAll('button')];
    const at = f.indexOf(document.activeElement);
    if (e.shiftKey && at <= 0) (f.at(-1).focus(), e.preventDefault());
    else if (!e.shiftKey && at === f.length - 1) (f[0].focus(), e.preventDefault());
    else if (at < 0) (f[0].focus(), e.preventDefault());
  }
  const onResize = () => place(steps[i].targets.map((q) => document.querySelector(q)).find(visible));

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-tour-close]')) return finish();
    if (e.target.closest('[data-tour-next]')) {
      if (i === steps.length - 1) return finish();
      i += 1;
      show();
      card.querySelector('[data-tour-next]').focus();
    }
  });
  addEventListener('keydown', onKey, true);
  addEventListener('resize', onResize, { passive: true });
  show();
  requestAnimationFrame(() => {
    root.classList.add('is-open');
    card.querySelector('[data-tour-next]').focus();
  });
}
