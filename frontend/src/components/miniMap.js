// Miniatura da geometria real (bairros de uma cidade) em SVG: sem mapa-base, só os limites do IBGE.
// fill(id) devolve a cor de cada área (ex.: pela nota que veio do banco) ou null para o tom neutro.
import { html, raw } from '../html.js';

export function miniMap(geo, { fill = () => null, highlight = null, label = 'Miniatura dos limites' } = {}) {
  const feats = geo?.features || [];
  if (!feats.length) return '';
  const rings = (g) => (g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : []);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of feats) for (const r of rings(f.geometry)) for (const [x, y] of r) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180); // equirretangular com correção de latitude
  const w = (x1 - x0) * k || 1, h = y1 - y0 || 1, S = 300 / Math.max(w, h);
  const W = w * S, H = h * S;
  const pt = ([x, y]) => `${((x - x0) * k * S).toFixed(1)} ${((y1 - y) * S).toFixed(1)}`;
  const d = (f) => rings(f.geometry).map((r) => 'M' + r.map(pt).join('L') + 'Z').join('');
  const paths = feats
    .map((f) => {
      const id = f.id ?? f.properties?.id;
      const c = fill(id);
      return `<path d="${d(f)}" class="mm-area${id === highlight ? ' is-hl' : ''}"${c ? ` style="fill:${c}"` : ''}/>`;
    })
    .join('');
  // O destacado vai por último para o contorno ficar por cima.
  const hl = feats.find((f) => (f.id ?? f.properties?.id) === highlight);
  return html`<svg class="mini-map" viewBox="-4 -4 ${(W + 8).toFixed(0)} ${(H + 8).toFixed(0)}" role="img" aria-label="${label}">${raw(paths)}${hl ? raw(`<path d="${d(hl)}" class="mm-hl"/>`) : ''}</svg>`;
}
