import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

const EMPTY = { type: 'FeatureCollection', features: [] };
const LEVEL_LAYERS = {
  region: ['regions-fill', 'regions-line'],
  state: ['states-fill', 'states-line'],
  city: ['munis-fill', 'munis-line'],
  result: ['hoods-fill', 'hoods-line', 'badges-top', 'badges-rest'],
};
const ALL_LAYERS = Object.values(LEVEL_LAYERS).flat();
const CAMERA = { duration: 800, padding: 48, essential: true };

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function baseStyle() {
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        // shortcut: tiles públicos do OSM só servem para desenvolvimento; trocar de provedor antes de produção (docs/EXTENSIONS.md).
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': css('--color-bg') } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.85, 'raster-opacity': 0.85, 'raster-contrast': -0.05 } },
    ],
  };
}

const hover = (on, off) => ['case', ['boolean', ['feature-state', 'hover'], false], on, off];

function addLayers(map) {
  const accent = css('--color-accent');
  const stops = [1, 2, 3, 4, 5].map((i) => css(`--score-${i}`));
  const text = css('--color-text');
  for (const id of ['regions', 'states', 'munis', 'hoods', 'labels']) {
    map.addSource(id, { type: 'geojson', data: EMPTY, promoteId: 'id' });
  }
  map.addLayer({ id: 'regions-fill', type: 'fill', source: 'regions', paint: { 'fill-color': accent, 'fill-opacity': hover(0.38, 0.16) } });
  map.addLayer({ id: 'regions-line', type: 'line', source: 'regions', paint: { 'line-color': accent, 'line-width': 1.2 } });
  map.addLayer({ id: 'states-fill', type: 'fill', source: 'states', paint: { 'fill-color': accent, 'fill-opacity': hover(0.4, 0.14) } });
  map.addLayer({ id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': accent, 'line-width': 1 } });
  map.addLayer({
    id: 'munis-fill',
    type: 'fill',
    source: 'munis',
    paint: {
      'fill-color': ['case', ['boolean', ['feature-state', 'hasData'], false], accent, css('--color-text-subtle')],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hasData'], false],
        hover(0.75, 0.5),
        hover(0.16, 0.05),
      ],
    },
  });
  map.addLayer({ id: 'munis-line', type: 'line', source: 'munis', paint: { 'line-color': css('--color-border-strong'), 'line-width': 0.6 } });
  map.addLayer({
    id: 'hoods-fill',
    type: 'fill',
    source: 'hoods',
    paint: {
      // Cor pela nota que veio do backend (feature-state): recolorir não recria camada nem fonte.
      'fill-color': [
        'case',
        ['==', ['typeof', ['feature-state', 'score']], 'number'],
        ['interpolate', ['linear'], ['feature-state', 'score'], 0, stops[0], 25, stops[1], 50, stops[2], 75, stops[3], 100, stops[4]],
        css('--score-none'),
      ],
      'fill-opacity': hover(0.9, 0.72),
    },
  });
  map.addLayer({
    id: 'hoods-line',
    type: 'line',
    source: 'hoods',
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], text, '#ffffff'],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, ['boolean', ['feature-state', 'hover'], false], 2, 0.8],
    },
  });
  // Número da posição: ícones desenhados em canvas (não depende de servidor de fontes).
  const badge = (id, filter, minzoom) =>
    map.addLayer({
      id,
      type: 'symbol',
      source: 'labels',
      minzoom,
      filter,
      layout: {
        'icon-image': ['concat', 'rank-', ['to-string', ['get', 'rank']]],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'rank'],
      },
    });
  badge('badges-top', ['<=', ['get', 'rank'], 10], 0);
  badge('badges-rest', ['>', ['get', 'rank'], 10], 12.4);
}

