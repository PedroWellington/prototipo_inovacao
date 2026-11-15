// Holograma da unidade: VISUALIZAÇÃO CONCEITUAL (loja genérica, sem endereço nem estabelecimento real).
// Sequência de 360 quadros WebP (scripts/build-holograma.py) desenhada num <canvas> sobre o mapa.
// - Giro por tempo (mesma velocidade a 60 e a 144 Hz); redesenha só quando o índice do quadro muda.
// - Janela deslizante de quadros decodificados (createImageBitmap + close()): memória limitada.
// - Download preguiçoso: só quando o explorador abre, no ocioso; primeiro um quadro a cada 6°.
// - Nada aqui repinta o mapa: é uma camada DOM própria, com pointer-events: none.
import '../styles/hologram.css';

export const HOLO_TURN_SECONDS = 12; // uma volta completa
export const HOLO_STILL_FRAME = 30; // quadro fixo com prefers-reduced-motion (vista de frente)
const BEHIND = 3; // quadros decodificados atrás do atual
const AHEAD = 18; // e à frente (o giro só anda para a frente)
const FIRST_STEP = 6; // primeira leva: um quadro a cada 6°
const PARALLEL = 4;

// ---------- Funções puras (testadas em hologram.test.js) ----------
export const frameAt = (seconds, count, turn = HOLO_TURN_SECONDS) => Math.floor((((seconds / turn) % 1) + 1) % 1 * count) % count;

export function windowOf(i, count, behind = BEHIND, ahead = AHEAD) {
  const out = [];
  for (let k = -behind; k <= ahead; k++) out.push((((i + k) % count) + count) % count);
  return out;
}

// Quadro decodificado mais próximo do pedido (o giro nunca espera download: mostra o que já existe).
export function nearest(i, count, has) {
  if (has(i)) return i;
  for (let d = 1; d <= count / 2; d++) {
    if (has((i - d + count) % count)) return (i - d + count) % count;
    if (has((i + d) % count)) return (i + d) % count;
  }
  return -1;
}

// Onde desenhar: o corpo fica acima do ponto do bairro, dentro da área livre do mapa (sem invadir painéis,
// legenda ou atribuição); o cone liga a base do corpo ao ponto. Tudo em pixels inteiros.
export function layout(anchor, area, w, h, lift) {
  const half = w / 2;
  const cx = Math.round(Math.min(Math.max(anchor.x, area.left + half), area.right - half));
  const bottom = Math.round(Math.min(Math.max(anchor.y - lift, area.top + h), area.bottom));
  const dx = anchor.x - cx, dy = anchor.y - bottom;
  const visible = anchor.x >= area.left && anchor.x <= area.right && anchor.y >= area.top && anchor.y <= area.bottom + lift;
  return {
    x: cx - half, y: bottom - h, // canto superior esquerdo do corpo
    cone: { x: cx, y: bottom, len: Math.max(0, Math.round(Math.hypot(dx, dy))), deg: +((Math.atan2(dy, dx) * 180) / Math.PI - 90).toFixed(2) },
    visible,
  };
}

