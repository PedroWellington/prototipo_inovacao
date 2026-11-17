// Hero da landing (docs/HERO-360.md): o mesmo motor do explorador, decorativo. MapLibre com os tiles do OSM e o
// estilo do mapa (map/mapView.js), bairros reais do IBGE (os mesmos arquivos que a landing já baixa) e o mesmo
// holograma (map/hologram.js, mesmo manifesto e mesma arte). A landing chama render(q) a cada quadro com o
// progresso da cena (0..1, já suavizado); aqui só se calcula a câmera e se aplica com jumpTo.
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
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (t) => t * t * (3 - 2 * t);
const span = (q, a, b) => smooth(clamp((q - a) / (b - a)));

// TopoJSON da landing (Web Mercator em metros, data/recife-2.json) -> GeoJSON em graus, para o MapLibre.
export function topoToGeoJSON(topo, name) {
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
    properties: { ...(g.properties || {}), tint: index % 8 },
    geometry: g.type === 'Polygon'
      ? { type: 'Polygon', coordinates: g.arcs.map(ring) }
      : { type: 'MultiPolygon', coordinates: g.arcs.map((p) => p.map(ring)) },
  }));
  return { type: 'FeatureCollection', features };
}
const bboxOf = (fc) => {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c) => (typeof c[0] === 'number' ? ((b[0] = Math.min(b[0], c[0])), (b[1] = Math.min(b[1], c[1])), (b[2] = Math.max(b[2], c[0])), (b[3] = Math.max(b[3], c[1]))) : c.forEach(walk));
  fc.features.forEach((f) => walk(f.geometry.coordinates));
  return [[b[0], b[1]], [b[2], b[3]]];
};

// host: <div class="hero-map" data-theme="dark"> (tokens do mapa em hero.css). palette: tons da landing (não é nota).
export async function createHeroMap(host, { topo, focus, palette, focusColor, mobile = false, reduced = false }) {
  const mapEl = host.querySelector('.hero-map-canvas');
  const holoEl = host.querySelector('.hero-holo');
  const hoods = topoToGeoJSON(topo, 'bairros');
  const focusId = hoods.features.find((f) => f.properties.name === focus.name)?.id ?? -1;
  // Mesmo estilo do explorador; só aqui os tiles raster do OSM (256 px) são pintados como 512: o mapa pede um nível
  // de zoom abaixo e desenha ~4× menos tiles por quadro. Medido: era o maior custo da cena inclinada com CPU 4×
  // (cálculo de matriz e desenho por tile). O mapa-base fica escurecido sob os bairros, então a nitidez perdida não aparece.
  const style = baseStyle(host);
  style.sources.osm.tileSize = 512;
  const map = new maplibregl.Map({
    container: mapEl,
    style,
    bounds: bboxOf(hoods),
    interactive: false, // decorativo: a rolagem da página é que move a câmera
    attributionControl: { compact: false },
    fadeDuration: 0,
    maxPitch: 60,
    maxTileCacheSize: 800, // os tiles pré-carregados do enquadramento final não saem do cache no meio do movimento
    preserveDrawingBuffer: false,
  });
  const loaded = new Promise((ok, fail) => {
    map.once('load', ok);
    map.once('error', (e) => fail(e.error || e));
  });
  await loaded;
  map.addSource('hoods', { type: 'geojson', data: hoods });
  const tints = ['match', ['get', 'tint'], ...palette.flatMap((c, i) => [i, c]), palette[0]];
  map.addLayer({ id: 'hoods-fill', type: 'fill', source: 'hoods', paint: {
    'fill-color': ['case', ['==', ['id'], focusId], focusColor, tints],
    'fill-opacity': ['case', ['==', ['id'], focusId], 0.78, 0.55], // o mapa-base continua aparecendo por baixo
  } });
  map.addLayer({ id: 'hoods-line', type: 'line', source: 'hoods', paint: {
    'line-color': ['case', ['==', ['id'], focusId], getComputedStyle(host).getPropertyValue('--color-selected').trim(), getComputedStyle(host).getPropertyValue('--map-line').trim()],
    'line-width': ['case', ['==', ['id'], focusId], 2.5, 0.8],
  } });

  // Câmera: começa vendo a cidade inteira de cima e termina inclinada sobre o bairro, no zoom do holograma.
  // Zoom final um pouco mais aberto que o do explorador (HOLO_ZOOM 14,5): com a inclinação, o bairro e o entorno cabem.
  const P_END = mobile ? 48 : 58, B_END = -18, Z_END = mobile ? 13.3 : 13.7;
  let start = null; // { c: [x, y] mercator, z }
  const merc = (ll) => maplibregl.MercatorCoordinate.fromLngLat(ll);
  const end = { c: merc(focus.lngLat), z: Z_END };
  let area = { left: 0, top: 0, right: 0, bottom: 0 }; // área livre do holograma, em px da tela (medida só no resize)
  function measure() {
    area = { left: 0, top: 0, right: host.clientWidth, bottom: host.clientHeight };
    const cam = map.cameraForBounds(bboxOf(hoods), { padding: mobile ? 24 : 60, bearing: 0, pitch: 0 });
    start = { c: merc(cam.center), z: cam.zoom };
  }
  measure();
  const holo = createHologram(holoEl, { project: (ll) => map.project(ll), area: () => area, stride: mobile ? 3 : 1 });
  let lastKey = '';
  function camera(q) {
    const z = start.z + (end.z - start.z) * smooth(q);
    // Centro compensado pelo zoom: o bairro de destino anda na tela em ritmo constante, sem escorregar.
    const w = (1 - 2 ** (start.z - z)) / (1 - 2 ** (start.z - end.z) || 1);
    const x = start.c.x + (end.c.x - start.c.x) * w, y = start.c.y + (end.c.y - start.c.y) * w;
    const tilt = span(q, 0.2, 1);
    // Espaço acima do bairro para o holograma. No celular o texto ocupa o meio da tela: o bairro desce mais.
    const reserve = area.bottom * (mobile ? 0.5 : 0.28) * tilt;
    return {
      center: new maplibregl.MercatorCoordinate(x, y).toLngLat(),
      zoom: z,
      pitch: P_END * tilt,
      bearing: B_END * span(q, 0.3, 1),
      padding: { top: reserve, bottom: 0, left: 0, right: 0 },
    };
  }
  function render(q) {
    q = clamp(q);
    const key = q.toFixed(5);
    if (key === lastKey) return; // nada mudou: não redesenha
    lastKey = key;
    map.jumpTo(camera(q));
    holo.set(0, { lngLat: focus.lngLat, rise: span(q, 0.68, 0.95) });
    holo.follow();
  }
  // Pré-carrega tiles do caminho e do enquadramento final (invisível) e os quadros do holograma, antes da cena.
  const idleOrTimeout = () => new Promise((ok) => { map.once('idle', ok); setTimeout(ok, 6000); });
  async function preload() {
    for (const q of [1, 0.9, 0.8, 0.65, 0.5, 0.35, 0.2]) {
      map.jumpTo(camera(q));
      await idleOrTimeout();
    }
    lastKey = '';
    render(reduced ? 1 : 0);
    await idleOrTimeout();
  }
  const holoLoaded = holo.load();
  await preload();
  await Promise.race([holoLoaded, new Promise((ok) => setTimeout(ok, 8000))]);
  return {
    render,
    resize() {
      map.resize();
      measure();
      lastKey = '';
    },
    stats: () => ({ tiles: map.areTilesLoaded(), holo: holo.stats() }),
    map,
  };
}