function drawBadge(n) {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const label = String(n);
  const w = (label.length > 2 ? 30 : 24) * ratio;
  const h = 24 * ratio;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.strokeStyle = css('--color-text');
  g.lineWidth = 1.5 * ratio;
  g.beginPath();
  g.roundRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, h / 2);
  g.fill();
  g.stroke();
  g.fillStyle = css('--color-text');
  g.font = `700 ${12 * ratio}px ${css('--font-sans')}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, w / 2, h / 2 + ratio * 0.5);
  return { image: g.getImageData(0, 0, w, h), ratio };
}

export function createMap(container, handlers) {
  const map = new maplibregl.Map({
    container,
    style: baseStyle(),
    bounds: [[-74, -34], [-34, 5.5]],
    fitBoundsOptions: { padding: 24 },
    attributionControl: { compact: false },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  const ready = new Promise((resolve) => map.on('load', resolve)).then(() => addLayers(map));
  map.on('styleimagemissing', (e) => {
    const m = /^rank-(\d+)$/.exec(e.id);
    if (!m || map.hasImage(e.id)) return;
    const { image, ratio } = drawBadge(Number(m[1]));
    map.addImage(e.id, image, { pixelRatio: ratio });
  });

  // Hover por feature-state, sem rede e sem re-render.
  const hovered = {};
  const sourceOf = { 'regions-fill': 'regions', 'states-fill': 'states', 'munis-fill': 'munis', 'hoods-fill': 'hoods' };
  for (const [layer, source] of Object.entries(sourceOf)) {
    map.on('mousemove', layer, (e) => {
      const f = e.features[0];
      if (hovered[source] !== f.id) {
        if (hovered[source] != null) map.setFeatureState({ source, id: hovered[source] }, { hover: false });
        hovered[source] = f.id;
        map.setFeatureState({ source, id: f.id }, { hover: true });
      }
      map.getCanvas().style.cursor = 'pointer';
      handlers.onHover?.(source, f, e.point);
    });
    map.on('mouseleave', layer, () => {
      if (hovered[source] != null) map.setFeatureState({ source, id: hovered[source] }, { hover: false });
      hovered[source] = null;
      map.getCanvas().style.cursor = '';
      handlers.onHover?.(source, null);
    });
    map.on('click', layer, (e) => handlers.onClick?.(source, e.features[0], e.point));
  }

  let selected = null;
  let hoodIds = [];

  const api = {
    ready,
    raw: map,
    async setLevel(level) {
      await ready;
      for (const id of ALL_LAYERS) map.setLayoutProperty(id, 'visibility', LEVEL_LAYERS[level].includes(id) ? 'visible' : 'none');
    },
    async setData(source, fc) {
      await ready;
      map.getSource(source).setData(fc);
    },
    async filterStates(regionId) {
      await ready;
      const f = ['==', ['get', 'region_id'], regionId];
      map.setFilter('states-fill', f);
      map.setFilter('states-line', f);
    },
    async markMunicipalities(ids) {
      await ready;
      for (const id of ids) map.setFeatureState({ source: 'munis', id }, { hasData: true });
    },
    fit(bounds, opts = {}) {
      map.fitBounds(bounds, { ...CAMERA, ...opts });
    },
    async setHoods(fc) {
      await ready;
      hoodIds = fc.features.map((f) => f.id);
      map.getSource('hoods').setData(fc);
    },
    // Recolore e renumera sem tocar na geometria: só feature-state + a fonte de pontos dos números.
    async applyRank(neighborhoods, labelPoints) {
      await ready;
      const byId = new Map(neighborhoods.map((n) => [n.id, n]));
      for (const id of hoodIds) {
        const n = byId.get(id);
        map.setFeatureState({ source: 'hoods', id }, { score: n ? n.score : null });
      }
      map.getSource('labels').setData({
        type: 'FeatureCollection',
        features: neighborhoods
          .filter((n) => labelPoints.has(n.id))
          .map((n) => ({ type: 'Feature', id: n.id, properties: { id: n.id, rank: n.rank }, geometry: { type: 'Point', coordinates: labelPoints.get(n.id) } })),
      });
    },
    async clearRank() {
      await ready;
      for (const id of hoodIds) map.setFeatureState({ source: 'hoods', id }, { score: null });
      map.getSource('labels').setData(EMPTY);
    },
    select(id) {
      if (selected != null) map.setFeatureState({ source: 'hoods', id: selected }, { selected: false });
      selected = id;
      if (id != null) map.setFeatureState({ source: 'hoods', id }, { selected: true });
    },
    resize: () => map.resize(),
    destroy: () => map.remove(),
  };
  return api;
}
