// Renda: só o valor ("Renda mediana: R$ 1.500/mês"), o aviso de aproximado, fonte, data e a nota fixa. Sem
// interpretação (nada de "poder de compra" nem perfil). Sem dado: a mensagem padrão (nunca estimativa).
// Usado no explorador e no detalhe do bairro (mesmo aviso nos dois).
import { html } from '../html.js';
import { brl } from '../lib.js';

export function incomeBlock(inc) {
  if (!inc) return '';
  if (!inc.available) return html`<p class="inc small"><strong>Renda:</strong> ${inc.message} <span class="muted">${inc.note}</span></p>`;
  return html`<div class="inc small"><strong>Renda mediana:</strong> <span class="tabular">${brl(inc.median)}</span>/mês${inc.approximate ? html` <span class="tag">aproximado</span>` : ''}<br />
    <span class="muted">${inc.source?.name || 'IBGE, Censo 2022'}, ref. ${inc.source?.reference_date || '2022'}.${inc.approximate ? ' Valor aproximado: média das medianas dos setores censitários da área.' : ''} ${inc.note}</span></div>`;
}
