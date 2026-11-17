// Fluidez do redesign (metas: >= 55 fps e p95 do quadro <= 12 ms com CPU 4x mais lenta; docs/PERFORMANCE.md).
// Mede o intervalo entre quadros (requestAnimationFrame) durante cada cena: entrada das páginas com cascata,
// troca de página, rolagem, tema em círculo, ranking reordenando e câmera do explorador.
//   docker compose up -d; cd frontend; node perf/fluidez.mjs      (BASE=..., CPU=4, HEADLESS=0 para ver)
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const CPU = Number(process.env.CPU || 4);
const RECIFE = 2611606;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: process.env.HEADLESS !== '0' });
const setup = await browser.newContext({ bypassCSP: true });
await setup.request.post(`${BASE}/api/auth/register`, { data: { name: 'Ana Fluidez', email: `flu-${Date.now()}@example.com`, password: 'flu-senha-123', accept_terms: true } });
const { csrf_token } = await (await setup.request.get(`${BASE}/api/auth/me`)).json();
const headers = { 'X-CSRF-Token': csrf_token };
await setup.request.put(`${BASE}/api/profile`, { headers, data: { segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: true, hq_uf: 'PE', hq_municipality_ibge: RECIFE,
  criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 4 }, { business_type_key: 'clinica', direction: 'attract', weight: 3 }, { business_type_key: 'farmacia', direction: 'repel', weight: 2 }] } });
await setup.request.post(`${BASE}/api/credits/cities/${RECIFE}`, { headers });
const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, storageState: await setup.storageState() });
await setup.close();
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

// Aquece (cache de rede e dos módulos) sem freio; depois liga o freio de CPU para as medições.
await page.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
const hood = await page.evaluate(() => document.querySelector('[data-holo]').holoState().top[0]);
for (const r of ['#/home', '#/analises', '#/comparar', '#/dados', '#/criterios']) { await page.goto(`${BASE}/app/${r}`); await page.waitForSelector('[data-cx]'); }
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

const start = () => page.evaluate(() => {
  window.__f = [];
  let last = performance.now();
  const tick = (t) => { window.__f.push(t - last); last = t; if (window.__f) window.__rf = requestAnimationFrame(tick); };
  window.__rf = requestAnimationFrame(tick);
});
const stop = () => page.evaluate(() => { cancelAnimationFrame(window.__rf); const f = window.__f.slice(1); window.__f = null; return f; });
const rows = [];
async function scene(name, fn) {
  await start();
  await fn();
  const f = await stop();
  const s = [...f].sort((a, b) => a - b);
  const p95 = s[Math.min(s.length - 1, Math.round(0.95 * (s.length - 1)))];
  const fps = 1000 / (f.reduce((a, b) => a + b, 0) / f.length);
  rows.push({ cena: name, quadros: f.length, fps: +fps.toFixed(1), p95_ms: +p95.toFixed(1), max_ms: +s.at(-1).toFixed(1), ok: fps >= 55 && p95 <= 12 ? '✅' : '❌' });
}

await page.goto(`${BASE}/app/#/analises`); await page.waitForSelector('[data-cx]'); await page.waitForTimeout(500);
await scene('troca de página (menu, 4 cliques)', async () => {
  for (const k of ['home', 'compare', 'fontes', 'analises']) { await page.click(`.topnav [data-nav="${k}"]`); await page.waitForTimeout(900); }
});
await scene('Visão geral: rolagem', async () => {
  await page.click('.topnav [data-nav="home"]'); await page.waitForTimeout(900);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 220); await page.waitForTimeout(120); }
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -220); await page.waitForTimeout(120); }
});
await scene('tema em círculo (Visão geral)', async () => { await page.click('.topbar [data-theme-toggle]'); await page.waitForTimeout(900); });
await scene('Detalhe do bairro: entrada (anel, números, barras)', async () => {
  await page.goto(`${BASE}/app/#/bairro/${hood}?city=${RECIFE}`); await page.waitForSelector('.metric.is-primary'); await page.waitForTimeout(1200);
});
await page.click('.topnav [data-nav="explorer"]');
await page.waitForSelector('[data-rank-list] li button'); await page.waitForTimeout(1500);
await scene('explorador: ranking reordena (FLIP, 3 pesos)', async () => {
  for (const v of ['1', '5', '3']) {
    await page.evaluate((val) => { const r = document.querySelector('[data-weight="0"]'); r.value = val; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await page.waitForTimeout(1100);
  }
});
await scene('explorador: tema em círculo sobre o mapa', async () => { await page.click('.topbar [data-theme-toggle]'); await page.waitForTimeout(1000); });

console.table(rows);
await browser.close();
