import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cameraStep, ease } from './camera.js';

const EMPTY = { type: 'FeatureCollection', features: [] };
const LEVEL_LAYERS = {
  region: ['regions-fill', 'regions-line'],
  state: ['states-fill', 'states-line'],
  city: ['munis-fill', 'munis-line'],
  result: ['hoods-fill', 'hoods-line', 'badges-top', 'badges-rest'],
  cities: ['cities-fill', 'cities-line', 'city-badges-top', 'city-badges-rest'],
};
// Municípios do Brasil em tiles vetoriais (ST_AsMVT no backend): feature-state precisa da camada do tile.
const VECTOR = { cities: 'munis' };
const target = (source, id) => (VECTOR[source] ? { source, sourceLayer: VECTOR[source], id } : { source, id });
const ALL_LAYERS = Object.values(LEVEL_LAYERS).flat();
const PAD = 48;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      { id: 'osm', type: 'raster', source: 'osm', // Sem fade de entrada: na inclinação, tiles novos com fade obrigavam a desenhar duas camadas por quadro.
        paint: { ...themePaints().osm, 'raster-fade-duration': 0 } },
    ],
  };
}

const hover = (on, off) => ['case', ['boolean', ['feature-state', 'hover'], false], on, off];
const dark = () => document.documentElement.dataset.theme === 'dark';

// Cores que dependem do tema (tokens), por camada. Usadas ao criar as camadas e reaplicadas na troca de tema
// com setPaintProperty: instantâneo, mesmos tiles, mesma fonte. Os mesmos layers nos dois temas.
function themePaints() {
  const accent = css('--color-accent');
  const text = css('--color-text');
  const line = css('--map-line');
  const stops = [1, 2, 3, 4, 5].map((i) => css(`--score-${i}`));
  const scoreFill = [
    'case',
    ['==', ['typeof', ['feature-state', 'score']], 'number'],
    ['interpolate', ['linear'], ['feature-state', 'score'], 0, stops[0], 25, stops[1], 50, stops[2], 75, stops[3], 100, stops[4]],
    css('--score-none'),
  ];
  return {
    bg: { 'background-color': css('--color-bg') },
    // Escuro: mapa-base raster escurecido e sem cor (só pintura; nada é recarregado).
    osm: dark()
      ? { 'raster-saturation': -1, 'raster-brightness-max': 0.4, 'raster-brightness-min': 0.05, 'raster-contrast': -0.15, 'raster-opacity': 0.9 }
      : { 'raster-saturation': -0.85, 'raster-brightness-max': 1, 'raster-brightness-min': 0, 'raster-contrast': -0.05, 'raster-opacity': 0.85 },
    'regions-fill': { 'fill-color': accent },
    'regions-line': { 'line-color': accent },
    'states-fill': { 'fill-color': accent },
    'states-line': { 'line-color': accent },
    'munis-fill': { 'fill-color': ['case', ['boolean', ['feature-state', 'hasData'], false], accent, css('--color-text-subtle')] },
    'munis-line': { 'line-color': css('--color-border-strong') },
    'hoods-fill': { 'fill-color': scoreFill },
    'hoods-line': { 'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], css('--color-selected'), line] },
    'cities-fill': { 'fill-color': scoreFill },
    'cities-line': { 'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], text, line] },
  };
}

function addLayers(map, opts) {
  const P = themePaints();
  for (const id of ['regions', 'states', 'munis', 'hoods', 'labels', 'cityLabels']) {
    map.addSource(id, { type: 'geojson', data: EMPTY, promoteId: 'id' });
  }
  map.addSource('cities', {
    type: 'vector',
    tiles: [`${location.origin}/api/geo/tiles/municipalities/{z}/{x}/{y}.pbf?v=${encodeURIComponent(opts.tilesVersion || '')}`],
    minzoom: 0,
    maxzoom: 12, // acima disso o MapLibre amplia o tile 12 (geometria já simplificada a ~30 m)
  });
  map.addLayer({ id: 'regions-fill', type: 'fill', source: 'regions', paint: { ...P['regions-fill'], 'fill-opacity': hover(0.38, 0.16) } });
  map.addLayer({ id: 'regions-line', type: 'line', source: 'regions', paint: { ...P['regions-line'], 'line-width': 1.2 } });
  map.addLayer({ id: 'states-fill', type: 'fill', source: 'states', paint: { ...P['states-fill'], 'fill-opacity': hover(0.4, 0.14) } });
  map.addLayer({ id: 'states-line', type: 'line', source: 'states', paint: { ...P['states-line'], 'line-width': 1 } });
  map.addLayer({
    id: 'munis-fill',
    type: 'fill',
    source: 'munis',
    paint: {
      ...P['munis-fill'],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hasData'], false],
        hover(0.75, 0.5),
        hover(0.16, 0.05),
      ],
    },
  });
  map.addLayer({ id: 'munis-line', type: 'line', source: 'munis', paint: { ...P['munis-line'], 'line-width': 0.6 } });
  // Cor pela nota que veio do backend (feature-state): recolorir não recria camada nem fonte.
  map.addLayer({ id: 'hoods-fill', type: 'fill', source: 'hoods', paint: { ...P['hoods-fill'], 'fill-opacity': hover(0.95, 0.86) } });
  map.addLayer({
    id: 'hoods-line',
    type: 'line',
    source: 'hoods',
    paint: {
      ...P['hoods-line'],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3, ['boolean', ['feature-state', 'hover'], false], 2, 0.8],
    },
  });
  map.addLayer({
    id: 'cities-fill',
    type: 'fill',
    source: 'cities',
    'source-layer': 'munis',
    paint: {
      ...P['cities-fill'],
      'fill-opacity': ['case', ['==', ['typeof', ['feature-state', 'score']], 'number'], hover(0.92, 0.75), hover(0.25, 0.12)],
    },
  });
  map.addLayer({
    id: 'cities-line',
    type: 'line',
    source: 'cities',
    'source-layer': 'munis',
    paint: { ...P['cities-line'], 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.15, 7, 0.6, 10, 1.2] },
  });
  // Número da posição: ícones desenhados em canvas (não depende de servidor de fontes).
  const badge = (id, filter, minzoom, source = 'labels') =>
    map.addLayer({
      id,
      type: 'symbol',
      source,
      minzoom,
      filter,
      layout: {
        'icon-image': ['concat', 'rank-', ['to-string', ['get', 'rank']]],
        'icon-allow-overlap': true,
        // Números sempre de frente para a tela, também com o mapa inclinado (estado do holograma).
        'icon-pitch-alignment': 'viewport',
        'icon-rotation-alignment': 'viewport',
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'rank'],
      },
    });
  badge('badges-top', ['<=', ['get', 'rank'], 10], 0);
  badge('badges-rest', ['>', ['get', 'rank'], 10], 12.4);
  badge('city-badges-top', ['<=', ['get', 'rank'], 10], 0, 'cityLabels');
  badge('city-badges-rest', ['>', ['get', 'rank'], 10], 6.5, 'cityLabels');
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
  g.fillStyle = css('--color-surface');
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

