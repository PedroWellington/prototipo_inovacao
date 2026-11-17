// Capturas da landing e do app nos dois temas (claro e escuro), desktop e celular, com o Edge instalado.
//   docker compose up -d; cd frontend; node perf/screens-tema.mjs <pasta>      (BASE=http://host:porta)
// Cria um usuário descartável (tema-…@example.com), sede no Recife, e gasta o crédito grátis no Recife.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = 'perf/shots-tema'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
const RECIFE = 2611606;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });

const email = `tema-${Date.now()}@example.com`;
const setup = await browser.newContext({ bypassCSP: true });
await setup.request.post(`${BASE}/api/auth/register`, { data: { name: 'Ana Tema', email, password: 'tema-senha-123', accept_terms: true } });
const { csrf_token } = await (await setup.request.get(`${BASE}/api/auth/me`)).json();
const headers = { 'X-CSRF-Token': csrf_token };
await setup.request.put(`${BASE}/api/profile`, { headers, data: { segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: true, hq_uf: 'PE', hq_municipality_ibge: RECIFE,
  criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 4 }, { business_type_key: 'clinica', direction: 'attract', weight: 3 }, { business_type_key: 'farmacia', direction: 'repel', weight: 2 }] } });
await setup.request.post(`${BASE}/api/credits/cities/${RECIFE}`, { headers });
const state = await setup.storageState();
await setup.close();

for (const theme of ['claro', 'escuro']) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const mobile = device === 'celular';
    const ctx = await browser.newContext({ bypassCSP: true, viewport, storageState: state, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme === 'escuro' ? 'dark' : 'light');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${theme}-${device}-${name}.png`, ...opts });
    const settle = (ms = 900) => page.waitForTimeout(ms);
    const scrollTo = async (sel) => { await page.evaluate((s) => document.querySelector(s).scrollIntoView(), sel); await settle(1400); };

    // Landing: topo, meio da jornada, e cada seção do painel de produto
    await page.goto(`${BASE}/`, { waitUntil: 'load' }); await settle(1800); await shot('landing-topo');
    await page.evaluate(() => { const s = document.querySelector('.story'); scrollTo(0, s.offsetTop + 0.62 * (s.offsetHeight - innerHeight)); }); await settle(1500); await shot('landing-bairros');
    for (const id of ['conheca', 'como-funciona', 'fontes', 'planos', 'perguntas', 'final']) { await scrollTo(`#${id}`); await shot(`landing-${id}`); }

    // App: visão geral, explorador com bairro clicado (zoom + holograma), conta e compra de créditos
    await page.goto(`${BASE}/app/#/home`); await page.waitForSelector('[data-dashboard]'); await settle(1600); await shot('app-visao-geral');
    await page.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
    await page.waitForSelector('[data-rank-list] li button', { timeout: 30000, state: 'attached' }); await settle(2200); await shot('app-explorador');
    await page.evaluate(() => {
      const L = document.querySelector('[data-holo]');
      const pt = L.holoPoint(L.holoState().top[0]);
      const c = document.querySelector('.maplibregl-canvas'), r = c.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, clientX: r.left + pt.x, clientY: r.top + pt.y, button: 0, view: window };
      for (const t of ['mousedown', 'mouseup', 'click']) c.dispatchEvent(new MouseEvent(t, o));
    });
    await settle(1800); await shot('app-bairro-holograma');
    await page.keyboard.press('Escape'); await settle(1200); await shot('app-bairro-volta');
    const hood = await page.evaluate(() => document.querySelector('[data-holo]').holoState().top[0]);
    await page.goto(`${BASE}/app/#/bairro/${hood}?city=${RECIFE}`); await page.waitForSelector('.metric.is-primary', { timeout: 30000 }); await settle(1500); await shot('app-detalhe-bairro', { fullPage: true });
    await page.goto(`${BASE}/app/#/criterios`); await page.waitForSelector('[data-body] h2'); await settle(1800); await shot('app-criterios');
    await page.goto(`${BASE}/app/#/conta`); await page.waitForSelector('.page'); await settle(); await shot('app-conta');
    await page.goto(`${BASE}/app/#/termos`); await page.waitForSelector('.page'); await settle(); await shot('app-termos');
    await page.goto(`${BASE}/app/#/analises`); await settle(1500); await shot('app-analises');
    await page.goto(`${BASE}/app/#/comparar`); await settle(1500); await shot('app-comparar');
    await page.goto(`${BASE}/app/#/dados`); await settle(1500); await shot('app-dados');
    await page.goto(`${BASE}/app/#/creditos`); await page.waitForSelector('.plans-grid'); await settle(); await shot('app-creditos');
    await page.click('[data-buy="essencial"]'); await page.waitForSelector('dialog[open]'); await settle(400); await shot('app-creditos-modal');
    await ctx.close();
    // Visitante: login nos dois temas
    const guest = await browser.newContext({ bypassCSP: true, viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await guest.addInitScript((t) => localStorage.setItem('theme', t), theme === 'escuro' ? 'dark' : 'light');
    const g = await guest.newPage();
    await g.goto(`${BASE}/app/#/login`); await g.waitForSelector('#email'); await g.waitForTimeout(800);
    await g.screenshot({ path: `${OUT}/${theme}-${device}-app-login.png` });
    await guest.close();
  }
}
await browser.close();
console.log(`ok: ${OUT}`);
