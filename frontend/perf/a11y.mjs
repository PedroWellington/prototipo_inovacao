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

for (const [device, viewport, theme] of [['desktop', { width: 1440, height: 900 }, 'light'], ['celular', { width: 390, height: 844 }, 'light'], ['desktop escuro', { width: 1440, height: 900 }, 'dark'], ['celular escuro', { width: 390, height: 844 }, 'dark']]) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport, isMobile: device.startsWith('celular'), hasTouch: device.startsWith('celular') });
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme); // os dois temas (public/theme.js lê localStorage)
  const page = await ctx.newPage();
  const d = (n) => `${device}: ${n}`;
  await page.goto(`${BASE}/`, { waitUntil: 'load' }); await check(page, d('landing (topo)'));
  // Textos do hero por cima do mapa real (docs/HERO-360.md): no meio do mergulho e no fim, com o holograma.
  for (const [q, nome] of [[0.5, 'hero no mapa (capítulo 4)'], [0.97, 'hero no fim (holograma)']]) {
    await page.waitForFunction(() => window.__hero && window.__hero.mode !== 'loading', null, { timeout: 90000 }).catch(() => {});
    await page.evaluate((x) => { const st = document.getElementById('inicio'); scrollTo(0, st.offsetTop + x * (st.offsetHeight - innerHeight)); }, q);
    await page.waitForTimeout(1500);
    await check(page, d(`landing (${nome})`));
  }
  await page.evaluate(() => scrollTo(0, document.getElementById('planos').offsetTop)); await check(page, d('landing (planos)'));
  await page.goto(`${BASE}/app/#/login`); await page.waitForSelector('#email'); await check(page, d('login'));
  await page.goto(`${BASE}/app/#/register`); await page.waitForSelector('#name'); await check(page, d('cadastro'));
  await page.fill('#name', 'Ana Acessível'); await page.fill('#email', `a11y-${Date.now()}-${device.replace(/\W/g, '')}@example.com`); await page.fill('#password', 'a11y-senha-12345');
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
  await page.waitForSelector('.tour.is-open .tour-card', { timeout: 15000 }); await page.waitForTimeout(400); await check(page, d('tutorial (passo 1)'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-dashboard] .ov-hero'); await check(page, d('visão geral'));
  if (await page.$('.ai-fab')) { // assistente ligado neste servidor: painel aberto também passa pelo axe
    await page.click('.ai-fab'); await page.waitForSelector('.ai.is-open .ai-panel'); await page.waitForTimeout(400); await check(page, d('assistente aberto'));
    await page.click('[data-ai-close]'); await page.waitForTimeout(300);
  }
  await page.goto(`${BASE}/app/#/analises`); await page.waitForSelector('.ov-analyses, .ov-empty-big'); await check(page, d('análises'));
  await page.goto(`${BASE}/app/#/dados`); await page.waitForSelector('.src-table'); await check(page, d('dados e fontes'));
  await page.goto(`${BASE}/app/#/explorer`); await page.waitForSelector('.maplibregl-canvas'); await check(page, d('explorador (início)'));
  await page.goto(`${BASE}/app/#/explorer?city=2611606`); await page.click('dialog .btn-primary', { timeout: 20000 });
  await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  if (device.startsWith('celular')) await page.tap('[data-sheet]');
  await check(page, d('explorador (ranking do Recife)'));
  await page.click('[data-rank-list] li >> nth=0 >> button'); await check(page, d('explorador (detalhes do bairro)'));
  const hood = await page.evaluate(() => document.querySelector('[data-holo]').holoState().top[0]);
  await page.goto(`${BASE}/app/#/bairro/${hood}?city=2611606`); await page.waitForSelector('.metric.is-primary', { timeout: 30000 }); await check(page, d('detalhe do bairro'));
  await page.goto(`${BASE}/app/#/roteiro?city=2611606`); await page.waitForSelector('[data-pick]', { timeout: 30000 }); await check(page, d('roteiro (escolha)'));
  for (let i = 0; i < 3; i++) await page.locator('[data-pick]').nth(i).check();
  await page.click('[data-plan]'); await page.waitForSelector('[data-stop]', { timeout: 30000 }); await check(page, d('roteiro (checklist)'));
  await page.goto(`${BASE}/app/#/apresentacao?city=2611606`); await page.waitForSelector('.slide', { timeout: 30000 }); await check(page, d('apresentação'));
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await check(page, d('apresentação (bairro)'));
  await page.goto(`${BASE}/app/#/criterios`); await page.waitForSelector('[data-body] h2'); await check(page, d('editor de critérios'));
  await page.click('[data-step="3"]'); await check(page, d('editor de critérios (pesos)'));
  await page.goto(`${BASE}/app/#/comparar`); await page.waitForSelector('.cmp-grid'); await check(page, d('comparar'));
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
