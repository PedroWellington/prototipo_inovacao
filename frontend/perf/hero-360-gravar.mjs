// Gravação da rolagem completa do hero (desktop e celular). docs/HERO-360.md.
//   docker compose up -d; cd frontend; node perf/hero-360-gravar.mjs <pasta>
// Depois, comprimir (VP8 a 250 kbit/s) com o ffmpeg do Playwright: ver docs/HERO-360.md.
import { mkdirSync, renameSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [, , OUT = '../docs/visual/hero-360'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
for (const [name, vp, mobile] of [['desktop', { width: 1280, height: 720 }, false], ['celular', { width: 390, height: 844 }, true]]) {
  // Espera o mapa ficar pronto numa aba sem gravar (o cache HTTP é o mesmo); a gravação começa já no topo.
  const ctx = await browser.newContext({ bypassCSP: true, viewport: vp, isMobile: mobile, hasTouch: mobile, recordVideo: { dir: OUT, size: vp } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => window.__hero?.mode === 'map', null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  const g = await page.evaluate(() => { const s = document.getElementById('inicio'); return { top: s.offsetTop, range: s.offsetHeight - innerHeight }; });
  await page.mouse.move(vp.width / 2, vp.height / 2);
  const steps = 260;
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, (1.02 * g.range) / steps); await page.waitForTimeout(50); }
  await page.waitForTimeout(1500);
  for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, -(0.3 * g.range) / 60); await page.waitForTimeout(45); } // subir desfaz na mesma curva
  await page.waitForTimeout(800);
  const path = await page.video().path();
  await ctx.close();
  renameSync(path, `${OUT}/rolagem-${name}-bruto.webm`);
}
await browser.close();