export function createMap(container, handlers, opts = {}) {
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

  const ready = new Promise((resolve) => map.on('load', resolve)).then(() => addLayers(map, opts));
  const addBadge = (n) => {
    const id = `rank-${n}`;
    if (map.hasImage(id)) return;
    const { image, ratio } = drawBadge(n);
    map.addImage(id, image, { pixelRatio: ratio });
  };
  map.on('styleimagemissing', (e) => {
    const m = /^rank-(\d+)$/.exec(e.id);
    if (m) addBadge(Number(m[1]));
  });
  // Troca de tema: só pintura (setPaintProperty) e os números refeitos no lugar (updateImage). Nada recarrega.
  // Custo medido: tudo de uma vez no clique do tema dava um quadro de ~185 ms com CPU 4x (docs/PERFORMANCE.md).
  // Agora: com o explorador escondido (outra tela aberta), só marca e aplica ao voltar; visível, a pintura vai no
  // próximo quadro e os números são redesenhados em lotes no ocioso.
  let themeDirty = false;
  const shown = () => container.closest('.view-layer')?.classList.contains('is-shown') ?? true;
  function applyTheme() {
    themeDirty = false;
    for (const [layer, props] of Object.entries(themePaints())) for (const [k, v] of Object.entries(props)) map.setPaintProperty(layer, k, v);
    const ids = map.listImages().filter((id) => /^rank-\d+$/.test(id));
    const batch = (deadline) => {
      while (ids.length && deadline.timeRemaining() > 2) {
        const id = ids.shift();
        map.updateImage(id, drawBadge(Number(id.slice(5))).image);
      }
      if (ids.length) idle(batch, { timeout: 1000 });
    };
    idle(batch, { timeout: 1000 });
  }
  const onTheme = () =>
    ready.then(() => {
      if (!shown()) themeDirty = true;
      else requestAnimationFrame(applyTheme);
    });
  document.documentElement.addEventListener('themechange', onTheme);
  // Os números acima de 10 só aparecem perto (zoom 12,4+): desenhá-los todos no primeiro zoom custava uma
  // tarefa de ~75 ms. Aqui eles são preparados antes, em lotes pequenos, quando o navegador está ocioso.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 50));
  function warmBadges(max) {
    let n = 1;
    const batch = (deadline) => {
      while (n <= max && deadline.timeRemaining() > 2) addBadge(n++);
      if (n <= max) idle(batch, { timeout: 1000 });
    };
    idle(batch, { timeout: 1000 });
  }

  // Hover por feature-state, sem rede e sem re-render.
  const hovered = {};
  const sourceOf = { 'regions-fill': 'regions', 'states-fill': 'states', 'munis-fill': 'munis', 'hoods-fill': 'hoods', 'cities-fill': 'cities' };
  for (const [layer, source] of Object.entries(sourceOf)) {
    map.on('mousemove', layer, (e) => {
      const f = e.features[0];
      if (hovered[source] !== f.id) {
        if (hovered[source] != null) map.setFeatureState(target(source, hovered[source]), { hover: false });
        hovered[source] = f.id;
        map.setFeatureState(target(source, f.id), { hover: true });
      }
      map.getCanvas().style.cursor = 'pointer';
      handlers.onHover?.(source, f, e.point);
    });
    map.on('mouseleave', layer, () => {
      if (hovered[source] != null) map.setFeatureState(target(source, hovered[source]), { hover: false });
      hovered[source] = null;
      map.getCanvas().style.cursor = '';
      handlers.onHover?.(source, null);
    });
    map.on('click', layer, (e) => handlers.onClick?.(source, e.features[0], e.point));
  }

  let selected = null;
  let hoodIds = [];
  // Faixas cobertas por painéis sobre o mapa (desktop: esquerda e direita; celular: a gaveta de baixo).
  // O mapa nunca muda de tamanho: o enquadramento só desconta essas faixas.
  const insets = { left: 0, right: 0, bottom: 0 };
  let rankedCities = [];

  // Câmera própria (map/camera.js): um loop em requestAnimationFrame com jumpTo, que para sozinho ao chegar
  // e cede ao usuário assim que ele arrasta, gira a roda ou faz pinça.
  let raf = 0;
  let goal = null;
  let last = 0;
  const merc = (lngLat) => maplibregl.MercatorCoordinate.fromLngLat(lngLat);
  function stopCamera() {
    cancelAnimationFrame(raf);
    raf = 0;
    goal = null;
  }
  function frame(t) {
    const dt = last ? t - last : 16.7;
    last = t;
    const c = map.getCenter();
    const m = merc(c);
    const r = cameraStep({ x: m.x, y: m.y, zoom: map.getZoom() }, goal, dt);
    map.jumpTo({ center: new maplibregl.MercatorCoordinate(r.cam.x, r.cam.y).toLngLat(), zoom: r.cam.zoom });
    if (r.done) return stopCamera();
    raf = requestAnimationFrame(frame);
  }
  function moveTo(center, zoom) {
    stopTilt();
    if (reducedMotion()) return map.jumpTo({ center, zoom });
    const m = merc(center);
    goal = { x: m.x, y: m.y, zoom };
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }
  // Inclinação (holograma): uma linha do tempo única, com a curva --ease, que move pitch, centro, zoom e
  // padding juntos (jumpTo por quadro) e entrega o mesmo progresso a quem desenha o holograma. Interromper
  // recomeça do ponto atual. Se o usuário arrastar no meio, centro e zoom passam a ser dele; pitch e o
  // holograma terminam o caminho (nada fica a meio caminho).
  let tilt = null;
  function stopTilt() {
    if (tilt) cancelAnimationFrame(tilt.raf);
    tilt = null;
  }
  function tiltFrame(t) {
    const k = tilt;
    const x = k.duration ? Math.min(1, (t - k.t0) / k.duration) : 1;
    const e = ease(x);
    const lerp = (a, b) => a + (b - a) * e;
    const opts = { pitch: lerp(k.from.pitch, k.to.pitch), bearing: 0 };
    if (!k.userMoved) {
      const c = new maplibregl.MercatorCoordinate(lerp(k.from.x, k.to.x), lerp(k.from.y, k.to.y)).toLngLat();
      Object.assign(opts, { center: c, zoom: lerp(k.from.zoom, k.to.zoom) });
      opts.padding = Object.fromEntries(['top', 'right', 'bottom', 'left'].map((s) => [s, lerp(k.from.padding[s], k.to.padding[s])]));
    }
    map.jumpTo(opts);
    k.onUpdate?.(e);
    if (x < 1) k.raf = requestAnimationFrame(tiltFrame);
    else {
      tilt = null;
      k.onDone?.();
    }
  }
  // Interação do usuário (só eventos com originalEvent) interrompe a câmera automática.
  map.on('movestart', (e) => {
    if (!e.originalEvent) return;
    stopCamera();
    if (tilt) tilt.userMoved = true;
  });
  const padding = () => ({ top: PAD, right: PAD + insets.right, bottom: PAD + insets.bottom, left: PAD + insets.left });

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
      const cam = map.cameraForBounds(bounds, { padding: padding(), ...opts });
      if (cam) moveTo(cam.center, cam.zoom);
    },
    // Centro e zoom que enquadram bounds com essa faixa de padding (o centro já vem deslocado), sem mover.
    cameraFor(bounds, pad, maxZoom) {
      const cam = map.cameraForBounds(bounds, { padding: pad, maxZoom });
      return cam ? { center: cam.center, zoom: cam.zoom } : { center: map.getCenter(), zoom: map.getZoom() };
    },
    camera: () => ({ center: map.getCenter(), zoom: map.getZoom() }),
    // Painel recolhido/aberto ou gaveta do celular: o mapa não muda de tamanho (sem resize por quadro);
    // a câmera desliza meia faixa para o conteúdo continuar centrado na área livre.
    setInsets(next, { animate = true } = {}) {
      const dx = (next.left ?? insets.left) - insets.left - ((next.right ?? insets.right) - insets.right);
      const dy = (next.bottom ?? insets.bottom) - insets.bottom;
      Object.assign(insets, next);
      if ((dx || dy) && animate && !raf) map.panBy([-dx / 2, dy / 2], { duration: 180, easing: (t) => 1 - Math.pow(1 - t, 3) });
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
      warmBadges(neighborhoods.length);
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
    // Ranking de cidades: cor por feature-state nos tiles e números na fonte de pontos (nada é recriado).
    async applyCityRank(cities) {
      await ready;
      const now = new Set(cities.map((c) => c.ibge));
      for (const id of rankedCities) if (!now.has(id)) map.setFeatureState(target('cities', id), { score: null });
      for (const c of cities) map.setFeatureState(target('cities', c.ibge), { score: c.score });
      rankedCities = [...now];
      warmBadges(Math.min(cities.length, 300));
      map.getSource('cityLabels').setData({
        type: 'FeatureCollection',
        features: cities
          .filter((c) => c.label)
          .map((c) => ({ type: 'Feature', id: c.ibge, properties: { id: c.ibge, rank: c.rank }, geometry: { type: 'Point', coordinates: c.label } })),
      });
    },
    async clearCityRank() {
      await ready;
      for (const id of rankedCities) map.setFeatureState(target('cities', id), { score: null });
      rankedCities = [];
      map.getSource('cityLabels').setData(EMPTY);
    },
    // to: { pitch, center?, zoom?, padding? }. duration em ms (0 = instantâneo). onUpdate(e) recebe o progresso
    // já com a curva, no mesmo quadro em que o mapa se move: o holograma usa esse valor.
    tiltTo(to, { duration = 700, onUpdate, onDone } = {}) {
      stopCamera();
      stopTilt();
      const c = map.getCenter();
      const m = merc(c);
      const pad = map.getPadding();
      const from = { pitch: map.getPitch(), zoom: map.getZoom(), x: m.x, y: m.y, padding: { top: pad.top, right: pad.right, bottom: pad.bottom, left: pad.left } };
      const tm = to.center ? merc(to.center) : m;
      const target = { pitch: to.pitch, zoom: to.zoom ?? from.zoom, x: tm.x, y: tm.y, padding: { ...from.padding, ...(to.padding || {}) } };
      tilt = { from, to: target, duration: reducedMotion() ? 0 : duration, t0: performance.now(), onUpdate, onDone, userMoved: false, raf: 0 };
      if (!tilt.duration) return tiltFrame(tilt.t0); // instantâneo: já aplicado antes de qualquer fit() seguinte
      tilt.raf = requestAnimationFrame(tiltFrame);
    },
    isTilting: () => !!tilt,
    insets: () => ({ ...insets }),
    pitch: () => map.getPitch(),
    zoom: () => map.getZoom(),
    project: (lngLat) => map.project(lngLat),
    onMove: (fn) => map.on('move', fn),
    hoodAt: (point) => map.queryRenderedFeatures(point, { layers: ['hoods-fill'] })[0]?.id ?? null,
    resize: () => {
      map.resize();
      if (themeDirty) ready.then(applyTheme); // tema trocado enquanto o explorador estava escondido
    },
    destroy: () => {
      stopCamera();
      stopTilt();
      document.documentElement.removeEventListener('themechange', onTheme);
      map.remove();
    },
  };
  return api;
}
