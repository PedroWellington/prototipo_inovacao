/*
 VICUS — landing com câmera contínua controlada pelo scroll (Canvas 2D, sem dependências).
 - Geometria: TopoJSON do IBGE pré-projetado em Web Mercator (data/, gerado por scripts/build-geo.mjs),
   decodificado UMA vez em Path2D. A câmera é só uma matriz (ctx.setTransform): nada é reprojetado por quadro.
 - Se um arquivo do IBGE falhar, aquela camada usa js/fallback-geo.js e a tela diz que é ILUSTRATIVA.
 - A loja é uma ilustração conceitual, não um endereço real.
*/
import { APP_URL, SESSION_URL } from './config.js';

const $ = (id) => document.getElementById(id);
const canvas = $('mapCanvas');
const ctx = canvas.getContext('2d');
const NE = new Set(['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE']);
const story = document.querySelector('.story');
const nav = $('navbar');
const source = $('geoSource');
const chapters = [...document.querySelectorAll('.chapter')];
const pill1 = { el: $('geoPill'), text: $('geoPillText') };
const pill2 = { el: $('geoPill2'), text: $('geoPillText2') };
const stepName = $('sceneName');
const stepNumber = $('sceneNumber');
const progressLine = $('progressLine');
const heroEl = $('heroMap');
const vignette = document.querySelector('.store-vignette');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;
const ease = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeIn = (p, a, b) => ease(a, b, p);
const easeOut = (p, a, b) => 1 - ease(a, b, p);

// --- Web Mercator, em metros, relativo a uma origem no Recife (precisão de float32 no Path2D) ---------
const R = 6378137;
const merc = (lon, lat) => [(R * lon * Math.PI) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
const ORIGIN = merc(-34.92, -8.06);
const world = (lon, lat) => { const [x, y] = merc(lon, lat); return [x - ORIGIN[0], ORIGIN[1] - y]; }; // y para baixo
const M_PER_DEG = (2 * Math.PI * R) / 360;
const DEST = world(-34.899, -8.124); // ponto ilustrativo em Boa Viagem (não é uma loja real)
const RECIFE_PIN = world(-34.9, -8.055);

// --- Câmera: keyframes (z = pixels por grau, como no original) ------------------------------------------
// Zoom: spline cúbica monotônica em log(z) => velocidade contínua entre estágios (sem "para e anda").
// Centro: dentro de cada trecho, avança na proporção de 1/z, o ponto de interesse vai sendo centralizado
// enquanto a escala muda, sem cortes.
// Linha do tempo ÚNICA do hero (0 a 1): o mapa em canvas e o mapa real (MapLibre) usam esta mesma câmera, então não há
// enquadramento por capítulo nem salto entre eles. z (pixels por grau × fit) é monotônico: só cresce ao descer.
// pitch em graus (o canvas aproxima com tilt = cos(pitch)); bear = giro do fim (só o mapa real); cy = altura do ponto.
const KF = [
  { p: 0, lon: -54.0, lat: -14.4, z: 15, pitch: 25.8, roll: -0.009, bear: 0, cx: 0.63, cy: 0.52 },
  { p: 0.15, lon: -42.0, lat: -8.8, z: 24, pitch: 23.1, roll: -0.01, bear: 0, cx: 0.57, cy: 0.52 },
  { p: 0.29, lon: -40.4, lat: -8.65, z: 52, pitch: 19.9, roll: -0.007, bear: 0, cx: 0.53, cy: 0.52 },
  { p: 0.43, lon: -37.65, lat: -8.2, z: 135, pitch: 16.3, roll: -0.005, bear: 0, cx: 0.52, cy: 0.51 },
  { p: 0.51, lon: -35.15, lat: -8.09, z: 650, pitch: 14.1, roll: -0.002, bear: 0, cx: 0.4, cy: 0.52 },
  { p: 0.58, lon: -34.93, lat: -8.065, z: 1800, pitch: 8.1, roll: 0, bear: 0, cx: 0.5, cy: 0.52 },
  { p: 0.7, lon: -34.904, lat: -8.09, z: 4800, pitch: 0, roll: 0, bear: 0, cx: 0.5, cy: 0.52 },
  { p: 0.79, lon: -34.9, lat: -8.124, z: 11000, pitch: 22, roll: 0, bear: -4, cx: 0.5, cy: 0.56 },
  { p: 0.87, lon: -34.899, lat: -8.124, z: 16500, pitch: 50, roll: 0, bear: -12, cx: 0.5, cy: 0.62 },
  { p: 1, lon: -34.899, lat: -8.124, z: 17500, pitch: 58, roll: 0, bear: -18, cx: 0.5, cy: 0.64 },
].map((k) => ({ ...k, w: world(k.lon, k.lat) }));

// Interpolação de Hermite monotônica (Fritsch–Carlson): sem ultrapassar os keyframes.
export function pchip(xs, ys) {
  const n = xs.length, h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const t = clamp((x - xs[i]) / h[i]), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}
const ps = KF.map((k) => k.p);
const logZ = pchip(ps, KF.map((k) => Math.log(k.z)));
const pitchF = pchip(ps, KF.map((k) => k.pitch));
const bearF = pchip(ps, KF.map((k) => k.bear));
const rollF = pchip(ps, KF.map((k) => k.roll));
const cxF = pchip(ps, KF.map((k) => k.cx));
// Centro: uma curva só, suave na linha do tempo inteira, em função de -1/z (o centro anda na proporção da escala, como
// antes), sem quebra de velocidade nos keyframes (antes cada trecho tinha a sua proporção e o centro "freava" na
// fronteira, ex.: p = 0,15). z é estritamente crescente, então -1/z também: a interpolação é monotônica por trecho.
const invZ = KF.map((k) => -1 / k.z);
const centerX = pchip(invZ, KF.map((k) => k.w[0]));
const centerY = pchip(invZ, KF.map((k) => k.w[1]));
const cyF = pchip(ps, KF.map((k) => k.cy));

const size = { w: 1, h: 1, dpr: 1, maxDpr: 1, mobile: false, fit: 1 };
const cam = { ux: 0, uy: 0, s: 1, tilt: 1, roll: 0, pitch: 0, bear: 0, cx: 0, cy: 0, co: 1, si: 0 };
const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function setCamera(p) {
  const z = Math.exp(logZ(p));
  cam.ux = centerX(-1 / z);
  cam.uy = centerY(-1 / z);
  cam.s = (z * size.fit) / M_PER_DEG; // pixels por metro
  cam.pitch = pitchF(p); cam.tilt = Math.cos((cam.pitch * Math.PI) / 180); cam.roll = rollF(p); cam.bear = bearF(p);
  cam.cx = (size.mobile ? 0.5 : cxF(p)) * size.w;
  // Celular: o texto ocupa o meio da tela; no fim o ponto desce para o holograma caber acima dele.
  cam.cy = (size.mobile ? 0.665 + 0.085 * easeIn(p, 0.79, 0.95) : cyF(p)) * size.h;
  cam.co = Math.cos(cam.roll); cam.si = Math.sin(cam.roll);
  // x' = cx + s(co·dx − si·dy);  y' = cy + tilt·s(si·dx + co·dy), já em pixels físicos (dpr)
  const k = size.dpr, s = cam.s;
  M.a = k * s * cam.co; M.b = k * cam.tilt * s * cam.si; M.c = -k * s * cam.si; M.d = k * cam.tilt * s * cam.co;
  M.e = k * cam.cx - M.a * cam.ux - M.c * cam.uy;
  M.f = k * cam.cy - M.b * cam.ux - M.d * cam.uy;
}
// A mesma câmera, em termos do MapLibre (os dois usam Web Mercator: a conversão é exata, sem novo enquadramento).
const unworld = (wx, wy) => [((wx + ORIGIN[0]) / R) * (180 / Math.PI), (2 * Math.atan(Math.exp((ORIGIN[1] - wy) / R)) - Math.PI / 2) * (180 / Math.PI)];
const WORLD_M = 2 * Math.PI * R; // 40.075.016,7 m: largura do mundo no Web Mercator
function mapView(p, w = size.w, h = size.h) {
  setCamera(p);
  const cx = (cam.cx / size.w) * w, cy = (cam.cy / size.h) * h;
  return {
    center: unworld(cam.ux, cam.uy),
    zoom: Math.log2((cam.s * WORLD_M) / 512), // mesmos pixels por metro do canvas
    pitch: cam.pitch,
    bearing: (-cam.roll * 180) / Math.PI + cam.bear,
    // O centro da câmera fica em (cx, cy) da tela, como no canvas.
    padding: { left: Math.max(0, 2 * cx - w), right: Math.max(0, w - 2 * cx), top: Math.max(0, 2 * cy - h), bottom: Math.max(0, h - 2 * cy) },
  };
}
function project(wx, wy) {
  if (hero.mode === 'map') { const q = hero.api.project(unworld(wx, wy)); return [q.x, q.y]; } // rótulos seguem o mapa real
  const dx = wx - cam.ux, dy = wy - cam.uy;
  return [cam.cx + cam.s * (cam.co * dx - cam.si * dy), cam.cy + cam.tilt * cam.s * (cam.si * dx + cam.co * dy)];
}
const useM = (dy = 0) => ctx.setTransform(M.a, M.b, M.c, M.d, M.e, M.f + dy * size.dpr);
function onScreen(bb, margin = 60) {
  if (!bb) return false;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]]) {
    const q = project(x, y); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
  }
  if (x1 - x0 < 0.6 && y1 - y0 < 0.6) return false; // menor que um pixel
  return x1 > -margin && x0 < size.w + margin && y1 > -margin && y0 < size.h + margin + 30;
}

