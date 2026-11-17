// Gravação curta da rolagem pela cena do hero (desktop e celular). docs/HERO-360.md.
//   docker compose up -d; cd frontend; node perf/hero-360-gravar.mjs <pasta>   (depois, reencodar a 250 kbit/s: ver docs)
import { mkdirSync, renameSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = '../docs/visual/hero-360'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
for (const [name, vp, mobile] of [['desktop', { width: 1280, height: 720 }, false], ['celular', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport: vp, isMobile: mobile, hasTouch: mobile, recordVideo: { dir: OUT, size: vp } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => ['video', 'frames', 'static'].includes(window.__heroSeq?.state().mode), null, { timeout: 30000 });
  const g = await page.evaluate(() => { const s = document.getElementById('inicio'); return { top: s.offsetTop, range: s.offsetHeight - innerHeight }; });
  await page.evaluate(([y]) => scrollTo(0, y), [g.top + 0.62 * g.range]);
  await page.waitForTimeout(1200);
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < 90; i++) { await page.mouse.wheel(0, (0.4 * g.range) / 90); await page.waitForTimeout(55); }
  await page.waitForTimeout(900);
  for (let i = 0; i < 30; i++) { await page.mouse.wheel(0, -(0.2 * g.range) / 30); await page.waitForTimeout(40); } // subir volta a cena
  await page.waitForTimeout(700);
  const path = await page.video().path();
  await ctx.close();
  renameSync(path, `${OUT}/rolagem-${name}-bruto.webm`);
}
await browser.close();
