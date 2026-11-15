// Capturas das telas principais do app (antes/depois de mudanças visuais), com o Edge instalado.
//   node perf/screens.mjs <pasta> [rotulo]        (BASE=http://host:porta; padrão http://localhost:8080)
// Cria um usuário descartável (shots-…@example.com) com sede no Recife e gasta o crédito grátis no Recife.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = 'perf/shots', LABEL = 'tela'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
const RECIFE = 2611606;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${LABEL}-${name}.png` });
const settle = (page, ms = 900) => page.waitForTimeout(ms);

async function onboarding(page) {
  for (let i = 0; i < 10 && !/#\/home/.test(page.url()); i++) {
    await page.waitForSelector('.ob-card, .home, [data-dashboard]', { timeout: 10000 });
    if (await page.$('.home, [data-dashboard]')) break;
    const h1 = await page.textContent('.ob-card h1');
    if (/sede/i.test(h1)) {
      await page.click('.tile[data-value="true"]');
      await page.selectOption('#uf', 'PE');
      await page.waitForSelector(`#city option[value="${RECIFE}"]`, { state: 'attached' });
      await page.selectOption('#city', String(RECIFE));
      await page.fill('#hood', 'Boa Vista');
    } else if ((await page.$('.tile[aria-checked="false"]')) && !(await page.$('.tile[aria-checked="true"]'))) await page.click('.tile >> nth=0');
    const submit = page.locator('.ob-card button[type="submit"]');
    if ((await submit.isDisabled()) && (await page.$('[data-skip]'))) await page.click('[data-skip]');
    else await submit.click();
    await settle(page, 500);
  }
  await page.waitForURL(/#\/home/, { timeout: 15000 });
}

for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: device === 'celular' ? 2 : 1, isMobile: device === 'celular', hasTouch: device === 'celular' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const d = (n) => `${device}-${n}`;
  await page.goto(`${BASE}/app/#/login`); await page.waitForSelector('#email'); await settle(page); await shot(page, d('login'));
  await page.goto(`${BASE}/app/#/register`); await page.waitForSelector('#name'); await settle(page); await shot(page, d('cadastro'));
  await page.fill('#name', 'Ana Telas'); await page.fill('#email', `shots-${Date.now()}-${device}@example.com`); await page.fill('#password', 'telas-senha-123');
  await page.check('input[name="accept_terms"]'); await page.click('button[type="submit"]');
  await page.waitForURL(/#\/onboarding/); await page.waitForSelector('.ob-card'); await settle(page); await shot(page, d('onboarding'));
  await onboarding(page);
  await settle(page, 1500); await shot(page, d('inicio'));
  await page.goto(`${BASE}/app/#/explorer`); await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }); await settle(page, 2000); await shot(page, d('explorador'));
  await page.goto(`${BASE}/app/#/explorer?city=${RECIFE}`);
  await page.waitForSelector('dialog .btn-primary', { timeout: 20000 }); await shot(page, d('confirmar-credito'));
  await page.click('dialog .btn-primary');
  await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  await settle(page, 2500); await shot(page, d('recife'));
  await page.goto(`${BASE}/app/#/home`); await settle(page, 2000); await shot(page, d('inicio-com-analise'));
  await page.goto(`${BASE}/app/#/conta`); await settle(page); await shot(page, d('conta'));
  await page.goto(`${BASE}/app/#/termos`); await settle(page); await shot(page, d('termos'));
  await ctx.close();
}
await browser.close();
console.log('capturas em', OUT);
