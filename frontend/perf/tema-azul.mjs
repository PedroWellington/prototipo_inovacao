// Capturas para comparar paletas: landing, explorador, detalhe do bairro, Comparar (duas cidades), assistente e
// compra de créditos, nos dois temas, desktop e celular. Cria um usuário descartável (azul-…@example.com) e abre
// Recife e Maceió com os créditos de boas-vindas.
//   docker compose up -d; cd frontend; node perf/tema-azul.mjs <pasta> [claro,escuro]      (BASE=http://host:porta)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = 'perf/shots-tema-azul', THEMES = 'claro,escuro'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
const RECIFE = 2611606;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });

const setup = await browser.newContext({ bypassCSP: true });
await setup.request.post(`${BASE}/api/auth/register`, { data: { name: 'Ana Azul', email: `azul-${Date.now()}@example.com`, password: 'azul-senha-12345', accept_terms: true } });
const { csrf_token } = await (await setup.request.get(`${BASE}/api/auth/me`)).json();
const headers = { 'X-CSRF-Token': csrf_token };
await setup.request.put(`${BASE}/api/profile`, { headers, data: { segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: false,
  criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 4 }, { business_type_key: 'farmacia', direction: 'repel', weight: 2 }] } });
await setup.request.post(`${BASE}/api/auth/tutorial`, { headers });
for (const ibge of [RECIFE, 2704302]) await setup.request.post(`${BASE}/api/credits/cities/${ibge}`, { headers });
const state = await setup.storageState();
await setup.close();

for (const theme of THEMES.split(',')) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const mobile = device === 'celular';
    const ctx = await browser.newContext({ bypassCSP: true, viewport, storageState: state, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme === 'escuro' ? 'dark' : 'light');
    await ctx.route('**/api/config', async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, json: { ...(await res.json()), assistant: true } }); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    const shot = (name, opts = {}) => page.screenshot({ path: `${OUT}/${theme}-${device}-${name}.png`, ...opts });
    const settle = (ms = 1200) => page.waitForTimeout(ms);

    await page.goto(`${BASE}/`, { waitUntil: 'load' }); await settle(2500); await shot('landing-topo');
    for (const id of ['conheca', 'planos']) { await page.evaluate((s) => document.getElementById(s).scrollIntoView(), id); await settle(1500); await shot(`landing-${id}`); }
    await page.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
    await page.waitForSelector('[data-rank-list] li button', { timeout: 30000, state: 'attached' }); await settle(3000); await shot('explorador');
    const hood = await page.evaluate(() => document.querySelector('[data-holo]').holoState().top[0]);
    await page.goto(`${BASE}/app/#/bairro/${hood}?city=${RECIFE}`); await page.waitForSelector('.metric.is-primary', { timeout: 30000 }); await settle(1500); await shot('detalhe');
    await page.goto(`${BASE}/app/#/comparar`); await page.waitForSelector('.cmp-side'); await settle(1800); await shot('comparar', { fullPage: true });
    await page.goto(`${BASE}/app/#/home`); await page.waitForSelector('[data-dashboard]'); await settle(1200);
    await page.click('.ai-fab'); await page.waitForSelector('.ai.is-open .ai-panel'); await page.fill('#aiInput', 'Como a cobertura é calculada?'); await settle(600); await shot('assistente');
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/app/#/creditos`); await page.waitForSelector('#buyQty'); await settle(1200); await shot('compra');
    await page.goto(`${BASE}/app/#/login`).catch(() => {});
    await ctx.close();
  }
}
await browser.close();
console.log('capturas em', OUT);
