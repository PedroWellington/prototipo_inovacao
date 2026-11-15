// Fluidez do explorador (metas em landing/docs/PERFORMANCE.md): intervalo entre quadros durante a câmera
// (cliques no ranking voam até cada bairro), em 2D e com Relevo, com CPU normal e 4x mais lenta.
//   docker compose up -d --build; cd frontend; node perf/explorer-fps.mjs        (BASE=..., HEADLESS=1)
// Cria um usuário descartável (fps-…@example.com) e gasta o crédito grátis no Recife.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: process.env.HEADLESS === '1' });
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
  return { n: s.length, p50: +at(50).toFixed(1), p95: +at(95).toFixed(1), max: +s.at(-1).toFixed(1), over50: s.filter((x) => x > 50).length };
};

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/app/#/register`);
await page.fill('#name', 'Fps Teste'); await page.fill('#email', `fps-${Date.now()}@example.com`); await page.fill('#password', 'fps-senha-12345');
await page.check('input[name="accept_terms"]'); await page.click('button[type="submit"]');
await page.waitForURL(/#\/onboarding/);
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
await page.goto(`${BASE}/app/#/explorer?city=2611606`);
await page.click('dialog .btn-primary', { timeout: 20000 });
await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(page);

const out = [];
for (const cpu of [1, 4]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  for (const mode of ['off', 'on']) {
    await page.click(`[data-relief="${mode}"]`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__f = [];
      let last = 0;
      const tick = (t) => {
        if (last) window.__f.push(t - last);
        last = t;
        if (window.__f) window.__raf = requestAnimationFrame(tick);
      };
      window.__raf = requestAnimationFrame(tick);
    });
    for (let i = 0; i < 6; i++) {
      await page.click(`[data-rank-list] li >> nth=${i} >> button`).catch(() => {});
      await page.click('[data-tab="ranking"]');
      await page.waitForTimeout(1400);
    }
    const f = await page.evaluate(() => {
      cancelAnimationFrame(window.__raf);
      const x = window.__f;
      window.__f = null;
      return x;
    });
    const r = { cpu, relevo: mode === 'on', ...stats(f), fps_media: +(1000 / (f.reduce((a, b) => a + b, 0) / f.length)).toFixed(1) };
    out.push(r);
    console.log(JSON.stringify(r));
  }
}
await browser.close();
