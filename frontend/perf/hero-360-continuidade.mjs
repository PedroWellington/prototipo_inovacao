// Continuidade da câmera do hero (docs/HERO-360.md): uma linha do tempo só, do Brasil ao bairro.
//   docker compose up -d; cd frontend; node perf/hero-360-continuidade.mjs [pasta para capturas]
// Confere: zoom monotônico (só cresce ao descer), nenhum degrau entre amostras vizinhas, fronteiras de capítulo
// idênticas dos dois lados, e o mapa real seguindo a curva depois de rolar.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.argv[2];
if (OUT) mkdirSync(OUT, { recursive: true });
const BORDERS = [0.15, 0.29, 0.43, 0.57, 0.7, 0.81, 0.91];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++; };
for (const [name, vp, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['celular', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => window.__hero?.mode === 'map', null, { timeout: 90000 });
  const r = await page.evaluate((borders) => {
    const v = window.__hero.viewAt, N = 2000, s = [];
    for (let i = 0; i <= N; i++) { const x = v(i / N); s.push([x.zoom, x.center[0], x.center[1], x.pitch, x.bearing, x.padding.top, x.padding.left + x.padding.right]); }
    let down = 0, worst = 0, where = '';
    const d = s.slice(1).map((x, i) => x.map((y, k) => Math.abs(y - s[i][k])));
    for (let i = 1; i < s.length; i++) if (s[i][0] < s[i - 1][0] - 1e-9) down++;
    // Degrau = um passo muito maior que os vizinhos. O piso de comparação é 2% do passo típico daquela grandeza,
    // para trechos parados (pitch e bearing em 0) não virarem divisão por quase zero.
    const names = ['zoom', 'lon', 'lat', 'pitch', 'bearing', 'altura', 'lado'];
    for (let k = 0; k < 7; k++) {
      const typical = [...d.map((x) => x[k])].sort((a, b) => a - b)[Math.floor(d.length * 0.9)] || 0;
      if (typical === 0) continue;
      for (let i = 2; i < d.length - 2; i++) {
        const local = Math.max([d[i - 2][k], d[i - 1][k], d[i + 1][k], d[i + 2][k]].sort((a, b) => a - b)[1], 0.02 * typical);
        const r = d[i][k] / local;
        if (r > worst) { worst = r; where = `${names[k]} em p=${((i + 1) / N).toFixed(4)}`; }
      }
    }
    // Fronteira: a mudança atravessando a fronteira, comparada com a de um intervalo igual logo depois dela.
    const e = 1e-4;
    const edges = borders.map((b) => {
      const a = v(b - e), c = v(b + e), c2 = v(b + 3 * e);
      const q = (x, y) => Math.max(Math.abs(x.zoom - y.zoom), Math.hypot(x.center[0] - y.center[0], x.center[1] - y.center[1]) * 50, Math.abs(x.pitch - y.pitch) / 20, Math.abs(x.bearing - y.bearing) / 20);
      return q(a, c) / Math.max(q(c, c2), 1e-12);
    });
    return { down, worst, where, edges, z0: s[0][0], z1: s[N][0] };
  }, BORDERS);
  expect(r.down === 0, `${name}: zoom monotônico (${r.z0.toFixed(2)} → ${r.z1.toFixed(2)}; ${r.down} recuos em 2000 amostras)`);
  expect(r.worst < 3, `${name}: nenhum degrau (maior passo / vizinhos = ${r.worst.toFixed(2)}, ${r.where})`);
  // Contínuo: atravessar a fronteira muda o mesmo que um intervalo igual ao lado (razão perto de 1; um corte daria milhares).
  expect(r.edges.every((x) => x < 3), `${name}: fronteiras de capítulo sem salto (razão máx. ${Math.max(...r.edges).toFixed(2)} entre atravessar a fronteira e um trecho igual ao lado)`);
  // O mapa real segue a curva: rola, espera a suavização assentar e compara o zoom do MapLibre com o da linha do tempo.
  const g = await page.evaluate(() => { const s = document.getElementById('inicio'); return { top: s.offsetTop, range: s.offsetHeight - innerHeight }; });
  let maxErr = 0;
  for (const p of [0.05, 0.2, 0.36, 0.5, 0.6, 0.72, 0.85, 0.97]) {
    await page.evaluate(([y]) => scrollTo(0, y), [g.top + p * g.range]); await page.waitForTimeout(900);
    const e = await page.evaluate(() => Math.abs(window.__hero.api.stats().zoom - window.__hero.viewAt(window.__hero.p).zoom));
    maxErr = Math.max(maxErr, e);
  }
  expect(maxErr < 1e-3, `${name}: zoom do mapa real = zoom da linha do tempo (erro máx. ${maxErr.toExponential(1)})`);
  if (OUT) for (const b of BORDERS) for (const [tag, q] of [['antes', b - 0.012], ['depois', b + 0.012]]) {
    await page.evaluate(([y]) => scrollTo(0, y), [g.top + q * g.range]); await page.waitForTimeout(1100);
    await page.screenshot({ path: `${OUT}/${name}-${String(Math.round(b * 100)).padStart(2, '0')}-${tag}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(fail ? `${fail} falha(s)` : 'ok');
process.exit(fail ? 1 : 0);
