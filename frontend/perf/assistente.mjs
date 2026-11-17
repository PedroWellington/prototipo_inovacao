// Assistente de IA e tutorial: comportamento e capturas (claro e escuro, desktop e celular).
//   Precisa do servidor com AI_ASSISTANT_ENABLED=true. Sem chave válida do Groq, confere o caminho de erro
//   ("Assistente indisponível no momento.") e que o resto do site segue funcionando.
//   docker compose up -d; cd frontend; node perf/assistente.mjs [pasta das capturas]      (BASE=...)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = '../docs/visual/assistente'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
const RECIFE = 2611606;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++; };

async function newUser(tag) {
  const setup = await browser.newContext({ bypassCSP: true });
  await setup.request.post(`${BASE}/api/auth/register`, { data: { name: 'Ana Assistente', email: `ai-${tag}-${Date.now()}@example.com`, password: 'ai-senha-12345', accept_terms: true } });
  const { csrf_token } = await (await setup.request.get(`${BASE}/api/auth/me`)).json();
  const headers = { 'X-CSRF-Token': csrf_token };
  await setup.request.put(`${BASE}/api/profile`, { headers, data: { segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: true, hq_uf: 'PE', hq_municipality_ibge: RECIFE,
    criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 4 }, { business_type_key: 'clinica', direction: 'attract', weight: 3 }, { business_type_key: 'farmacia', direction: 'repel', weight: 2 }] } });
  await setup.request.post(`${BASE}/api/credits/cities/${RECIFE}`, { headers });
  const state = await setup.storageState();
  await setup.close();
  return state;
}

// Comportamento (desktop claro)
{
  const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, storageState: await newUser('comp') });
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/`); await page.waitForTimeout(1200);
  expect(!(await page.$('.ai-fab')), 'landing pública: sem o botão do assistente');
  await page.goto(`${BASE}/app/#/home`); await page.waitForSelector('.tour.is-open .tour-card', { timeout: 15000 });
  await page.keyboard.press('Escape'); // fecha o tutorial (conta como concluído)
  await page.waitForSelector('.ai-fab');
  for (const route of ['#/analises', '#/comparar', '#/dados', '#/criterios', '#/conta', `#/explorer?city=${RECIFE}`]) {
    await page.goto(`${BASE}/app/${route}`); await page.waitForTimeout(900);
    expect(Boolean(await page.$('.ai-fab')), `botão presente em ${route.split('?')[0]}`);
  }
  await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  // O botão não cobre a atribuição do OSM nem os controles do mapa.
  const overlap = await page.evaluate(() => {
    const f = document.querySelector('.ai-fab').getBoundingClientRect();
    return [...document.querySelectorAll('.maplibregl-ctrl-attrib, .maplibregl-ctrl-group')].some((c) => {
      const r = c.getBoundingClientRect();
      return r.width && f.left < r.right && f.right > r.left && f.top < r.bottom && f.bottom > r.top;
    });
  });
  expect(!overlap, 'botão não cobre atribuição do OSM nem controles do mapa');
  await page.keyboard.press('Alt+A'); await page.waitForSelector('.ai.is-open .ai-panel');
  expect(await page.evaluate(() => document.activeElement?.id === 'aiInput'), 'Alt+A abre e põe o foco na pergunta');
  await page.fill('#aiInput', 'Como a nota é calculada?'); await page.keyboard.press('Enter');
  await page.waitForSelector('.ai-error, .ai-assistant', { timeout: 30000 });
  const err = await page.textContent('.ai-error, .ai-assistant');
  expect(/indisponível no momento|nota/i.test(err), `resposta ou erro tratado: "${err.slice(0, 60)}"`);
  expect(await page.evaluate(() => Boolean(document.querySelector('.maplibregl-canvas'))), 'mapa segue na tela depois do erro');
  // Conversa sobrevive à troca de aba (o componente não é remontado).
  const node = await page.evaluateHandle(() => document.querySelector('.ai'));
  await page.click('.topnav [data-nav="analises"]'); await page.waitForSelector('[data-cx]');
  await page.click('.topnav [data-nav="home"]'); await page.waitForSelector('[data-cx]');
  const same = await page.evaluate((n) => n === document.querySelector('.ai') && document.querySelectorAll('.ai-msg').length >= 2, node);
  expect(same, 'conversa e componente sobrevivem à troca de aba');
  await page.focus('#aiInput'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  expect(await page.evaluate(() => !document.querySelector('.ai').classList.contains('is-open') && document.activeElement?.classList.contains('ai-fab')), 'Esc fecha e devolve o foco ao botão');
  expect(!errors.length, `sem erro de página ${errors.join(' | ')}`);
  await ctx.close();
}

// Capturas: tutorial e assistente, dois temas, desktop e celular
for (const theme of ['claro', 'escuro']) {
  for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
    const mobile = device === 'celular';
    const ctx = await browser.newContext({ bypassCSP: true, viewport, storageState: await newUser(`${theme}${device}`), deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme === 'escuro' ? 'dark' : 'light');
    const page = await ctx.newPage();
    const shot = (name) => page.screenshot({ path: `${OUT}/${theme}-${device}-${name}.png` });
    await page.goto(`${BASE}/app/#/home`); await page.waitForSelector('.tour.is-open .tour-card', { timeout: 15000 }); await page.waitForTimeout(700);
    await shot('tutorial-1');
    await page.click('[data-tour-next]'); await page.waitForTimeout(800); await shot('tutorial-2');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('.ai-fab'); await page.waitForSelector('.ai.is-open .ai-panel'); await page.waitForTimeout(450);
    await shot('assistente-aberto');
    await page.fill('#aiInput', 'O que significa cobertura?'); await page.click('[data-ai-send]');
    await page.waitForSelector('.ai-error, .ai-assistant', { timeout: 30000 }); await page.waitForTimeout(300);
    await shot('assistente-resposta');
    await page.click('[data-ai-close]'); await page.waitForTimeout(300);
    await page.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
    await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 }); await page.waitForTimeout(1200);
    await shot('explorador-com-botao');
    await ctx.close();
  }
}
await browser.close();
console.log(fail ? `${fail} falha(s)` : 'ok');
process.exit(fail ? 1 : 0);