// --- Dados geográficos -----------------------------------------------------------------------------------
// layers[nome] = níveis de detalhe do mais leve ao mais fino; cada um ganha .objects quando carregado.
const layers = { brasil: [], pe: [], recife: [] };
const illustrative = new Set();
let focus = null; // bairro em destaque (Boa Viagem)

function grow(bb, x, y) { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; }
function finishObject(features, meshArcs) {
  const all = new Path2D(), bbox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) { all.addPath(f.path); grow(bbox, f.bbox[0], f.bbox[1]); grow(bbox, f.bbox[2], f.bbox[3]); }
  features.sort((a, b) => a.cy - b.cy); // norte primeiro: o "volume" de cada feição cobre a de trás
  return { features, all, mesh: meshArcs, bbox };
}

// TopoJSON (arcos quantizados com delta) -> Path2D por feição + malha de divisas (cada arco uma vez).
export function decodeTopology(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  const arcs = topo.arcs.map((arc) => {
    const out = new Float64Array(arc.length * 2);
    let x = 0, y = 0;
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0]; y += arc[i][1];
      out[2 * i] = x * sx + tx - ORIGIN[0];
      out[2 * i + 1] = ORIGIN[1] - (y * sy + ty);
    }
    return out;
  });
  const objects = {};
  for (const [name, obj] of Object.entries(topo.objects)) {
    const used = new Set();
    const features = [];
    obj.geometries.forEach((g, index) => {
      const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
      if (!polys.length) return;
      const path = new Path2D(), bbox = [Infinity, Infinity, -Infinity, -Infinity];
      for (const rings of polys) for (const ring of rings) {
        let first = true;
        for (const ai of ring) {
          const a = arcs[ai < 0 ? ~ai : ai], n = a.length / 2;
          used.add(ai < 0 ? ~ai : ai);
          for (let k = first ? 0 : 1; k < n; k++) {
            const j = ai < 0 ? n - 1 - k : k, x = a[2 * j], y = a[2 * j + 1];
            if (first) { path.moveTo(x, y); first = false; } else path.lineTo(x, y);
            grow(bbox, x, y);
          }
        }
        path.closePath();
      }
      features.push({ props: g.properties || {}, path, bbox, cy: (bbox[1] + bbox[3]) / 2, index });
    });
    const mesh = new Path2D();
    for (const i of used) { const a = arcs[i]; mesh.moveTo(a[0], a[1]); for (let k = 2; k < a.length; k += 2) mesh.lineTo(a[k], a[k + 1]); }
    objects[name] = finishObject(features, mesh);
  }
  // Nordeste desenhado como as 9 UFs (divisas visíveis, como no visual original), não como um bloco só.
  if (objects.estados) objects.nordesteUFs = finishObject(objects.estados.features.filter((f) => NE.has(f.props.uf)), objects.nordeste?.mesh || new Path2D());
  return objects;
}

