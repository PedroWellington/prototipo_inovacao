// Template com escape automático: html`<p>${texto}</p>`. Use raw() só para HTML já confiável.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const RAW = Symbol('raw');

export const escape = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const raw = (s) => ({ [RAW]: String(s) });

function render(v) {
  if (Array.isArray(v)) return v.map(render).join('');
  if (v && v[RAW] !== undefined) return v[RAW];
  if (v === false || v === null || v === undefined) return '';
  return escape(v);
}

export function html(strings, ...values) {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ''), ''));
}

export function mount(el, tpl) {
  el.innerHTML = tpl[RAW];
}

export const fmt = {
  int: (n) => new Intl.NumberFormat('pt-BR').format(n),
  dec: (n, d = 1) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n),
  pct: (n) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(n * 100) + '%',
};
