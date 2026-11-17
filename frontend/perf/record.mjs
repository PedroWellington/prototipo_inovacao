// Grava as capturas curtas de movimento (docs/visual/movimento-*.webm) e confere o tema em círculo nas telas novas.
//   docker compose up -d; cd frontend; node perf/record.mjs [pasta]      (BASE=http://host:porta)
// Cria um usuário descartável (mov-…@example.com) e gasta o crédito grátis no Recife.
import { mkdirSync, renameSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = '../docs/visual'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
const RECIFE = 2611606;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const setup = await browser.newContext({ bypassCSP: true });
await setup.request.post(`${BASE}/api/auth/register`, { data: { name: 'Ana Movimento', email: `mov-${Date.now()}@example.com`, password: 'mov-senha-123', accept_terms: true } });
const { csrf_token } = await (await setup.request.get(`${BASE}/api/auth/me`)).json();
const headers = { 'X-CSRF-Token': csrf_token };
await setup.request.put(`${BASE}/api/profile`, { headers, data: { segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: true, hq_uf: 'PE', hq_municipality_ibge: RECIFE,
  criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 4 }, { business_type_key: 'clinica', direction: 'attract', weight: 3 }, { business_type_key: 'farmacia', direction: 'repel', weight: 2 }] } });
await setup.request.post(`${BASE}/api/credits/cities/${RECIFE}`, { headers });
const state = await setup.storageState();
await setup.close();

let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++; };

async function record(name, fn) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1280, height: 800 }, storageState: state, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => expect(false, `${name}: ${e.message}`));
  await fn(page);
  await page.waitForTimeout(600);
  const path = await page.video().path();
  await ctx.close();
  renameSync(path, `${OUT}/movimento-${name}.webm`);
}

await record('tema-em-circulo', async (p) => {
  // Conta as View Transitions e confere que o canvas do mapa é o mesmo antes e depois da troca.
  await p.addInitScript(() => {
    window.__vt = 0;
    const st = document.startViewTransition?.bind(document);
    if (st) document.startViewTransition = (cb) => (window.__vt++, st(cb));
  });
  for (const route of ['#/home', '#/analises', '#/comparar', '#/dados', '#/criterios']) {
    await p.goto(`${BASE}/app/${route}`); await p.waitForSelector('[data-cx]'); await p.waitForTimeout(700);
    const before = await p.evaluate(() => (window.__vt, document.documentElement.dataset.theme));
    await p.click('.topbar [data-theme-toggle]'); await p.waitForTimeout(800);
    const after = await p.evaluate(() => [document.documentElement.dataset.theme, window.__vt]);
    expect(after[0] !== before && after[1] >= 1, `tema em círculo em ${route} (${before} -> ${after[0]})`);
  }
  await p.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
  await p.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  await p.evaluate(() => (window.__canvas = document.querySelector('.maplibregl-canvas')));
  await p.click('.topbar [data-theme-toggle]'); await p.waitForTimeout(900);
  expect(await p.evaluate(() => window.__canvas === document.querySelector('.maplibregl-canvas') && window.__canvas.isConnected), 'explorador: troca de tema sem recriar o mapa');
});

await record('entrada-visao-geral', async (p) => {
  await p.goto(`${BASE}/app/#/home`); await p.waitForSelector('[data-cx]'); await p.waitForTimeout(1500);
});

await record('troca-de-pagina', async (p) => {
  await p.goto(`${BASE}/app/#/home`); await p.waitForSelector('[data-cx]'); await p.waitForTimeout(900);
  for (const k of ['analises', 'compare', 'fontes', 'home']) { await p.click(`.topnav [data-nav="${k}"]`); await p.waitForTimeout(1000); }
});

await record('abrir-cidade', async (p) => {
  await p.goto(`${BASE}/app/#/home`); await p.waitForSelector('[data-cx]');
  await p.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
  await p.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 }); await p.waitForTimeout(1500);
});

await record('ranking-reordena', async (p) => {
  await p.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
  await p.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 }); await p.waitForTimeout(800);
  for (const v of ['1', '5', '2']) {
    await p.evaluate((val) => { const r = document.querySelector('[data-weight="0"]'); r.value = val; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, v);
    await p.waitForTimeout(1300);
  }
});

await record('tooltip', async (p) => {
  await p.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
  await p.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 }); await p.waitForTimeout(800);
  const box = await p.locator('.maplibregl-canvas').boundingBox();
  for (let i = 0; i <= 12; i++) { await p.mouse.move(box.x + box.width * (0.45 + i * 0.012), box.y + box.height * (0.5 + i * 0.005)); await p.waitForTimeout(140); }
  expect(await p.evaluate(() => !document.querySelector('[data-tooltip]').hidden), 'tooltip compacto aparece no hover');
});

await browser.close();
console.log(fail ? `${fail} falha(s)` : 'ok');
process.exit(fail ? 1 : 0);