// Fallback esquemático (lon/lat) no mesmo formato. Só usado se o arquivo do IBGE falhar.
function fromLonLat(rings, props = () => ({})) {
  const features = rings.map((ring, index) => {
    const path = new Path2D(), bbox = [Infinity, Infinity, -Infinity, -Infinity];
    ring.forEach(([lon, lat], i) => { const [x, y] = world(lon, lat); i ? path.lineTo(x, y) : path.moveTo(x, y); grow(bbox, x, y); });
    path.closePath();
    return { props: props(index), path, bbox, cy: (bbox[1] + bbox[3]) / 2, index };
  });
  const o = finishObject(features, new Path2D());
  for (const f of features) o.mesh.addPath(f.path);
  return o;
}
async function useFallback(name) {
  const fb = (await import('./fallback-geo.js')).default;
  const objects = {
    brasil: () => ({ brasil: fromLonLat([fb.brazil]), nordeste: fromLonLat([fb.nordeste]) }),
    pe: () => ({ pernambuco: fromLonLat([fb.pernambuco]) }),
    recife: () => ({ cidade: fromLonLat([fb.recife]), bairros: fromLonLat(fb.tiles.map((t) => t.points), (i) => ({ name: `Área ilustrativa ${i + 1}` })) }),
  }[name]();
  layers[name] = [{ interval: 0, objects }];
  illustrative.add(name);
}

// LOD: o nível mais leve cuja tolerância fica abaixo de 1,5 pixel físico; senão o mais fino já carregado.
function pick(name) {
  let finest = null;
  for (const lod of layers[name]) {
    if (!lod.objects) continue;
    if (lod.interval * cam.s * size.dpr <= 1.5) return lod.objects;
    finest = lod.objects;
  }
  return finest;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}
const LABELS = { brasil: 'Brasil e estados', pe: 'Pernambuco', recife: 'Bairros do Recife' };
function updateSource() {
  source.classList.remove('loading');
  if (!illustrative.size) {
    source.textContent = 'Limites: IBGE · Malha Municipal 2022 e Bairros do Censo 2022';
    source.classList.remove('illustrative');
  } else {
    source.textContent = `Prévia ilustrativa: ${[...illustrative].map((n) => LABELS[n]).join(', ')} sem o arquivo do IBGE`;
    source.classList.add('illustrative');
  }
  pill2.official = !illustrative.has('recife');
}
async function loadGeo() {
  let manifest;
  try {
    manifest = await fetchJSON('data/manifest.json');
  } catch (e) {
    console.error('[VICUS geo] manifest.json indisponível; usando geometrias ILUSTRATIVAS.', e);
    await Promise.all(Object.keys(layers).map(useFallback));
    return geoReady();
  }
  for (const name of Object.keys(layers)) layers[name] = manifest.layers[name].map((f) => ({ ...f, objects: null }));
  // Prioridade: primeiro o nível leve de cada camada (Brasil, PE, Recife), depois os finos na mesma ordem.
  const queue = [];
  const depth = Math.max(...Object.values(layers).map((l) => l.length));
  for (let i = 0; i < depth; i++) for (const name of Object.keys(layers)) if (layers[name][i]) queue.push([name, layers[name][i], i]);
  for (const [name, lod, i] of queue) {
    if (illustrative.has(name)) continue;
    try {
      lod.objects = decodeTopology(await fetchJSON(`data/${lod.file}`));
    } catch (e) {
      console.error(`[VICUS geo] falha em data/${lod.file}`, e);
      if (i === 0) await useFallback(name); // sem o nível leve, a camada inteira vira ilustrativa
    }
    if (name === 'recife' && i === 0) updateSource();
    geoReady();
    await new Promise((r) => setTimeout(r, 0)); // devolve o controle entre arquivos: sem tarefa longa
  }
  updateSource();
  geoReady();
}
function geoReady() {
  const bairros = pick('recife')?.bairros || layers.recife.find((l) => l.objects)?.objects.bairros;
  if (bairros) {
    focus = bairros.features.find((f) => (f.props.name || '').toLowerCase() === 'boa viagem') || nearest(bairros.features);
  }
  if (layers.recife[0]?.objects) drawMiniMap();
  dirty = true;
  requestFrame();
}
function nearest(features) {
  let best = null, min = Infinity;
  for (const f of features) { const d = ((f.bbox[0] + f.bbox[2]) / 2 - DEST[0]) ** 2 + (f.cy - DEST[1]) ** 2; if (d < min) { min = d; best = f; } }
  return best;
}

