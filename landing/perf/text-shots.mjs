// Capturas de trechos de texto em escalas do Windows (100%, 125%, 150%) para conferir nitidez.
//   node perf/text-shots.mjs <prefixo> [landing-url] [app-url]
import { chromium } from 'playwright-core';
const [,, out, LANDING = 'http://localhost:4173/', APP = 'http://localhost:8080/'] = process.argv;
const b = await chromium.launch({ channel: 'msedge', headless: true });
for (const dpr of [1, 1.25, 1.5]) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  await p.goto(LANDING, { waitUntil: 'load' }); await p.waitForTimeout(1500);
  // Capítulo 01 parado (p = 0) e capítulo 04 no meio da sua faixa (p = 0,50)
  await p.locator('.chapter').nth(0).screenshot({ path: `${out}-landing-cap01-${dpr}.png` });
  await p.evaluate(() => { const s = document.querySelector('.story'); scrollTo(0, s.offsetTop + 0.5 * (s.offsetHeight - innerHeight)); });
  await p.waitForTimeout(1500);
  await p.locator('.chapter').nth(3).screenshot({ path: `${out}-landing-cap04-${dpr}.png` });
  await p.goto(APP + '#/login', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await p.locator('.auth-card').screenshot({ path: `${out}-app-login-${dpr}.png` });
  await ctx.close();
}
await b.close();
