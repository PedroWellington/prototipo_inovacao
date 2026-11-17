// Linguagem de movimento única (tokens em shared/design-tokens.css): esqueleto, cascata, números que contam,
// barras que crescem e anel de nota. Nenhuma tela anima por conta própria: tudo passa por aqui.
// Só transform e opacity (o anel usa stroke-dashoffset num único SVG). prefers-reduced-motion mostra o final direto.
import { html } from './html.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOutCubic = (k) => 1 - (1 - k) ** 3;
const int = (v) => new Intl.NumberFormat('pt-BR').format(v);

// Esqueleto com o tamanho exato do conteúdo final (h, w em CSS): CLS 0. Brilho só por opacity (CSS).
export const skeleton = (h = '14px', w = '100%') => html`<span class="sk" style="height:${h};width:${w}" aria-hidden="true"></span>`;

// Cascata: os elementos [data-cx] de root entram com --stagger entre eles. Só na primeira exibição (quem chama decide).
export function cascade(root) {
  root.querySelectorAll('[data-cx]').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14)));
  root.classList.add('is-cascading');
}

// Número que conta de 0 ao valor real (easeOutCubic, 600 a 900 ms). O aria-label leva o valor final desde o começo;
// 0 fica 0; o final é exato; não repete para o mesmo valor.
export function countUp(el, value, { fmt = int, ms = 800 } = {}) {
  const show = (v) => (el.textContent = fmt(v));
  el.setAttribute('aria-label', fmt(value));
  if (reduced() || !value || el.dataset.counted === String(value)) {
    el.dataset.counted = String(value);
    return show(value);
  }
  el.dataset.counted = String(value);
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    show(k < 1 ? value * easeOutCubic(k) : value);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Número grande com contagem: data-count (valor) e data-decimals (casas). Mostra o final já no HTML (sem JS, fica certo).
export const countNumber = (value, { decimals = 0, cls = '' } = {}) =>
  html`<span class="tabular ${cls}" data-count="${value}" data-decimals="${decimals}">${decimals ? value.toFixed(decimals).replace('.', ',') : int(value)}</span>`;

// Barra que cresce: scaleX de 0 até --v (0..1) quando entra na tela. O valor numérico vai sempre ao lado (quem chama).
export const growBar = (v, label = '') =>
  html`<span class="grow" style="--v:${Math.max(0, Math.min(1, v)).toFixed(3)}" role="img" aria-label="${label}"><span></span></span>`;

// Anel de nota (0 a 100): o traço completa até o valor quando entra na tela. O número fica no centro.
export function ring(value, { size = 112, decimals = 1 } = {}) {
  const r = (size - 10) / 2, c = 2 * Math.PI * r;
  return html`<span class="ring" style="--c:${c.toFixed(1)};--v:${(value / 100).toFixed(4)};width:${size}px;height:${size}px" role="img" aria-label="Nota ${value.toFixed(decimals).replace('.', ',')} de 100">
    <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}"/><circle class="ring-bar" cx="${size / 2}" cy="${size / 2}" r="${r}"/></svg>
    <b>${countNumber(value, { decimals })}<small>/100</small></b></span>`;
}

// Liga tudo o que está em root: conta números, cresce barras e anéis quando entram na tela, uma vez só.
export function animateOnView(root) {
  const fmtOf = (el) => (Number(el.dataset.decimals) ? (v) => v.toFixed(Number(el.dataset.decimals)).replace('.', ',') : int);
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target;
      if (el.dataset.count !== undefined) countUp(el, Number(el.dataset.count), { fmt: fmtOf(el) });
      el.classList.add('is-in');
    }
  }, { threshold: 0.15 });
  root.querySelectorAll('[data-count], .grow, .ring').forEach((el) => io.observe(el));
  return () => io.disconnect();
}
