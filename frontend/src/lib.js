// Funções puras (testadas em lib.test.js). Nenhuma calcula nota: as notas vêm do backend.

// Caixa envolvente [[oeste, sul], [leste, norte]] de uma Feature ou FeatureCollection GeoJSON.
export function bbox(geojson) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
    } else c.forEach(visit);
  };
  const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
  features.forEach((f) => f.geometry && visit(f.geometry.coordinates));
  return [[w, s], [e, n]];
}

export function debounce(fn, ms) {
  let t;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

// Interpola a cor da nota (0–100) entre as 5 paradas da escala (combina menos → combina mais).
export function scoreColor(score, stops) {
  const x = Math.max(0, Math.min(100, score)) / 25; // 0..4
  const i = Math.min(3, Math.floor(x));
  const t = x - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`;
}

export function hexToRgb(hex) {
  const h = hex.trim().replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

export const COVERAGE_LABEL = { high: 'alta', medium: 'média', low: 'baixa' };
export const DIRECTION_LABEL = { attract: 'perto', repel: 'longe' };

export function establishmentsText(n) {
  return n === 1 ? '1 estabelecimento' : `${new Intl.NumberFormat('pt-BR').format(n)} estabelecimentos`;
}

// Filtra por texto ignorando acento e caixa.
export function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Rótulo honesto do que é contado: o CNAE principal do CNPJ, não o prédio nem a marca.
export function activityText(n, typeName) {
  const what = `com atividade principal de ${typeName.toLowerCase()}`;
  return n === 1 ? `1 estabelecimento ${what}` : `${new Intl.NumberFormat('pt-BR').format(n)} estabelecimentos ${what}`;
}

export const brl = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

// Ranking de cidades: a API responde em colunas (columns + rows) para caber na meta de 150 ms.
// Aqui só se remonta cada cidade; nenhuma nota é calculada (score e rank vêm do SQL).
export function cityRankRows(res) {
  const inc = res.income;
  return res.rows.map((row) => {
    const c = Object.fromEntries(res.columns.map((k, i) => [k, row[i]]));
    c.label = c.lx != null ? [c.lx, c.ly] : null;
    c.criteria = res.criteria.map((k, j) => ({
      type: k.business_type_key,
      direction: k.direction,
      weight: k.weight,
      n: c.n[j],
      n_cnpj: c.n_cnpj ? c.n_cnpj[j] : null,
      per_10k: c.per_10k[j],
      per_km2: c.per_km2[j],
      lower: c.lower_share[j],
      higher: c.higher_share[j],
    }));
    c.coverage = { total_active: c.total_active, located: c.located, share: c.total_active ? c.located / c.total_active : 0 };
    c.income =
      c.income_median == null
        ? { available: false, label: 'Renda mediana da cidade', message: inc.missing, note: inc.note, source: inc.source }
        : { available: true, label: 'Renda mediana da cidade', median: c.income_median, quartile: c.income_quartile, text: `Renda mediana da cidade: ${brl(c.income_median)}/mês`, approximate: false, note: inc.note, source: inc.source };
    return c;
  });
}

// Mesma regra da frase dos bairros (backend/app/scoring/rank.py): "perto" mostra o lado "mais que"; "longe", o "menos que".
export function cityComparisonText(direction, lower, higher, unit) {
  if (lower === 0 && higher === 0) return `mesmo valor de ${unit} que as demais cidades`;
  const more = `mais ${unit} que ${Math.round(lower * 100)}% das cidades analisadas`;
  const less = `menos ${unit} que ${Math.round(higher * 100)}% das cidades analisadas`;
  if (direction === 'attract') return lower > 0 ? more : less;
  return higher > 0 ? less : more;
}

// Contagem com a fonte do tipo: CNES (unidades de saúde) ou CNPJ (locais com a atividade principal).
// Para tipos do CNES, o CNPJ aparece como complemento.
export function countText(n, nCnpj, type) {
  if (type.source !== 'cnes') return activityText(n, type.name);
  const fmtN = new Intl.NumberFormat('pt-BR').format;
  const main = n === 1 ? '1 unidade ativa no CNES' : `${fmtN(n)} unidades ativas no CNES`;
  return `${main} (Ministério da Saúde); complemento: ${nCnpj === 1 ? '1 local' : `${fmtN(nCnpj)} locais`} com CNPJ de atividade principal de ${type.name.toLowerCase()}`;
}

// Faixas de faturamento (as mesmas do onboarding). Só exibidas; não entram em nenhum cálculo.
export const REVENUE = [
  ['ate_81k', 'Até R$ 81 mil'],
  ['81k_360k', 'R$ 81 mil a R$ 360 mil'],
  ['360k_4_8m', 'R$ 360 mil a R$ 4,8 milhões'],
  ['4_8m_30m', 'R$ 4,8 milhões a R$ 30 milhões'],
  ['30m_200m', 'R$ 30 milhões a R$ 200 milhões'],
  ['acima_200m', 'Acima de R$ 200 milhões'],
  ['nao_informar', 'Prefiro não informar'],
];
export const REVENUE_LABEL = Object.fromEntries(REVENUE);

// Iniciais para o avatar sem logo: primeira letra das duas primeiras palavras significativas.
export function initials(name) {
  const words = (name || '').split(/\s+/).filter((w) => w && !/^(de|da|do|das|dos|e|&)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
}

// Texto da confirmação de gasto (o servidor é quem cobra; isto só informa).
export function spendText(cost, balance) {
  const c = cost === 1 ? '1 crédito' : `${cost} créditos`;
  return `Isto usa ${c}. Restam ${balance} (depois desta análise: ${balance - cost}).`;
}

// Primeiro nome capitalizado para a saudação ("ana MARIA" -> "Ana").
export function firstName(name) {
  const w = (name || '').trim().split(/\s+/)[0] || '';
  return w ? w[0].toLocaleUpperCase('pt-BR') + w.slice(1).toLocaleLowerCase('pt-BR') : '';
}

// Última cidade analisada (a liberada mais recentemente, vencida ou não) e as cidades ainda no prazo.
export function lastCity(state) {
  return [...(state?.cities || [])].sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at))[0] || null;
}
export const activeCities = (state) => (state?.cities || []).filter((c) => c.active);
