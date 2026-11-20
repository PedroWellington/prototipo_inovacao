// Renda: só o valor ("Renda mediana do bairro: R$ 5.000/mês" ou "da cidade"), o aviso de aproximado, fonte, data e a
// nota fixa. No bairro, a comparação com a cidade que vem do servidor ("300% maior que a da cidade"), com a fonte e a
// data dos dois valores. Sem interpretação (nada de "poder de compra" nem perfil). Sem dado: a mensagem padrão.
// Usado no explorador e no detalhe do bairro (mesmo aviso nos dois).
import { html } from '../html.js';
import { brl } from '../lib.js';

const ref = (s) => `${s?.name || 'IBGE, Censo 2022'}, ref. ${s?.reference_date || '2022'}`;

// Fonte e data de cada valor; a mesma fonte para os dois vira "bairro e cidade, <fonte>, ref." (como rank.py).
export function sourcesText(sources) {
  const lines = sources.map(ref);
  return new Set(lines).size === 1 ? `${sources.map((s) => s.of).join(' e ')}, ${lines[0]}` : sources.map((s, i) => `${s.of}, ${lines[i]}`).join('; ');
}

function comparison(cmp) {
  if (!cmp) return '';
  if (!cmp.available) return html`<br /><span>Comparação com a cidade: ${cmp.text}</span>`;
  return html`<br /><span><strong>${cmp.text}</strong> (${cmp.city_text})</span><br />
    <span class="muted">${cmp.basis}: ${sourcesText(cmp.sources)}</span>`;
}

export function incomeBlock(inc) {
  if (!inc) return '';
  const label = inc.label || 'Renda mediana';
  if (!inc.available) return html`<div class="inc small"><strong>${label}:</strong> ${inc.message} <span class="muted">${inc.note}</span>${comparison(inc.comparison)}</div>`;
  return html`<div class="inc small"><strong>${label}:</strong> <span class="tabular">${brl(inc.median)}</span>/mês${inc.approximate ? html` <span class="tag">aproximado</span>` : ''}<br />
    <span class="muted">${ref(inc.source)}.${inc.approximate ? ' Valor aproximado: média das medianas dos setores censitários da área.' : ''} ${inc.note}</span>${comparison(inc.comparison)}</div>`;
}
