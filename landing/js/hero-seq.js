// Sequência do hero: mergulho ilustrativo do mapa do Recife até o holograma da unidade (docs/HERO-360.md).
// É demonstração visual, não dado: não há bairro, número nem fonte nova aqui.
// Caminhos, decididos em tempo de execução:
//   vídeo  : WebM VP8 com quadro-chave a cada 6 quadros; currentTime segue a rolagem. Só se o navegador tocar
//            VP8 e passar na calibração (buscas rápidas); se travar durante o uso, cai para os quadros.
//   quadros: WebP baixados em ondas (1 a cada 12, 1 a cada 4, o resto; até 6 ao mesmo tempo), decodificados
//            sob demanda numa janela pequena; sem o quadro pedido, desenha o mais próximo já pronto.
//   estático: o último quadro (holograma). Conexão lenta, economia de dados ou aparelho fraco.
// O pôster (quadro 0) aparece primeiro; a camada só fica visível depois que algo está pronto: nunca tela preta.
export const HERO_SEQ = { base: '/app/hero-360/v1/', count: 360, fps: 60 };
const url = (i) => `${HERO_SEQ.base}f/${String(i).padStart(3, '0')}.webp`;
const LAST = HERO_SEQ.count - 1;
const CALIBRATION = [300, 40, 220, 120, 350, 10, 180, 260]; // quadros espalhados: buscas para frente e para trás
const SLOW_SEEK_MS = 250; // uma busca acima disto durante o uso conta como travada; 3 seguidas = trocar para quadros

