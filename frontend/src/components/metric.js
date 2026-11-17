// Métricas com hierarquia (um lugar só para todas as telas): rótulo pequeno em caixa alta acima, número grande
// tabular como protagonista, forma pequena ao lado só quando há dado real, e nota de fonte/data embaixo.
// metricGroup(principal, [secundárias]): a principal domina; as outras ficam menores, empilhadas ao lado.
import { html } from '../html.js';
import { countNumber, growBar, skeleton } from '../motion.js';

// value: número (conta de 0 ao valor); text: texto curto no lugar do número; nenhum dos dois: "sem dado".
export function metric({ label, value = null, text = null, decimals = 0, unit = '', shape = '', note = '', extra = '', primary = false }) {
  const num =
    value != null
      ? html`<strong class="metric-num">${countNumber(value, { decimals })}${unit ? html`<small>${unit}</small>` : ''}</strong>`
      : html`<strong class="metric-num is-text">${text ?? 'sem dado'}</strong>`;
  return html`<div class="metric ${primary ? 'is-primary' : ''}" data-cx>
    <span class="metric-label">${label}</span>${num}${shape}${extra}${note ? html`<small class="metric-note">${note}</small>` : ''}</div>`;
}

export const metricGroup = (primary, rest) =>
  html`<div class="metric-group ${rest.length ? '' : 'is-single'}">${primary}${rest.length ? html`<div class="metric-side">${rest}</div>` : ''}</div>`;

// Esqueleto do grupo com o mesmo tamanho do final (CLS 0).
export const metricGroupSkeleton = (n = 3) =>
  html`<div class="metric-group"><div class="metric is-primary">${skeleton('11px', '35%')}${skeleton('52px', '45%')}${skeleton('6px', '100%')}${skeleton('12px', '70%')}</div>
    <div class="metric-side">${Array.from({ length: n }, () => html`<div class="metric">${skeleton('11px', '40%')}${skeleton('24px', '50%')}</div>`)}</div></div>`;

// Formas (só transform): barra de proporção e marca de posição numa escala. Sem dado real, não desenha.
export const shapeBar = (v, label) => (v == null || Number.isNaN(v) ? '' : growBar(v, label));
export const shapeMark = (v, label) =>
  v == null || Number.isNaN(v)
    ? ''
    : html`<span class="mark" style="--v:${Math.max(0, Math.min(1, v)).toFixed(3)}" role="img" aria-label="${label}"><i></i></span>`;
