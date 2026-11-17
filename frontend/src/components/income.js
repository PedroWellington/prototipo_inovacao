// Renda: valor, quartil, frase padrão, fonte, data e a nota fixa. Sem dado: a mensagem padrão (nunca estimativa).
// Usado no explorador e no detalhe do bairro (mesmo aviso nos dois).
import { html } from '../html.js';
import { brl } from '../lib.js';

export function incomeBlock(inc, among) {
  if (!inc) return '';
  if (!inc.available) return html`<p class="inc small"><strong>Renda:</strong> ${inc.message} <span class="muted">${inc.note}</span></p>`;
  return html`<div class="inc small"><strong>Renda (Censo 2022):</strong> mediana do rendimento mensal do responsável pelo domicílio
    <span class="tabular">${brl(inc.median)}</span>${inc.approximate ? html` <span class="tag">aproximado</span>` : ''};
    ${inc.quartile}º quartil (de 4) entre ${among}.<br />${inc.text}<br />
    <span class="muted">${inc.note} Fonte: ${inc.source?.name || 'IBGE, Censo 2022'}, ref. ${inc.source?.reference_date || '2022'}.</span></div>`;
}
