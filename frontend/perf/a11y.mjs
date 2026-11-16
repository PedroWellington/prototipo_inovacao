// Verificação automática de acessibilidade (axe-core, regras WCAG 2.0/2.1 A e AA, contraste incluído) nas
// telas principais: landing, login, cadastro, onboarding, visão geral, explorador (início, ranking, detalhes),
// conta e termos. Desktop e celular.   docker compose up -d --build; cd frontend; node perf/a11y.mjs
// Cria um usuário descartável (a11y-…@example.com). Sai com código 1 se houver violação.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const rows = [];

async function check(page, name) {
  await page.waitForTimeout(900); // animações de entrada terminam antes da medição de contraste
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }),
  );
  const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, alvo: x.nodes.slice(0, 3).map((n) => n.target.join(' ')), resumo: x.nodes[0]?.failureSummary?.split('\n')[1]?.trim() }));
  rows.push({ tela: name, violacoes: v.reduce((a, x) => a + x.n, 0), regras: v });
}

for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport, isMobile: device === 'celular', hasTouch: device === 'celular' });
  const page = await ctx.newPage();
  const d = (n) => `${device}: ${n}`;
  await page.goto(`${BASE}/`, { waitUntil: 'load' }); await check(page, d('landing (topo)'));
  await page.evaluate(() => scrollTo(0, document.getElementById('planos').offsetTop)); await check(page, d('landing (planos)'));
  await page.goto(`${BASE}/app/#/login`); await page.waitForSelector('#email'); await check(page, d('login'));
  await page.goto(`${BASE}/app/#/register`); await page.waitForSelector('#name'); await check(page, d('cadastro'));
  await page.fill('#name', 'Ana Acessível'); await page.fill('#email', `a11y-${Date.now()}-${device}@example.com`); await page.fill('#password', 'a11y-senha-12345');
  await page.check('input[name="accept_terms"]'); await page.click('button[type="submit"]');
  await page.waitForURL(/#\/onboarding/); await page.waitForSelector('.ob-card'); await check(page, d('onboarding'));
  for (let i = 0; i < 10 && !/#\/home/.test(page.url()); i++) {
    await page.waitForSelector('.ob-card, [data-dashboard]');
    if (await page.$('[data-dashboard]')) break;
    if (/sede/i.test(await page.textContent('.ob-card h1'))) await page.click('.tile[data-value="false"]');
    else if ((await page.$('.tile[aria-checked="false"]')) && !(await page.$('.tile[aria-checked="true"]'))) await page.click('.tile >> nth=0');
    const submit = page.locator('.ob-card button[type="submit"]');
    if ((await submit.isDisabled()) && (await page.$('[data-skip]'))) await page.click('[data-skip]');
    else await submit.click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('[data-sources] .ov-source-list'); await check(page, d('visão geral'));
  await page.goto(`${BASE}/app/#/explorer`); await page.waitForSelector('.maplibregl-canvas'); await check(page, d('explorador (início)'));
  await page.goto(`${BASE}/app/#/explorer?city=2611606`); await page.click('dialog .btn-primary', { timeout: 20000 });
  await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  if (device === 'celular') await page.tap('[data-sheet]');
  await check(page, d('explorador (ranking do Recife)'));
  await page.click('[data-rank-list] li >> nth=0 >> button'); await check(page, d('explorador (detalhes do bairro)'));
  await page.goto(`${BASE}/app/#/conta`); await page.waitForSelector('[data-logout]'); await check(page, d('minha conta'));
  await page.goto(`${BASE}/app/#/termos`); await check(page, d('termos'));
  await ctx.close();
}
await browser.close();
for (const r of rows) {
  console.log(`${r.violacoes ? '❌' : '✅'} ${r.tela}: ${r.violacoes} violação(ões)`);
  for (const x of r.regras) console.log(`    ${x.id} (${x.impact}, ${x.n}): ${x.alvo.join(' | ')} — ${x.resumo || ''}`);
}
process.exitCode = rows.some((r) => r.violacoes) ? 1 : 0;