export function createHeroSequence(layer, { onFrame = () => {} } = {}) {
  const still = layer.querySelector('.hero-seq-still');
  const canvas = layer.querySelector('.hero-seq-frames');
  const ctx = canvas.getContext('2d', { alpha: false });
  const conn = navigator.connection;
  const slowNet = Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '')));
  const weak = (navigator.deviceMemory || 8) <= 2 || (navigator.hardwareConcurrency || 8) <= 2;
  const mobile = matchMedia('(max-width: 760px)').matches;
  // Prévia dos caminhos de reserva: ?hero=quadros ou ?hero=estatico na URL da landing (só para conferir).
  const force = new URLSearchParams(location.search).get('hero');
  const s = { mode: slowNet || weak || force === 'estatico' ? 'static' : 'poster', want: 0, shown: -1, ready: false,
    why: force === 'estatico' ? 'forçado pela URL' : slowNet ? 'conexão lenta' : weak ? 'aparelho fraco' : '' };

  // Pôster (ou o quadro final no modo estático): é o que garante imagem desde o primeiro instante.
  still.addEventListener('load', () => (s.ready = true, onFrame()), { once: true });
  still.addEventListener('error', () => (s.mode = 'off'), { once: true }); // sem imagem: a cena não aparece (o mapa fica)
  still.src = url(s.mode === 'static' ? LAST : 0);
  if (still.complete && still.naturalWidth) s.ready = true;

  // ---------- Vídeo ----------
  let video = null, seeking = false, t0 = 0, strikes = 0;
  const seekTo = (f) => new Promise((ok) => {
    const t = performance.now();
    const done = () => (clearTimeout(timer), ok(performance.now() - t));
    const timer = setTimeout(done, 1000);
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = (f + 0.5) / HERO_SEQ.fps;
  });
  async function tryVideo() {
    video = document.createElement('video');
    if (!video.canPlayType('video/webm; codecs="vp8"')) return (s.why = 'navegador sem VP8'), false;
    Object.assign(video, { muted: true, playsInline: true, preload: 'auto', disablePictureInPicture: true, className: 'hero-seq-video' });
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    const loaded = new Promise((ok) => {
      video.addEventListener('canplaythrough', () => ok(true), { once: true });
      video.addEventListener('error', () => ok(false), { once: true });
      setTimeout(() => ok(false), 20000);
    });
    video.src = `${HERO_SEQ.base}sequencia.webm`;
    layer.insertBefore(video, canvas);
    if (!(await loaded)) return (s.why = 'vídeo não carregou'), false;
    const ms = [];
    for (const f of CALIBRATION) ms.push(await seekTo(f));
    ms.sort((a, b) => a - b);
    s.calibration = { median: Math.round(ms[ms.length >> 1]), max: Math.round(ms.at(-1)) };
    s.why = `buscas no vídeo: mediana ${s.calibration.median} ms, máx. ${s.calibration.max} ms`;
    return s.calibration.median <= 40 && s.calibration.max <= 160;
  }
  function pumpVideo() {
    if (s.mode !== 'video' || seeking || s.want === s.shown) return;
    seeking = true;
    t0 = performance.now();
    const f = s.want;
    video.addEventListener('seeked', () => {
      seeking = false;
      s.shown = f;
      video.classList.add('is-on'); // só aparece por cima do pôster depois do primeiro quadro certo
      strikes = performance.now() - t0 > SLOW_SEEK_MS ? strikes + 1 : 0;
      if (strikes >= 3) return switchToFrames('vídeo travou durante a rolagem');
      pumpVideo();
    }, { once: true });
    video.currentTime = (f + 0.5) / HERO_SEQ.fps;
  }

  // ---------- Quadros ----------
  const indices = [];
  const blobs = new Map(), bitmaps = new Map(), decoding = new Set();
  let maxBitmaps = 24, drawn = -1, drawRaf = 0;
  function switchToFrames(why) {
    s.mode = 'frames';
    s.why = why;
    video?.remove();
    video = null;
    const step = mobile || slowNet ? 3 : 1; // celular e conexão lenta: 1 a cada 3 (120 quadros)
    for (let i = 0; i <= LAST; i += step) indices.push(i);
    if (indices.at(-1) !== LAST) indices.push(LAST);
    maxBitmaps = mobile ? 12 : 24; // ~3,7 MB por quadro decodificado (1280×720)
    resize();
    download();
  }
  function download() {
    const seen = new Set(), order = [];
    for (const stride of [12, 4, 1]) for (const i of indices) if (i % stride === 0 && !seen.has(i)) (seen.add(i), order.push(i));
    for (const i of indices) if (!seen.has(i)) order.push(i);
    let next = 0;
    const worker = async () => {
      while (next < order.length) {
        const i = order[next++];
        try {
          const r = await fetch(url(i));
          const b = r.ok && (r.headers.get('content-type') || '').includes('image') ? await r.blob() : null;
          if (b) blobs.set(i, b);
        } catch { /* sem este quadro: desenha o vizinho */ }
        if (Math.abs(i - s.want) <= 8) decodeAround();
      }
    };
    for (let k = 0; k < 6; k++) worker();
  }
  function nearest(map) {
    let best = -1;
    for (const i of map.keys()) if (best < 0 || Math.abs(i - s.want) < Math.abs(best - s.want)) best = i;
    return best;
  }
  function decodeAround() {
    const near = indices.filter((i) => Math.abs(i - s.want) <= 9).sort((a, b) => Math.abs(a - s.want) - Math.abs(b - s.want));
    for (const i of near) {
      if (bitmaps.has(i) || decoding.has(i) || !blobs.has(i)) continue;
      decoding.add(i);
      createImageBitmap(blobs.get(i)).then((bm) => {
        bitmaps.set(i, bm);
        // Janela: descarta os mais distantes do quadro atual (close() libera a memória decodificada na hora).
        while (bitmaps.size > maxBitmaps) {
          let far = -1;
          for (const k of bitmaps.keys()) if (far < 0 || Math.abs(k - s.want) > Math.abs(far - s.want)) far = k;
          bitmaps.get(far).close();
          bitmaps.delete(far);
        }
        requestDraw();
      }, () => blobs.delete(i)).finally(() => decoding.delete(i));
    }
  }
  function requestDraw() {
    if (!drawRaf) drawRaf = requestAnimationFrame(drawFrame);
  }
  function drawFrame() {
    drawRaf = 0;
    const i = bitmaps.has(s.want) ? s.want : nearest(bitmaps);
    if (i < 0 || i === drawn) return;
    const bm = bitmaps.get(i);
    const k = Math.max(canvas.width / bm.width, canvas.height / bm.height); // como object-fit: cover
    const w = bm.width * k, h = bm.height * k;
    ctx.drawImage(bm, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    canvas.hidden = false; // só depois do primeiro quadro desenhado: o canvas opaco nunca cobre o pôster com preto
    drawn = i;
    s.shown = i;
  }
  function resize() {
    if (s.mode !== 'frames') return;
    const r = layer.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 1.5); // o quadro tem 1280×720: mais densidade só gastaria memória
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    drawn = -1;
    requestDraw();
  }

  // Começa depois que a landing carregou e o navegador está ocioso: o mapa do topo nunca disputa a rede.
  function start() {
    if (s.mode !== 'poster') return;
    if (force === 'quadros') return switchToFrames('forçado pela URL');
    tryVideo().then((ok) => {
      if (s.mode !== 'poster') return;
      if (ok) {
        s.mode = 'video';
        pumpVideo();
      } else switchToFrames(s.why);
    }, () => switchToFrames('erro no vídeo'));
  }
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
  if (document.readyState === 'complete') idle(start, { timeout: 4000 });
  else addEventListener('load', () => idle(start, { timeout: 4000 }), { once: true });

  return {
    // q: 0..1 da sequência (a landing decide quando ela começa e termina dentro do hero).
    update(q) {
      if (s.mode === 'static' || s.mode === 'off') return;
      const f = Math.max(0, Math.min(LAST, Math.round(q * LAST)));
      if (f === s.want) return;
      s.want = f;
      if (s.mode === 'video') pumpVideo();
      else if (s.mode === 'frames') (decodeAround(), requestDraw());
    },
    ready: () => s.ready && s.mode !== 'off',
    resize,
    state: () => ({ mode: s.mode, why: s.why, want: s.want, shown: s.shown, calibration: s.calibration, decoded: bitmaps.size, downloaded: blobs.size }),
  };
}
