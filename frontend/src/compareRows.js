// Linhas do "Lado a lado" (Comparar): o valor de cada cidade, a diferença e a razão entre elas, com fonte e data.
// Só aritmética sobre os números que vieram do servidor; nenhum juízo de valor ("melhor", "pior") e nenhuma nota.
import { fmt } from './html.js';

const IBGE = 'IBGE, Censo 2022';
const MISSING = 'sem dado suficiente';
const num = (v, d) => (d ? fmt.dec(v, d) : fmt.int(v));

export function compareRows(a, b) {
  const cnpj =
    a.reference_month === b.reference_month
      ? `Receita Federal (CNPJ), ref. ${a.reference_month}`
      : `Receita Federal (CNPJ), ref. ${a.reference_month ?? '—'} (${a.name}) e ${b.reference_month ?? '—'} (${b.name})`;
  const src = a.income?.source || b.income?.source;
  const income = src ? `${src.name}, ref. ${src.reference_date}` : IBGE;
  const area = a.division_kind === 'area' || b.division_kind === 'area';
  const of = (f) => [f(a), f(b)].map((v) => (v == null || Number.isNaN(v) ? null : v));
  const loaded = (f) => (s) => (s.has_data ? f(s) : null);
  const rows = [
    { label: 'População', values: of((s) => s.population), unit: 'hab.', word: 'habitantes', noun: 'a população', source: IBGE },
    { label: 'Área', values: of((s) => s.area_km2), decimals: 1, unit: 'km²', word: 'km²', noun: 'a área', source: IBGE },
    {
      label: 'Densidade', values: of((s) => (s.population && s.area_km2 ? s.population / s.area_km2 : null)),
      unit: 'hab/km²', word: 'hab/km²', noun: 'a densidade', source: `calculado a partir de: população e área (${IBGE})`,
    },
    {
      label: area ? 'Bairros ou áreas' : 'Bairros', values: of(loaded((s) => s.neighborhoods)),
      word: area ? 'bairros ou áreas' : 'bairros', noun: area ? 'o número de bairros ou áreas' : 'o número de bairros', source: 'limites do IBGE, 2022',
    },
    {
      label: 'Cadastros ativos (CNPJ)', values: of(loaded((s) => s.coverage.total_active)),
      word: 'cadastros', noun: 'os cadastros ativos', source: `${cnpj}; só tipos do catálogo`,
    },
    {
      label: 'Cadastros por 1.000 habitantes', values: of(loaded((s) => (s.population ? (s.coverage.total_active / s.population) * 1000 : null))),
      decimals: 1, word: 'cadastros por 1.000 habitantes', noun: 'os cadastros por 1.000 habitantes',
      source: `calculado a partir de: cadastros ativos (${cnpj}) e população (${IBGE})`,
    },
    {
      label: 'Cobertura', values: of(loaded((s) => s.coverage.share * 100)), unit: '%', kind: 'pp',
      source: `${cnpj}; parte dos cadastros localizada em um bairro`,
    },
    {
      label: 'Renda mediana da cidade', values: of((s) => (s.income?.available ? s.income.median : null)), prefix: 'R$ ', unit: '/mês', kind: 'money',
      noun: 'a renda mediana', source: income,
    },
  ];
  return rows.map((r) => ({ decimals: 0, unit: '', prefix: '', ...r, ...diff(r, a.name, b.name) }));
}

// Diferença em número e em razão; o maior valor da linha leva o índice em `max` (a tela escreve "maior" junto).
function diff({ values: [va, vb], decimals = 0, kind, word, noun }, na, nb) {
  if (va == null || vb == null) return { text: MISSING, max: null, ratio: false };
  const p = 10 ** decimals, ra = Math.round(va * p) / p, rb = Math.round(vb * p) / p;
  if (ra === rb) return { text: 'mesmo valor nas duas cidades', max: null, ratio: false };
  const hi = ra > rb ? 0 : 1, d = Math.abs(ra - rb), lo = hi ? ra : rb;
  if (kind === 'pp') return { text: `diferença de ${num(d, 0)} ${d === 1 ? 'ponto percentual' : 'pontos percentuais'}`, max: hi, ratio: false };
  const amount = kind === 'money' ? `R$ ${num(d, 0)}/mês` : `${num(d, decimals)} ${word}`;
  const ratio = lo > 0 ? `${[na, nb][hi]} tem ${fmt.dec((hi ? rb : ra) / lo, 1)}x ${noun} de ${[na, nb][1 - hi]}` : '';
  return { text: ratio ? `${ratio}; diferença de ${amount}` : `diferença de ${amount}`, max: hi, ratio: !!ratio };
}