// ---------- Quadros: download preguiçoso e janela de decodificação ----------
function createFrames(base) {
  let manifest = null;
  let blobs = [];
  const bitmaps = new Map();
  const pending = new Set();
  let started = null;
  let target = null; // { w, h } em pixels do dispositivo: os quadros já saem do decodificador nesse tamanho
  const url = (i) => base + manifest.pattern.replace('{i}', String(i).padStart(3, '0')) + `?v=${manifest.version}`;

  async function fetchAll() {
    manifest = await (await fetch(`${base}manifest.json`, { cache: 'no-cache' })).json();
    blobs = new Array(manifest.count);
    const order = [];
    for (let i = 0; i < manifest.count; i += FIRST_STEP) order.push(i);
    for (let i = 0; i < manifest.count; i++) if (i % FIRST_STEP) order.push(i);
    let next = 0;
    const worker = async () => {
      while (next < order.length) {
        const i = order[next++];
        try {
          const r = await fetch(url(i));
          if (r.ok) blobs[i] = await r.blob();
        } catch {
          /* rede caiu: o giro usa os quadros que já chegaram */
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
  }

  return {
    get manifest() {
      return manifest;
    },
    // Começa o download (uma vez). Chamado quando o explorador abre, no ocioso.
    load() {
      started ||= fetchAll().catch(() => {});
      return started;
    },
    // Tamanho de exibição (px do dispositivo). Mudou: descarta o que estava decodificado em outro tamanho.
    size(w, h) {
      if (target && target.w === w && target.h === h) return;
      target = { w, h };
      this.clear();
    },
    has: (i) => bitmaps.has(i),
    get: (i) => bitmaps.get(i),
    // Mantém decodificados só os quadros perto de i; libera (close) os que saíram da janela.
    keep(i) {
      if (!manifest) return;
      const want = new Set(windowOf(i, manifest.count));
      for (const [k, bmp] of bitmaps) {
        if (!want.has(k)) {
          bmp.close();
          bitmaps.delete(k);
        }
      }
      for (const k of want) {
        if (bitmaps.has(k) || pending.has(k) || !blobs[k]) continue;
        pending.add(k);
        createImageBitmap(blobs[k], target ? { resizeWidth: target.w, resizeHeight: target.h, resizeQuality: 'high' } : undefined)
          .then((bmp) => {
            pending.delete(k);
            if (want.has(k) && windowOf(i, manifest.count).includes(k)) bitmaps.set(k, bmp);
            else bmp.close();
          })
          .catch(() => pending.delete(k));
      }
    },
    memoryMB: () => (manifest ? (bitmaps.size * (target?.w || manifest.width) * (target?.h || manifest.height) * 4) / 1048576 : 0),
    loaded: () => blobs.filter(Boolean).length,
    clear() {
      for (const bmp of bitmaps.values()) bmp.close();
      bitmaps.clear();
    },
  };
}

// ---------- Camada sobre o mapa ----------
// host: elemento posicionado sobre o mapa. project(lngLat) -> {x, y}; area() -> {left, right, top, bottom}.
export function createHologram(host, { project, area, base = `${import.meta.env.BASE_URL}holograma/` }) {
  const frames = createFrames(base);
  // Media queries consultadas uma vez (chamar matchMedia por quadro custava ~37 ms a cada 3 transições, CPU 4x).
  const mqReduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mqSmall = matchMedia('(max-width: 860px)');
  const reduced = () => mqReduced.matches;
  const small = () => mqSmall.matches;
  const slots = [0, 1].map(() => {
    const el = document.createElement('div');
    el.className = 'holo';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<div class="holo-cone"></div><div class="holo-pin"></div><div class="holo-body"><canvas></canvas><span class="holo-label">Visualização conceitual da unidade</span></div>';
    host.append(el);
    return { el, cone: el.firstChild, pin: el.children[1], body: el.children[2], canvas: el.querySelector('canvas'), lngLat: null, rise: 0, drawn: -1, last: '' };
  });
  let raf = 0;
  let last = 0;
  let seconds = 0;
  let size = null;
  let paints = 0; // quadros de giro efetivamente desenhados (medição)

  function measure() {
    const m = frames.manifest;
    if (!m) return null;
    const w = small() ? Math.min(200, Math.max(130, innerWidth * 0.34)) : 230; // celular: clamp(130px, 34vw, 200px)
    const h = Math.round((w * m.height) / m.width);
    const ratio = Math.min(2, devicePixelRatio || 1);
    for (const s of slots) {
      s.canvas.width = Math.round(w * ratio);
      s.canvas.height = Math.round(h * ratio);
      s.canvas.style.width = `${Math.round(w)}px`;
      s.canvas.style.height = `${h}px`;
      s.drawn = -1;
    }
    frames.size(slots[0].canvas.width, slots[0].canvas.height); // decodifica direto no tamanho do canvas
    return { w: Math.round(w), h, lift: small() ? 46 : 64 };
  }

  function paint(s, i) {
    const j = nearest(i, frames.manifest.count, frames.has);
    if (j < 0 || j === s.drawn) return;
    const g = s.canvas.getContext('2d');
    g.clearRect(0, 0, s.canvas.width, s.canvas.height);
    g.drawImage(frames.get(j), 0, 0); // 1:1, sem reescala por quadro
    s.drawn = j;
    paints++;
  }

  function place(s) {
    // O cone termina logo acima do ponto: o número da posição do bairro selecionado continua à vista.
    const p = project(s.lngLat);
    const a = { x: p.x, y: p.y - 15 };
    const L = layout(a, area(), size.w, size.h + 22, size.lift); // +22: rótulo abaixo do quadro
    const r = s.rise;
    const op = (L.visible ? r : 0).toFixed(3);
    // Só transform e opacity; string igual = nenhuma escrita no DOM.
    const key = `${L.x},${L.y},${L.cone.x},${L.cone.y},${L.cone.len},${L.cone.deg},${op}`;
    if (key === s.last) return;
    s.last = key;
    s.el.style.opacity = op;
    s.body.style.transform = `translate3d(${L.x}px,${Math.round(L.y + 40 * (1 - r))}px,0) scale(${(0.92 + 0.08 * r).toFixed(3)})`;
    s.cone.style.transform = `translate3d(${L.cone.x}px,${L.cone.y}px,0) rotate(${L.cone.deg}deg) scale(1,${(L.cone.len * r).toFixed(1)})`;
    s.pin.style.transform = `translate3d(${Math.round(a.x)}px,${Math.round(a.y)}px,0)`;
  }

  function frame(t) {
    const dt = last ? Math.min(100, t - last) : 0;
    last = t;
    const live = slots.filter((s) => s.rise > 0.001 && s.lngLat);
    if (!live.length) {
      raf = 0;
      last = 0;
      for (const s of slots) s.el.style.opacity = '0';
      return; // os quadros da janela continuam decodificados (~18 MB): o próximo clique não decodifica nada
    }
    if (frames.manifest) {
      size ||= measure();
      if (!reduced()) seconds += dt / 1000;
      const i = reduced() ? HOLO_STILL_FRAME : frameAt(seconds, frames.manifest.count);
      frames.keep(i);
      for (const s of live) {
        paint(s, i);
        place(s);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  const wake = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };
  addEventListener('resize', () => (size = null), { passive: true });
  host.holoStats = () => ({ loaded: frames.loaded(), decoded: frames.memoryMB(), running: !!raf, paints }); // medição (perf/holo-fps.mjs)

  return {
    // Baixa os quadros e, no ocioso, já decodifica a janela do quadro inicial: o primeiro clique não paga isso.
    load: () =>
      frames.load().then(() => {
        size ||= measure();
        const start = reduced() ? HOLO_STILL_FRAME : frameAt(seconds, frames.manifest.count);
        (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(() => frames.keep(start), { timeout: 2000 });
      }),
    // slot 0 ou 1: âncora (ponto dentro do bairro) e quanto subiu (0..1). O laço só roda com algo visível.
    set(slot, { lngLat, rise }) {
      const s = slots[slot];
      if (lngLat && lngLat !== s.lngLat) {
        s.lngLat = lngLat;
        s.last = '';
      }
      if (rise != null) s.rise = Math.min(1, Math.max(0, rise));
      wake();
    },
    rise: (slot) => slots[slot].rise,
    anchor: (slot) => slots[slot].lngLat,
    // Quando o mapa se move (pan/zoom), reposiciona no mesmo quadro.
    follow: () => slots.some((s) => s.rise > 0.001) && wake(),
    stats: () => ({ loaded: frames.loaded(), decoded: frames.memoryMB(), running: !!raf, paints }),
    destroy() {
      cancelAnimationFrame(raf);
      frames.clear();
      for (const s of slots) s.el.remove();
    },
  };
}
