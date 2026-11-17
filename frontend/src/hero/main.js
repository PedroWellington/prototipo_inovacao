// Hero da landing (docs/HERO-360.md): o mesmo motor do explorador, decorativo. MapLibre com os tiles do OSM e o
// estilo do mapa (map/mapView.js), as malhas do IBGE que a landing já baixa (Brasil, Nordeste, Pernambuco, Recife,
// bairros) e o mesmo holograma (map/hologram.js, mesmo manifesto e mesma arte).
// Este módulo NÃO tem câmera própria: a landing calcula, a cada quadro, a vista da linha do tempo única do hero
// (landing/js/landing.js, KF) e a opacidade de cada camada; aqui só se aplica (jumpTo + opacidade). Assim não há
// enquadramento por capítulo nem salto entre o mapa em canvas e este: os dois usam a mesma câmera.
import maplibregl from 'maplibre-gl';
import { baseStyle } from '../map/mapView.js';
import { createHologram } from '../map/hologram.js';
// CSS dos mesmos componentes, embutido: a landing importa só este arquivo (o CSS do app vem pelo HTML do app).
import mapCss from 'maplibre-gl/dist/maplibre-gl.css?inline';
import holoCss from '../styles/hologram.css?inline';
import heroCss from './hero.css?inline';

const style = document.createElement('style');
style.textContent = mapCss + holoCss + heroCss;
document.head.append(style);

const R = 6378137;
const toLngLat = (x, y) => [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];

// TopoJSON da landing (Web Mercator em metros, landing/data/*.json) -> GeoJSON em graus, para o MapLibre.
export function topoToGeoJSON(topo, name, props = () => ({})) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => ((x += dx), (y += dy), toLngLat(x * sx + tx, y * sy + ty)));
  });
  const ring = (ids) => ids.flatMap((i, k) => {
    const a = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
    return k ? a.slice(1) : a;
  });
  const features = topo.objects[name].geometries.map((g, index) => ({
    type: 'Feature',
    id: index,
    properties: { ...(g.properties || {}), ...props(g.properties || {}, index) },
    geometry: g.type === 'Polygon'
      ? { type: 'Polygon', coordinates: g.arcs.map(ring) }
      : { type: 'MultiPolygon', coordinates: g.arcs.map((p) => p.map(ring)) },
  }));
  return { type: 'FeatureCollection', features };
}

const NE = new Set(['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']);
// Camadas do mergulho, de baixo para cima. A opacidade vem da landing (a mesma agenda do mapa em canvas).
// maxzoom: até onde a fonte é recortada em tiles; acima disso o mapa amplia o tile que já tem (sem recortar de novo
// a cada nível de zoom do mergulho). Ajustado à escala em que cada camada aparece na linha do tempo.
const LAYERS = [
  { key: 'estados', fill: 0.62, line: 0.5, maxzoom: 7 },
  { key: 'nordeste', fill: 0.5, line: 0.75, maxzoom: 7 },
  { key: 'municipios', fill: 0, line: 0.35, maxzoom: 10 },
  { key: 'pe', fill: 0.5, line: 0.85, maxzoom: 10 },
  { key: 'recife', fill: 0.42, line: 0.8, maxzoom: 13 },
  { key: 'bairros', fill: 0.55, line: 0.6, maxzoom: 15 },
];

