// Capturas da tela Comparar (Recife x Maceió) nos dois temas, desktop e celular: a tela e o cartão do mapa.
//   docker compose up -d; cd frontend; node perf/comparar.mjs <pasta>      (BASE=http://host:porta)
// Roda o axe (WCAG A/AA) na tela com o "Lado a lado"; sai com código 1 se houver violação.
// Cria um usuário descartável (cmp-…@example.com) e abre as duas cidades com os créditos de boas-vindas.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = 'perf/shots-comparar'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
mkdirSync(OUT, { recursive: true });
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
let total = 0;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });

const setup = await browser.newContext({ bypassCSP: true });
await setup.request.post(`${BASE}/api/auth/register`, { data: { name: 'Ana Compara', email: `cmp-${Date.now()}@example.com`, password: 'cmp-senha-12345', accept_terms: true } });
const { csrf_token } = await (await setup.request.get(`${BASE}/api/auth/me`)).json();
const headers = { 'X-CSRF-Token': csrf_token };
await setup.request.put(`${BASE}/api/profile`, { headers, data: { segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: false,
  criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 4 }, { business_type_key: 'farmacia', direction: 'repel', weight: 2 }] } });
await setup.request.post(`${BASE}/api/auth/tutorial`, { headers });
for (const ibge of [2611606, 2704302]) await setup.request.post(`${BASE}/api/credits/cities/${ibge}`, { headers });
const state = await setup.storageState();
await setup.close();

for (const theme of ['claro', 'escuro']) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const mobile = device === 'celular';
    const ctx = await browser.newContext({ bypassCSP: true, viewport, storageState: state, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme === 'escuro' ? 'dark' : 'light');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(`${BASE}/app/#/comparar`);
    await page.waitForSelector('.cmp-col .mini-map');
    await page.waitForTimeout(2500); // entrada e CountUp terminam
    await page.locator('.cmp-col').first().screenshot({ path: `${OUT}/${theme}-${device}-cartao.png` });
    await page.screenshot({ path: `${OUT}/${theme}-${device}-tela.png`, fullPage: true });
    await page.locator('.cmp-side').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => `${x.id} (${x.nodes.length})`));
    total += v.length;
    console.log(`${v.length ? '❌' : '✅'} ${theme} ${device}: comparar com Lado a lado: ${v.length} violação(ões) ${v.join(', ')}`);
    await ctx.close();
  }
}
await browser.close();
console.log('capturas em', OUT);
process.exit(total ? 1 : 0);