// --- Cores: todas derivadas da paleta única (shared/design-tokens.css), lidas uma vez -------------------
const tok = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const tint = (a, b, t) => '#' + rgbOf(a).map((v, i) => Math.round(v + (rgbOf(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const rgba = (h, a) => `rgba(${rgbOf(h).join(',')},${a})`;
const T = {
  coal: tok('--coal', '#20272d'), coal2: tok('--coal-2', '#313b42'), sage: tok('--sage', '#688c83'), sand: tok('--sand', '#e8e5dc'),
  copper: tok('--copper', '#ad7651'), copperDark: tok('--copper-dark', '#8f5c3c'), copperSoft: tok('--copper-soft', '#e2c6ae'),
  paper: tok('--paper', '#fdfcf9'), muted: tok('--muted', '#87908e'),
};
const C = {
  shadow: rgba(tint(T.coal, '#000000', 0.55), 0.22),
  glow: rgba(T.copperSoft, 0.22),
  flatFill: rgba(T.muted, 0.16), flatMesh: rgba(T.sand, 0.22),
  ring: rgba(T.copperSoft, 0.35), halo: rgba(T.copperSoft, 0.18), dot: T.copperSoft, core: T.coal2,
  // Estados (todos com o mesmo preenchimento), Brasil, Nordeste, PE e Recife: tons de sage sobre grafite.
  // Contraste (WCAG 1.4.11, mínimo 3:1, nos dois temas): divisa x estado 3,8:1; Nordeste x demais estados 3,5:1;
  // divisas do Nordeste (escuras) x Nordeste 5,4:1. Conta e tabela em docs/DESIGN-SYSTEM.md.
  ufs: tint(T.sage, T.coal, 0.55), ufSide: tint(T.coal2, T.sage, 0.08), ufBorder: rgba(T.sand, 0.7),
  br: tint(T.sage, T.coal, 0.1), brSide: T.coal2, brBorder: rgba(T.sand, 0.56),
  nordeste: tint(T.sage, T.sand, 0.4), nordesteSide: tint(T.coal2, T.sage, 0.3), nordesteBorder: rgba(T.coal, 0.9),
  pe: tint(T.sage, T.sand, 0.4), peSide: tint(T.coal2, T.sage, 0.4), peBorder: rgba(T.copperSoft, 0.84),
  recife: tint(T.sage, T.sand, 0.08), recifeSide: tint(T.coal2, T.sage, 0.15), recifeBorder: rgba(T.copperSoft, 0.77),
  focus: T.copperSoft, focusSide: T.copperDark, focusBorder: rgba(T.paper, 0.82),
  hoodSide: tint(T.coal2, T.sage, 0.3), hoodBorder: rgba(T.sand, 0.34),
  mini: tint(T.sage, T.sand, 0.45), miniLine: rgba(T.paper, 0.92),
};
// Bairros: oito tons sóbrios entre sage, grafite e areia (só para distinguir vizinhos; não é nota).
const PALETTE = [tint(T.sage, T.coal, 0.1), tint(T.sage, T.sand, 0.2), tint(T.sage, T.coal, 0.2), tint(T.sand, T.copper, 0.3),
  tint(T.sage, T.sand, 0.1), tint(T.sage, T.coal, 0.15), tint(T.sage, T.sand, 0.25), tint(T.sand, T.copper, 0.2)];

// --- Desenho -------------------------------------------------------------------------------------------
const SHADOW = C.shadow;
// Camada com volume: sombra única (sem blur), "parede" por cópias deslocadas, topo e borda por feição.
function drawSolid(obj, alpha, style) {
  if (!obj || alpha < 0.012 || !onScreen(obj.bbox, 200)) return;
  const px = 1 / cam.s; // 1 pixel em metros (lineWidth está no espaço do mundo)
  ctx.globalAlpha = alpha;
  useM(style.depth + 6); ctx.fillStyle = SHADOW; ctx.fill(obj.all, 'evenodd');
  for (const f of obj.features) {
    if (!onScreen(f.bbox)) continue;
    const st = style.of ? style.of(f) : style;
    ctx.globalAlpha = alpha * (st.alpha ?? 1);
    if (st.depth > 0) {
      ctx.fillStyle = st.side;
      useM(st.depth); ctx.fill(f.path, 'evenodd');
      useM(st.depth * 0.5); ctx.fill(f.path, 'evenodd');
    }
    useM(0);
    ctx.fillStyle = st.top; ctx.fill(f.path, 'evenodd');
    ctx.lineWidth = (st.highlight ? 1.9 : 1.15) * px; ctx.strokeStyle = st.border; ctx.stroke(f.path);
    if (st.highlight) glow(f.path, px);
  }
  if (style.highlight && !style.of) { useM(0); ctx.globalAlpha = alpha; glow(style.outline || obj.all, px); }
}
// Brilho no lugar de shadowBlur: um traço translúcido de 3 px, só no elemento em destaque.
// (Medido: dois traços largos, de 10 e 4 px, com cantos arredondados geravam quadros acima de 50 ms; ver docs/PERFORMANCE.md.)
function glow(path, px) {
  ctx.strokeStyle = C.glow; ctx.lineWidth = 3 * px; ctx.stroke(path);
}
// Contexto discreto (municípios vizinhos de PE): preenchimento único e divisas numa só malha.
function drawFlat(obj, alpha) {
  if (!obj || alpha < 0.012) return;
  useM(0); ctx.globalAlpha = alpha;
  ctx.fillStyle = C.flatFill; ctx.fill(obj.all, 'evenodd');
  ctx.lineWidth = 0.8 / cam.s; ctx.strokeStyle = C.flatMesh; ctx.stroke(obj.mesh);
}
function pointMarker([wx, wy], opacity, rad) {
  if (opacity < 0.01) return;
  const [x, y] = project(wx, wy);
  if (x < -50 || x > size.w + 50 || y < -60 || y > size.h + 60) return;
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = C.ring; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(x, y, rad * 3.2, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = C.halo; ctx.beginPath(); ctx.arc(x, y, rad * 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.dot; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.core; ctx.beginPath(); ctx.arc(x, y, rad * 0.43, 0, Math.PI * 2); ctx.fill();
}
function atmosphere(p) {
  ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
  const alpha = 0.12 * easeOut(p, 0.77, 0.85);
  if (alpha > 0.002) {
    const r = Math.min(size.w * 0.46, size.h * 0.5);
    const g = ctx.createRadialGradient(cam.cx, cam.cy, 5, cam.cx, cam.cy, r);
    g.addColorStop(0, rgba(T.copperSoft, alpha)); g.addColorStop(0.55, rgba(T.copper, alpha * 0.19)); g.addColorStop(1, rgba(T.copper, 0));
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(cam.cx - r, cam.cy - r, 2 * r, 2 * r);
  }
  ctx.lineWidth = 1; ctx.strokeStyle = rgba(T.sand, 0.04);
  for (let j = 0; j < 6; j++) {
    ctx.beginPath();
    for (let i = 0; i <= 44; i++) { const x = (i / 44) * size.w, y = size.h * 0.77 + j * 29 + Math.sin(i * 0.25 + j * 0.9 + p * 2) * 7; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
}

// Destaque do Nordeste: a página abre com o Brasil numa cor só; quando a rolagem entra no trecho que leva ao Nordeste
// (p >= NE_AT), o Nordeste acende em NE_MS, por tempo (não pela rolagem), e apaga do mesmo jeito ao voltar ao início.
// Movimento reduzido: troca sem animação. neT vai de 0 a 1 em linha reta; a curva suave fica em neHi().
const NE_AT = 0.09, NE_MS = 600;
let neT = 0;
const neGoal = (p) => (p >= NE_AT ? 1 : 0);
const neHi = () => neT * neT * (3 - 2 * neT);
// Agenda única de opacidade das camadas (canvas e mapa real). A troca de geometria é só opacidade, na escala em que a
// câmera já está; e a camada mãe continua como contexto até a filha ocupar a tela (antes, o Nordeste sumia enquanto
// Pernambuco ainda era pequeno, e parecia que a escala recomeçava).
function alphas(p, hi = neHi()) {
  return {
    estados: easeOut(p, 0.27, 0.36),
    nordeste: hi * easeOut(p, 0.42, 0.5),
    pe: easeIn(p, 0.275, 0.36) * easeOut(p, 0.55, 0.63),
    municipios: easeIn(p, 0.33, 0.43) * easeOut(p, 0.66, 0.74),
    recife: easeIn(p, 0.405, 0.485) * easeOut(p, 0.66, 0.76),
    bairros: easeIn(p, 0.56, 0.665),
  };
}
function drawTerritory(p) {
  if (p > 0.925) return;
  const op = easeOut(p, 0.83, 0.925);
  const A = alphas(p);
  atmosphere(p);
  const br = pick('brasil'), pe = pick('pe'), rec = pick('recife');
  if (A.estados > 0.002 && br) {
    const a = op * A.estados;
    if (br.estados) drawSolid(br.estados, a, { top: C.ufs, side: C.ufSide, border: C.ufBorder, depth: 15 }); // uma cor só
    else drawSolid(br.brasil, a, { top: C.br, side: C.brSide, border: C.brBorder, depth: 21 });
  }
  if (A.nordeste > 0.002 && br) {
    drawSolid(br.nordesteUFs || br.nordeste, op * A.nordeste,
      { top: C.nordeste, side: C.nordesteSide, border: C.nordesteBorder, depth: 18, highlight: p > 0.16 && p < 0.35, outline: br.nordeste?.mesh });
  }
  if (A.municipios > 0.002 && pe) drawFlat(pe.municipios, op * A.municipios); // vizinhos: a câmera nunca fica no vazio
  if (A.pe > 0.002 && pe) {
    drawSolid(pe.pernambuco, op * A.pe,
      { top: C.pe, side: C.peSide, border: C.peBorder, depth: 19, highlight: p > 0.35 && p < 0.54 });
  }
  if (A.recife > 0.002 && rec) {
    drawSolid(rec.cidade, op * A.recife,
      { top: C.recife, side: C.recifeSide, border: C.recifeBorder, depth: 12 });
  }
  if (p > 0.55 && rec?.bairros) {
    const a = op * A.bairros, rise = easeIn(p, 0.66, 0.8);
    const name = focus?.props.name;
    drawSolid(rec.bairros, a, { depth: 3, of: (f) => {
      const isFocus = name ? f.props.name === name : f === focus;
      const depth = 3 + (f.index % 5) * 1.1 + rise * (isFocus ? 18 : 7);
      return isFocus
        ? { alpha: 1, top: C.focus, side: C.focusSide, border: C.focusBorder, depth, highlight: p > 0.66 }
        : { alpha: 0.91, top: PALETTE[f.index % PALETTE.length], side: C.hoodSide, border: C.hoodBorder, depth };
    } });
    pointMarker(DEST, a * easeIn(p, 0.68, 0.78), 6);
  }
  pointMarker(RECIFE_PIN, op * easeIn(p, 0.35, 0.48) * easeOut(p, 0.58, 0.68), 5);
  ctx.globalAlpha = 1;
}

// --- DOM: só escreve quando o valor muda (nada de leitura de layout durante o scroll) -------------------
function put(el, key, value) {
  const k = `_v_${key}`;
  if (el[k] === value) return;
  el[k] = value;
  if (key === 'aria-hidden') el.setAttribute(key, value); else if (key === 'text') el.textContent = value; else el.style[key] = value;
}
function updatePill(pill, text, [wx, wy], opacity, [ox, oy]) {
  const [x, y] = project(wx, wy);
  const o = clamp(opacity);
  put(pill.el, 'opacity', o.toFixed(3));
  put(pill.el, 'visibility', o > 0.01 ? 'visible' : 'hidden');
  if (o <= 0.01) return;
  put(pill.text, 'text', text);
  put(pill.el, 'transform', `translate3d(${Math.round(clamp(x + ox, 60, size.w - 60))}px,${Math.round(clamp(y + oy, 135, size.h - 90))}px,0) translate(-50%,-50%)`);
}
const SCENE_BORDERS = [0.15, 0.29, 0.43, 0.57, 0.7, 0.81, 0.91];
const SCENE_LABELS = ['BRASIL', 'NORDESTE', 'PERNAMBUCO', 'RECIFE', 'BAIRROS', 'AMPLIANDO O BAIRRO', 'A LOJA SURGE', 'SUA DECISÃO'];
let sceneIdx = -1;
// --- O mapa real da plataforma no hero inteiro (frontend/src/hero/main.js; docs/HERO-360.md) ----------------------
// Assim que fica pronto, o mesmo motor do explorador (MapLibre + tiles do OSM + malhas do IBGE + holograma) assume o
// palco com a MESMA câmera da linha do tempo (mapView): o mapa em canvas só desenha até lá e durante o fade de entrada.
// Reserva estática (último enquadramento): só com movimento reduzido, conexão ruim ou falha ao carregar.
const FOCUS = { name: 'Boa Viagem', lngLat: [-34.899, -8.124] }; // ponto ilustrativo (o mesmo DEST), sem recomendação
const HANDOFF_MS = 450; // fade de entrada do mapa real (por tempo, só opacidade): o canvas continua desenhando por baixo
const conn = navigator.connection;
const forced = new URLSearchParams(location.search).get('hero'); // ?hero=estatico: conferir a reserva
const hero = { mode: 'loading', api: null, why: '', stillReady: false, since: 0 };
window.__hero = hero; // leitura para os testes (frontend/perf/hero-360*.mjs): caminho, progresso e a câmera da linha do tempo
hero.viewAt = (p) => mapView(p);
function useStill(why) {
  if (hero.mode === 'still') return;
  Object.assign(hero, { mode: 'still', why });
  heroEl.classList.add('is-still');
  const img = heroEl.querySelector('.hero-map-still');
  img.hidden = false;
  img.addEventListener('load', () => { hero.stillReady = true; dirty = true; requestFrame(); }, { once: true });
  img.src = img.dataset.src;
}
function webgl() {
  try { return Boolean(document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl')); } catch { return false; }
}
async function startHero() {
  const slowNet = Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));
  if (forced === 'estatico' || slowNet || !webgl()) return useStill(forced === 'estatico' ? 'forçado pela URL' : slowNet ? 'conexão lenta' : 'sem WebGL');
  try {
    const timeout = new Promise((_, no) => setTimeout(() => no(new Error('tempo esgotado')), 30000));
    const [{ createHeroMap }, brasil, pe, recife] = await Promise.race([
      Promise.all([import('/app/hero/hero.js'), fetchJSON('data/brasil-1.json'), fetchJSON('data/pe-2.json'), fetchJSON('data/recife-2.json')]), timeout]);
    const colors = { ufs: C.ufs, nordeste: C.nordeste, pe: C.pe, recife: C.recife, focus: C.focus, focusBorder: C.focusBorder, palette: PALETTE,
      border: { estados: C.ufBorder, nordeste: C.nordesteBorder, municipios: C.flatMesh, pe: C.peBorder, recife: C.recifeBorder, bairros: C.hoodBorder } };
    const viewAt = (p) => mapView(p);
    const alphasAt = (p) => alphas(p, neGoal(p)); // pré-carga: o caminho com o destaque de cada ponto
    hero.api = await Promise.race([createHeroMap(heroEl, { topos: { brasil, pe, recife }, focus: FOCUS, colors, mobile: size.mobile, viewAt, alphasAt }), timeout]);
    Object.assign(hero, { mode: 'map', since: performance.now() });
    heroEl.classList.add('is-live');
    dirty = true;
    requestFrame();
  } catch (e) {
    console.warn('[VICUS hero] mapa indisponível; imagem estática.', e);
    useStill('o mapa não carregou');
  }
}
const handingOff = () => hero.mode === 'map' && performance.now() - hero.since < HANDOFF_MS;
// Opacidade do palco do mapa real: inteiro quando pronto; na reserva estática, só no fim (o canvas faz o caminho).
const heroAlpha = (p) => (hero.mode === 'map' ? 1 : hero.mode === 'still' && hero.stillReady ? easeIn(p, 0.8, 0.86) : 0);
const holoRise = (p) => easeIn(p, 0.8, 0.93); // o holograma entra no fim, acompanhando a inclinação
function updateHero(p, a) {
  put(heroEl, 'opacity', a.toFixed(3));
  put(heroEl, 'visibility', a > 0.002 ? 'visible' : 'hidden');
  put(vignette, 'opacity', (0.8 * Math.max(easeIn(p, 0.72, 0.82) * (hero.mode === 'map' ? 1 : 0), hero.mode === 'still' ? a : 0)).toFixed(3));
  if (hero.mode === 'map') hero.api.render({ ...mapView(p), alphas: alphas(p), rise: holoRise(p) });
}
function updateChapters(p) {
  chapters.forEach((el, i) => {
    const a = Number(el.dataset.start), b = Number(el.dataset.end);
    const f = i === 0 ? 1 : easeIn(p, a - 0.009, a + 0.02);
    const g = i === chapters.length - 1 ? 1 : easeOut(p, b - 0.025, b + 0.006);
    const alpha = Math.round(f * g * 1000) / 1000;
    if (el._alpha === alpha) return;
    el._alpha = alpha;
    el.style.opacity = alpha;
    put(el, 'visibility', alpha > 0.015 ? 'visible' : 'hidden');
    // Texto parado sem transform; durante o fade, só pixels inteiros (frações de pixel borram a letra).
    el.style.transform = alpha >= 0.999 ? 'none' : `translate3d(${Math.round((i % 2 === 0 ? -1 : 1) * (1 - alpha) * 21)}px,${Math.round((1 - alpha) * 25)}px,0)`;
    put(el, 'pointerEvents', alpha > 0.7 ? 'auto' : 'none');
    put(el, 'aria-hidden', alpha > 0.5 ? 'false' : 'true');
  });
}

function render(p) {
  hero.p = p;
  const a = reduced ? 0 : heroAlpha(p);
  setCamera(p);
  if (a < 1 || handingOff()) { // com o mapa real cobrindo a tela, o canvas não precisa ser desenhado
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawTerritory(p);
    if (handingOff()) requestFrame(); // continua até o fade de entrada terminar
  }
  if (reduced) { // versão estática: textos e a cena (enquadramento final, holograma parado) no fluxo normal (CSS)
    if (hero.mode === 'map') hero.api.render({ ...mapView(1, heroEl.clientWidth, heroEl.clientHeight), alphas: alphas(1), rise: 1 });
    return;
  }
  const hide = hero.mode === 'still' ? 1 - a : 1; // na reserva estática, os rótulos do canvas somem quando a imagem entra
  if (p < 0.29) updatePill(pill1, p < 0.14 ? 'Brasil' : 'Nordeste', p < 0.14 ? world(-54, -10) : world(-40.2, -6.4), easeOut(p, 0.27, 0.33) * easeOut(p, 0.75, 0.85), [24, -40]);
  else if (p < 0.59) updatePill(pill1, p < 0.43 ? 'Pernambuco' : 'Recife · PE · exemplo', p < 0.43 ? world(-38.2, -8.2) : world(-34.91, -8.065), easeIn(p, 0.27, 0.32) * easeOut(p, 0.57, 0.63) * hide, [20, -35]);
  else updatePill(pill1, 'Recife · PE · exemplo', DEST, easeIn(p, 0.59, 0.66) * easeOut(p, 0.74, 0.8) * hide, [25, -45]);
  updatePill(pill2, pill2.official ? 'Boa Viagem · Recife' : 'Bairros · composição ilustrativa', DEST, easeIn(p, 0.68, 0.74) * easeOut(p, 0.79, 0.83) * hide, [-20, 45]);
  updateHero(p, a);
  const idx = (() => { const i = SCENE_BORDERS.findIndex((b) => p < b); return i < 0 ? 7 : i; })();
  if (idx !== sceneIdx) {
    sceneIdx = idx;
    stepName.textContent = SCENE_LABELS[idx];
    stepNumber.textContent = String(idx + 1).padStart(2, '0');
  }
  put(progressLine, 'transform', `scaleX(${p.toFixed(4)})`);
  updateChapters(p);
}

// --- Progresso da rolagem: linha no topo que enche da esquerda para a direita (scaleX, origem à esquerda) ---
const scrollProgress = $('scrollProgress');
let progressRaf = 0;
function paintScrollProgress() {
  progressRaf = 0;
  const max = document.documentElement.scrollHeight - innerHeight;
  scrollProgress.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max).toFixed(4) : 0})`;
}
addEventListener('scroll', () => { if (!progressRaf) progressRaf = requestAnimationFrame(paintScrollProgress); }, { passive: true });
addEventListener('resize', paintScrollProgress, { passive: true });
paintScrollProgress();

// --- Loop: um único rAF, só quando algo mudou; pausa fora da tela -----------------------------------------
const STATIC_P = 0.7; // movimento reduzido: bairros do Recife com Boa Viagem em destaque
const TAU = 90; // ms: constante da suavização exponencial (independe da taxa de quadros: 60, 120 Hz...)
let target = 0, current = 0, previous = 0, raf = 0, dirty = true, inView = true;
let storyTop = 0, storyRange = 1, scrolled = null;
let ema = 0, slowFrames = 0;
export const quality = { dprSteps: 0 };

function requestFrame() { if (!raf) raf = requestAnimationFrame(tick); }
function readScroll() {
  target = reduced ? STATIC_P : clamp((scrollY - storyTop) / storyRange);
  const s = scrollY > 24;
  if (s !== scrolled) { scrolled = s; nav.classList.toggle('scrolled', s); }
  requestFrame();
}
function tick(time) {
  raf = 0;
  const dt = previous ? Math.min(time - previous, 64) : 16.7;
  previous = time;
  const before = current;
  current = reduced ? target : mix(current, target, 1 - Math.exp(-dt / TAU));
  if (Math.abs(current - target) < 0.00005) current = target;
  if (!inView) { current = target; neT = neGoal(current); previous = 0; return; }
  const goal = neGoal(current);
  if (neT !== goal) { neT = reduced ? goal : clamp(neT + Math.sign(goal - neT) * (dt / NE_MS)); dirty = true; }
  if (current !== before || dirty) {
    dirty = false;
    const t0 = performance.now();
    render(current);
    adapt(performance.now() - t0);
  }
  if (current !== target || neT !== goal) requestFrame(); else previous = 0;
}
// Qualidade adaptativa: se o desenho passar do orçamento por vários quadros, reduz a densidade de pixels.
function adapt(ms) {
  ema = ema ? ema * 0.9 + ms * 0.1 : ms;
  slowFrames = ema > 8 ? slowFrames + 1 : 0;
  if (slowFrames > 20 && size.dpr > 1) {
    size.maxDpr = Math.max(1, size.dpr - 0.25);
    quality.dprSteps++;
    slowFrames = 0; ema = 0;
    resize();
  }
}
function resize() {
  const r = canvas.getBoundingClientRect();
  size.w = Math.max(1, r.width); size.h = Math.max(1, r.height);
  size.mobile = innerWidth < 760;
  size.dpr = Math.min(devicePixelRatio || 1, size.maxDpr || (size.mobile ? 1.5 : 2));
  size.fit = size.mobile ? Math.min(size.w / 850, size.h / 900) * 1.08 : Math.min(size.w / 1440, size.h / 900) * 1.08;
  canvas.width = Math.round(size.w * size.dpr); canvas.height = Math.round(size.h * size.dpr);
  ctx.lineJoin = 'round'; // (redimensionar o canvas zera o estado) cantos em ponta viram "espinhos" nos traços largos
  storyTop = story.getBoundingClientRect().top + scrollY;
  storyRange = Math.max(1, story.offsetHeight - innerHeight);
  hero.api?.resize(); // recalcula a câmera no tamanho novo, sem recarregar o mapa
  dirty = true;
  drawMiniMap();
  readScroll();
}

// --- Prévia do produto: só os contornos dos bairros (malha do IBGE), sem classificar nem ranquear -------------------
function drawMiniMap() {
  const el = $('previewOfficialMap'), state = $('previewMapState'), tag = $('previewGeoLabel');
  const obj = layers.recife[0]?.objects?.bairros;
  if (!el || !obj) return;
  const r = el.getBoundingClientRect(), w = Math.max(50, r.width), h = Math.max(50, r.height);
  const k = Math.min(devicePixelRatio || 1, 2);
  el.width = Math.round(w * k); el.height = Math.round(h * k);
  const c = el.getContext('2d');
  if (illustrative.has('recife')) {
    state.textContent = 'Os limites dos bairros (IBGE) não carregaram agora. Nenhum contorno é mostrado no lugar deles.';
    tag.textContent = 'RECIFE · LIMITES INDISPONÍVEIS';
    state.classList.remove('official');
    return;
  }
  const [x0, y0, x1, y1] = obj.bbox, s = Math.min((w * 0.72) / (x1 - x0), (h * 0.77) / (y1 - y0));
  c.setTransform(k * s, 0, 0, k * s, k * (w / 2 - s * (x0 + x1) / 2), k * (h * 0.45 - s * (y0 + y1) / 2));
  c.fillStyle = C.mini; c.fill(obj.all, 'evenodd');
  c.lineWidth = 1.1 / s; c.strokeStyle = C.miniLine; c.stroke(obj.mesh);
  state.textContent = `${obj.features.length} bairros · Malha de Bairros do Censo 2022 (IBGE)`;
  tag.textContent = 'RECIFE · LIMITES DOS BAIRROS';
  state.classList.add('official');
}

// --- Início ----------------------------------------------------------------------------------------------
for (const a of document.querySelectorAll('[data-app-route]')) a.href = APP_URL + a.dataset.appRoute;

// Já logado? Mostra "Ir para a plataforma" no lugar de "Criar conta/Entrar". Só quando o navegador estiver ocioso:
// nada espera a rede para desenhar, e os botões trocados ficam abaixo da dobra (sem salto visível).
(window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(() => {
  fetch(SESSION_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => r.ok && document.documentElement.classList.add('is-user'))
    .catch(() => {}); // sem app (ex.: npm run serve): fica como visitante
  loadSources();
}, { timeout: 4000 });

new IntersectionObserver(([e]) => { inView = e.isIntersecting; if (inView) { dirty = true; readScroll(); } }).observe(story);
addEventListener('scroll', readScroll, { passive: true });
addEventListener('resize', () => { size.maxDpr = 0; resize(); }, { passive: true });
resize();
loadGeo();
// O motor do mapa (~230 KB comprimidos) só vem depois que a landing carregou, no ocioso: o topo nunca espera por ele.
const idleStart = () => (window.requestIdleCallback || ((f) => setTimeout(f, 600)))(startHero, { timeout: 3000 });
if (document.readyState === 'complete') idleStart(); else addEventListener('load', idleStart, { once: true });

// --- Painel de produto: revelação em cascata, números que contam e fontes reais (GET /api/catalog/sources) ---
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}, { rootMargin: '0px 0px -8% 0px' });
document.querySelectorAll('.rv').forEach((el) => io.observe(el));

// Mesma regra do app (frontend/src/motion.js): só conta inteiro a partir de 10, sempre em inteiros; menor que 10,
// decimal ou movimento reduzido mostram o final direto. Na contagem, o leitor de tela lê só o final (sr-only).
function countUp(el, to) {
  const show = (v) => (el.textContent = v.toLocaleString('pt-BR'));
  if (reduced || !Number.isInteger(to) || Math.abs(to) < 10) return show(to);
  const final = document.createElement('span');
  final.className = 'sr-only';
  final.textContent = to.toLocaleString('pt-BR');
  el.setAttribute('aria-hidden', 'true');
  el.after(final);
  const t0 = performance.now(), dur = 1200;
  const step = (t) => {
    const k = clamp((t - t0) / dur);
    show(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) return requestAnimationFrame(step);
    el.removeAttribute('aria-hidden');
    final.remove();
  };
  requestAnimationFrame(step);
}
// Sem a API (ex.: npm run serve), a lista fica só com nome e link: nenhuma data é inventada.
const STATIC_SOURCES = [
  ['Receita Federal: dados abertos do CNPJ', 'https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/cadastros/consultas/dados-publicos-cnpj'],
  ['IBGE: malhas territoriais e Censo 2022', 'https://www.ibge.gov.br/'],
  ['CNES / DATASUS: unidades de saúde', 'https://cnes.datasus.gov.br/'],
];
function fillSources(data) {
  const ul = $('sourceList');
  ul.replaceChildren();
  ul.removeAttribute('aria-busy');
  const rows = data ? data.sources.map((s) => [s.name, s.url, `ref. ${s.reference_date}`]) : STATIC_SOURCES.map(([n, u]) => [n, u, 'data de referência na plataforma']);
  rows.push(['Mapa-base: © OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright', 'ODbL']);
  for (const [name, url, ref] of rows) {
    const li = document.createElement('li'), a = document.createElement('a'), span = document.createElement('span');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = name;
    span.textContent = ref;
    li.append(a, span);
    ul.append(li);
  }
  if (!data || !data.cities_with_data) return;
  const stat = $('citiesStat');
  stat.hidden = false;
  const once = new IntersectionObserver(([e]) => { if (e.isIntersecting) { countUp($('citiesCount'), data.cities_with_data); once.disconnect(); } });
  once.observe(stat);
}
function loadSources() {
  fetch('/api/catalog/sources', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then(fillSources, () => fillSources(null));
}
