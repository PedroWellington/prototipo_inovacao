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

// Interpola a cor da nota (0–100) entre as 5 paradas da escala (vermelho → verde).
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
