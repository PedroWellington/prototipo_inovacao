// Capturas da caixa de pergunta do assistente (vazia, com foco e preenchida) nos dois temas, desktop e celular,
// e axe (WCAG A/AA) com o painel aberto; sai com código 1 se houver violação. Nenhuma pergunta é enviada.
//   docker compose up -d; cd frontend; node perf/assistente-campo.mjs <pasta>      (BASE=http://host:porta)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = 'perf/shots-assistente'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
mkdirSync(OUT, { recursive: true });
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });

const setup = await browser.newContext({ bypassCSP: true });
await setup.request.post(`${BASE}/api/auth/register`, { data: { name: 'Ana Campo', email: `campo-${Date.now()}@example.com`, password: 'campo-senha-12345', accept_terms: true } });
const { csrf_token } = await (await setup.request.get(`${BASE}/api/auth/me`)).json();
const headers = { 'X-CSRF-Token': csrf_token };
await setup.request.put(`${BASE}/api/profile`, { headers, data: { segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: false,
  criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 4 }] } });
await setup.request.post(`${BASE}/api/auth/tutorial`, { headers });
const state = await setup.storageState();
await setup.close();

let total = 0;
for (const theme of ['claro', 'escuro']) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const mobile = device === 'celular';
    const ctx = await browser.newContext({ bypassCSP: true, viewport, storageState: state, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme === 'escuro' ? 'dark' : 'light');
    // Assistente visível mesmo com a flag desligada neste servidor (só a flag pública; nada é enviado).
    await ctx.route('**/api/config', async (r) => { const res = await r.fetch(); await r.fulfill({ response: res, json: { ...(await res.json()), assistant: true } }); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(`${BASE}/app/#/home`);
    await page.click('.ai-fab');
    await page.waitForSelector('.ai.is-open .ai-panel');
    await page.waitForTimeout(600);
    const form = page.locator('.ai-form');
    const shot = (n) => form.screenshot({ path: `${OUT}/${theme}-${device}-${n}.png` });
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(200);
    await shot('vazio');
    await page.addScriptTag({ content: AXE });
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((x) => `${x.id} (${x.nodes.length})`));
    total += v.length;
    console.log(`${v.length ? '❌' : '✅'} ${theme} ${device}: assistente aberto: ${v.length} violação(ões) ${v.join(', ')}`);
    await page.focus('#aiInput');
    await page.waitForTimeout(200);
    await shot('foco');
    await page.fill('#aiInput', 'Como a cobertura é calculada?');
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(200);
    await shot('preenchido');
    await ctx.close();
  }
}
await browser.close();
console.log('capturas em', OUT);
process.exit(total ? 1 : 0);
