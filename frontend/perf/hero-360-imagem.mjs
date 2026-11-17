// Gera a imagem estática do enquadramento final do hero (reserva: aparelho fraco, conexão ruim, falha, sem JS).
// É uma captura da própria cena real (mapa + holograma + atribuição do OSM), sem os textos da página.
//   docker compose up -d; cd frontend; node perf/hero-360-imagem.mjs <saida.png>
//   depois: python -I -c "from PIL import Image; Image.open('<saida.png>').convert('RGB').save('../landing/assets/hero-final.webp', 'WEBP', quality=80, method=6)"
import { chromium } from 'playwright-core';

const [, , OUT = 'hero-final.png'] = process.argv;
const BASE = process.env.BASE || 'http://localhost:8080';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, bypassCSP: true });
await page.goto(`${BASE}/`);
await page.waitForFunction(() => window.__hero?.mode === 'map', null, { timeout: 60000 });
await page.evaluate(() => { const s = document.getElementById('inicio'); scrollTo(0, s.offsetTop + (s.offsetHeight - innerHeight)); });
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '.chapters,.chapter,.stage-bottom,.eyebrow,.scene-scale,.store-vignette,.navbar,.scroll-progress,.geo-pill,.stage-mobile-caption{visibility:hidden!important}' });
await page.waitForTimeout(600);
await page.locator('#heroMap').screenshot({ path: OUT });
await browser.close();
console.log('ok:', OUT);
