// Hero com o mapa real (docs/HERO-360.md): casos que caem no estado final estático ou não podem quebrar a landing.
//   docker compose up -d; cd frontend; node perf/hero-360-casos.mjs [pasta para capturas]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.argv[2];
if (OUT) mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++; };

async function open(opts = {}, setup = async () => {}) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const asked = [];
  page.on('request', (r) => asked.push(r.url()));
  await setup(page, ctx);
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('load');
  return { ctx, page, asked };
}
const toP = async (page, p) => {
  await page.evaluate((q) => { const s = document.getElementById('inicio'); scrollTo(0, s.offsetTop + q * (s.offsetHeight - innerHeight)); }, p);
  await page.waitForTimeout(1200);
};
const layer = (page) => page.evaluate(() => { const el = document.getElementById('heroMap'); const cs = getComputedStyle(el); return { op: Number(cs.opacity), vis: cs.visibility, h: el.offsetHeight }; });

// 1. Movimento reduzido: sem câmera animada; o mapa real parado no enquadramento final, holograma visível e estável.
{
  const { ctx, page } = await open({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__hero && window.__hero.mode !== 'loading', null, { timeout: 90000 });
  const before = await page.evaluate(() => ({ mode: window.__hero.mode, zoom: window.__hero.api?.stats().zoom }));
  await page.evaluate(() => document.getElementById('heroMap').scrollIntoView()); await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ zoom: window.__hero.api?.stats().zoom, holo: [...document.querySelectorAll('#heroMap .holo')].some((h) => Number(getComputedStyle(h).opacity) > 0.9), story: document.getElementById('inicio').offsetHeight, vh: innerHeight }));
  const L = await layer(page);
  expect(before.mode === 'map' && L.op === 1 && L.vis === 'visible' && L.h > 200, `movimento reduzido: mapa real parado no fluxo (${L.h}px de altura)`);
  expect(Math.abs(after.zoom - before.zoom) < 1e-6, `movimento reduzido: a rolagem não move a câmera (zoom ${before.zoom?.toFixed(2)} antes e depois)`);
  expect(after.holo, 'movimento reduzido: holograma visível e estável');
  expect(after.story < 3 * after.vh, `movimento reduzido: hero sem o container alto (${after.story}px)`);
  if (OUT) await page.screenshot({ path: `${OUT}/movimento-reduzido.png` });
  await ctx.close();
}
// 2. Conexão ruim (economia de dados / 2G): imagem estática, sem baixar o motor do mapa.
{
  const { ctx, page, asked } = await open({}, async (p) => {
    await p.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '2g' } }));
  });
  await page.waitForFunction(() => window.__hero?.stillReady, null, { timeout: 30000 });
  await toP(page, 0.95);
  const L = await layer(page);
  const st = await page.evaluate(() => ({ mode: window.__hero.mode, why: window.__hero.why }));
  expect(st.mode === 'still' && L.op > 0.9 && !asked.some((u) => u.includes('/app/hero/hero.js') || u.includes('tile.openstreetmap')), `conexão ruim: imagem estática (${st.why}), sem baixar o mapa nem tiles`);
  await ctx.close();
}
// 3. Falha ao carregar o mapa: imagem estática; antes dela o mapa em canvas continua (nunca preto).
{
  const { ctx, page } = await open({}, async (p) => { await p.route('**/app/hero/hero.js', (r) => r.abort()); });
  await page.waitForFunction(() => window.__hero?.mode === 'still', null, { timeout: 40000 });
  await toP(page, 0.3);
  const mid = await page.evaluate(() => {
    const c = document.getElementById('mapCanvas'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 3] > 0 && d[i] + d[i + 1] + d[i + 2] > 60) lit++;
    return { lit, op: Number(getComputedStyle(document.getElementById('heroMap')).opacity) };
  });
  expect(mid.lit > 50 && mid.op === 0, `falha no mapa: no meio do hero o mapa em canvas aparece (${mid.lit} amostras acesas)`);
  await toP(page, 0.97);
  const L = await layer(page);
  expect(L.op > 0.9, 'falha no mapa: no fim, a imagem estática do enquadramento final');
  if (OUT) await page.screenshot({ path: `${OUT}/falha-do-mapa.png` });
  await ctx.close();
}
// 4. Sem JavaScript: a imagem estática aparece; nada preto.
{
  const { ctx, page } = await open({ javaScriptEnabled: false });
  await page.waitForTimeout(1500);
  const L = await layer(page);
  const img = await page.evaluate(() => [...document.querySelectorAll('#heroMap img')].some((i) => i.complete && i.naturalWidth > 0));
  expect(L.op === 1 && L.vis === 'visible' && img, 'sem JavaScript: imagem estática do enquadramento final');
  await ctx.close();
}
// 5. Redimensionar: a câmera é recalculada no tamanho novo, sem recarregar o mapa.
{
  const { ctx, page } = await open();
  await page.waitForFunction(() => window.__hero?.mode === 'map', null, { timeout: 90000 });
  await toP(page, 0.6);
  const before = await page.evaluate(() => window.__hero.api.stats().zoom);
  let loads = 0;
  page.on('request', (r) => r.url().includes('/app/hero/hero.js') && loads++);
  await page.setViewportSize({ width: 1000, height: 700 }); await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ zoom: window.__hero.api.stats().zoom, want: window.__hero.viewAt(window.__hero.p).zoom, mode: window.__hero.mode }));
  expect(r.mode === 'map' && loads === 0 && Math.abs(r.zoom - r.want) < 1e-3 && Math.abs(r.zoom - before) > 0.05, `redimensionar: câmera refeita para 1000×700 (zoom ${before.toFixed(2)} → ${r.zoom.toFixed(2)}), sem recarregar`);
  await ctx.close();
}
// 6. Teclado e leitor de tela: a cena é decorativa; PageDown atravessa o hero sem prender.
{
  const { ctx, page } = await open();
  const r = await page.evaluate(() => ({ hidden: document.getElementById('heroMap').getAttribute('aria-hidden'), focusables: document.querySelectorAll('#heroMap a, #heroMap button, #heroMap [tabindex]').length }));
  expect(r.hidden === 'true' && r.focusables === 0, 'teclado e leitor de tela: cena aria-hidden e sem foco');
  await page.click('body', { position: { x: 700, y: 500 } }).catch(() => {});
  for (let i = 0; i < 80; i++) await page.keyboard.press('PageDown');
  await page.waitForTimeout(600);
  const y = await page.evaluate(() => ({ y: scrollY, end: document.getElementById('inicio').offsetTop + document.getElementById('inicio').offsetHeight - innerHeight }));
  expect(y.y >= y.end, `PageDown atravessa o hero (rolou até ${y.y}px; o hero termina em ${y.end}px)`);
  await ctx.close();
}
await browser.close();
console.log(fail ? `${fail} falha(s)` : 'ok');
process.exit(fail ? 1 : 0);