// host: <div class="hero-map" data-theme="dark">. colors: tons da landing (os mesmos do canvas; não são nota).
// viewAt(p) e alphasAt(p): a vista e as opacidades da linha do tempo da landing; aqui só servem para pré-carregar o caminho.
export async function createHeroMap(host, { topos, focus, colors, mobile = false, viewAt, alphasAt }) {
  const mapEl = host.querySelector('.hero-map-canvas');
  const holoEl = host.querySelector('.hero-holo');
  const data = {
    estados: topoToGeoJSON(topos.brasil, 'estados', (p) => ({ ne: NE.has(p.uf) })),
    nordeste: topoToGeoJSON(topos.brasil, 'nordeste'),
    municipios: topoToGeoJSON(topos.pe, 'municipios'),
    pe: topoToGeoJSON(topos.pe, 'pernambuco'),
    recife: topoToGeoJSON(topos.recife, 'cidade'),
    bairros: topoToGeoJSON(topos.recife, 'bairros', (p, i) => ({ tint: i % colors.palette.length, focus: p.name === focus.name })),
  };
  // Mesmo estilo do explorador; só aqui os tiles raster do OSM (256 px) são pintados como 512: o mapa pede um nível
  // de zoom abaixo e desenha ~4× menos tiles por quadro (era o maior custo da cena inclinada; docs/PERFORMANCE.md).
  const style = baseStyle(host);
  style.sources.osm.tileSize = 512;
  const first = viewAt(0);
  const map = new maplibregl.Map({
    container: mapEl,
    style,
    center: first.center,
    zoom: first.zoom,
    interactive: false, // decorativo: a rolagem da página é que move a câmera
    attributionControl: { compact: false },
    fadeDuration: 0,
    maxPitch: 60,
    minZoom: 0,
    maxTileCacheSize: 1200, // os tiles pré-carregados do caminho não saem do cache no meio do movimento
  });
  await new Promise((ok, fail) => {
    map.once('load', ok);
    map.once('error', (e) => fail(e.error || e));
  });
  // A cena é decorativa (aria-hidden): nada dentro dela pode receber foco. A atribuição do OSM continua visível; o
  // link dela e o canvas saem da ordem de tabulação, também quando o MapLibre os recria.
  const unfocus = () => host.querySelectorAll('a, button, canvas, [tabindex]').forEach((el) => el.getAttribute('tabindex') !== '-1' && el.setAttribute('tabindex', '-1'));
  new MutationObserver(unfocus).observe(host, { childList: true, subtree: true });
  unfocus();
  const fills = {
    estados: ['case', ['get', 'ne'], colors.ne, colors.ufs],
    nordeste: colors.nordeste,
    municipios: colors.ufs,
    pe: colors.pe,
    recife: colors.recife,
    bairros: ['case', ['get', 'focus'], colors.focus, ['match', ['get', 'tint'], ...colors.palette.flatMap((c, i) => [i, c]), colors.palette[0]]],
  };
  for (const { key, maxzoom } of LAYERS) {
    map.addSource(key, { type: 'geojson', data: data[key], maxzoom });
    map.addLayer({ id: `${key}-fill`, type: 'fill', source: key, layout: { visibility: 'none' }, paint: { 'fill-color': fills[key], 'fill-opacity': 0 } });
    map.addLayer({ id: `${key}-line`, type: 'line', source: key, paint: {
      'line-color': key === 'bairros' ? ['case', ['get', 'focus'], colors.focusBorder, colors.border[key]] : colors.border[key],
      'line-width': key === 'bairros' ? ['case', ['get', 'focus'], 2.5, 0.8] : key === 'municipios' ? 0.5 : 1.1,
      'line-opacity': 0,
    }, layout: { visibility: 'none' } });
  }

  let area = { left: 0, top: 0, right: host.clientWidth, bottom: host.clientHeight }; // área do holograma (px), medida no resize
  const holo = createHologram(holoEl, { project: (ll) => map.project(ll), area: () => area, stride: mobile ? 3 : 1 });
  const shown = {}; // opacidade aplicada por camada: só chama setPaintProperty quando muda
  let lastKey = '';
  function render({ center, zoom, pitch, bearing, padding, alphas, rise }) {
    const key = `${center[0].toFixed(7)},${center[1].toFixed(7)},${zoom.toFixed(5)},${pitch.toFixed(3)},${bearing.toFixed(3)},${padding.top.toFixed(1)},${padding.left.toFixed(1)},${padding.right.toFixed(1)}`;
    if (key !== lastKey) {
      lastKey = key;
      map.jumpTo({ center, zoom, pitch, bearing, padding });
    }
    for (const { key: k, fill, line } of LAYERS) {
      const a = Math.round((alphas[k] || 0) * 100) / 100;
      if (shown[k] === a) continue;
      // Camada invisível fica 'none': o MapLibre não recorta nem desenha os tiles dela (só 2 ou 3 ativas por vez).
      const vis = a > 0 ? 'visible' : 'none';
      if ((shown[k] > 0 ? 'visible' : 'none') !== vis || shown[k] === undefined) {
        map.setLayoutProperty(`${k}-fill`, 'visibility', vis);
        map.setLayoutProperty(`${k}-line`, 'visibility', vis);
      }
      shown[k] = a;
      map.setPaintProperty(`${k}-fill`, 'fill-opacity', a * fill);
      map.setPaintProperty(`${k}-line`, 'line-opacity', a * line);
    }
    holo.set(0, { lngLat: focus.lngLat, rise });
    holo.follow();
  }
  // Pré-carrega, invisível, os tiles de pontos ao longo do caminho (do bairro ao Brasil) e os quadros do holograma.
  const idleOrTimeout = () => new Promise((ok) => { map.once('idle', ok); setTimeout(ok, 5000); });
  for (const p of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.64, 0.58, 0.5, 0.42, 0.3, 0.15, 0]) {
    render({ ...viewAt(p), alphas: alphasAt(p), rise: 0 }); // câmera e camadas daquele ponto: os tiles delas entram no cache
    await idleOrTimeout();
  }
  lastKey = '';
  const holoLoaded = holo.load();
  await Promise.race([holoLoaded, new Promise((ok) => setTimeout(ok, 8000))]);
  return {
    render,
    project: (ll) => map.project(ll),
    resize() {
      map.resize();
      area = { left: 0, top: 0, right: host.clientWidth, bottom: host.clientHeight };
      lastKey = '';
    },
    stats: () => ({ tiles: map.areTilesLoaded(), holo: holo.stats(), zoom: map.getZoom() }),
  };
}
