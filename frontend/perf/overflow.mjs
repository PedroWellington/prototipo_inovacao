// Nada cortado, nada de rolagem horizontal: página, painel esquerdo e painel direito do explorador (Recife) e
// a visão geral, em 8 larguras x 3 zooms (zoom do navegador = viewport CSS menor com mais pixels por ponto).
//   docker compose up -d --build; cd frontend; node perf/overflow.mjs      (SHOTS=pasta para capturas do painel)
// Falha (código 1) se scrollWidth > clientWidth na página ou num painel, ou se um texto com reticências
// estiver cortado sem o texto completo no title.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const WIDTHS = [320, 360, 390, 768, 1024, 1280, 1440, 1920];
const ZOOMS = [1, 1.25, 1.5];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const fails = [];

// Usuário com sede no Recife e o Recife liberado (uma vez); as larguras reaproveitam a sessão.
const setup = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const sp = await setup.newPage();
await sp.goto(`${BASE}/app/#/register`);
await sp.fill('#name', 'Maria Aparecida de Albuquerque Cavalcanti'); // nome longo de propósito
await sp.fill('#email', `overflow-${Date.now()}@example.com`); await sp.fill('#password', 'overflow-senha-123');
await sp.check('input[name="accept_terms"]'); await sp.click('button[type="submit"]'); await sp.waitForURL(/#\/onboarding/);
for (let i = 0; i < 10 && !/#\/home/.test(sp.url()); i++) {
  await sp.waitForSelector('.ob-card, [data-dashboard]');
  if (await sp.$('[data-dashboard]')) break;
  if (/sede/i.test(await sp.textContent('.ob-card h1'))) await sp.click('.tile[data-value="false"]');
  else if ((await sp.$('.tile[aria-checked="false"]')) && !(await sp.$('.tile[aria-checked="true"]'))) await sp.click('.tile >> nth=0');
  const submit = sp.locator('.ob-card button[type="submit"]');
  if ((await submit.isDisabled()) && (await sp.$('[data-skip]'))) await sp.click('[data-skip]');
  else await submit.click();
  await sp.waitForTimeout(400);
}
await sp.goto(`${BASE}/app/#/explorer?city=2611606`);
await sp.click('dialog .btn-primary', { timeout: 20000 });
await sp.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
const state = await setup.storageState();
await setup.close();

const check = () =>
  document.fonts.ready.then(() => {
    const out = [];
    const doc = document.scrollingElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`página: scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}`);
    for (const sel of ['.ex-left', '.ex-right', '.right-body']) {
      const el = [...document.querySelectorAll(sel)].find((e) => !e.closest('.view-layer:not(.is-shown)'));
      if (el && el.scrollWidth > el.clientWidth + 1) out.push(`${sel}: scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
    }
    // Texto com reticências cortado: precisa do texto completo no title (dele ou de um ancestral próximo).
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.textOverflow !== 'ellipsis' || el.scrollWidth <= el.clientWidth + 1 || !el.offsetParent || el.closest('.view-layer:not(.is-shown)')) continue;
      if (!el.closest('[title]')) out.push(`cortado sem title: "${el.textContent.trim().slice(0, 40)}"`);
    }
    return out;
  });

for (const w of WIDTHS) {
  for (const z of ZOOMS) {
    const vw = Math.round(w / z);
    const mobile = vw <= 860;
    const ctx = await browser.newContext({ viewport: { width: vw, height: Math.round(900 / z) }, deviceScaleFactor: z, storageState: state });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app/#/explorer?city=2611606`);
    await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
    // Painel esquerdo sempre aberto na medição (no celular é gaveta; abaixo de 1100 px começa recolhido).
    if (await page.$('[data-toggle-panel][aria-expanded="false"]')) await page.click('[data-toggle-panel]');
    if (mobile) await page.waitForSelector('.drawer-open');
    await page.waitForTimeout(500);
    for (const f of await page.evaluate(check)) fails.push(`${w}px @${z * 100}% explorador: ${f}`);
    if (process.env.SHOTS && [1280, 390].includes(w) && z !== 1.5) await page.locator('.ex-left').screenshot({ path: `${process.env.SHOTS}-${w}-${z * 100}.png` });
    await page.goto(`${BASE}/app/#/home`);
    await page.waitForSelector('[data-dashboard]');
    await page.waitForTimeout(400);
    for (const f of await page.evaluate(check)) fails.push(`${w}px @${z * 100}% visão geral: ${f}`);
    await ctx.close();
  }
}
await browser.close();
const uniq = [...new Set(fails)];
console.log(uniq.length ? uniq.join('\n') : `✅ nenhum transbordamento em ${WIDTHS.length} larguras x ${ZOOMS.length} zooms`);
process.exitCode = uniq.length ? 1 : 0;
