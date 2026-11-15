// Gera frontend/public/brand/og-image.png (1200x630: ícone + nome em fundo escuro) com a fonte Inter real.
//   node scripts/build-og.mjs [pasta-de-prévia]   (usa o Edge instalado, via playwright-core do frontend)
// Com uma pasta de prévia, também salva as duas logos horizontais sobre fundo claro e escuro, para conferir.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(ROOT, 'frontend/package.json'))('playwright-core');
const BRAND = join(ROOT, 'frontend/public/brand');
const font = readFileSync(join(ROOT, 'landing/assets/fonts/inter-latin-wght.woff2')).toString('base64');
const icon = readFileSync(join(BRAND, 'vicus-icone-512.png')).toString('base64');
const preview = process.argv[2];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(`<!doctype html><html><head><style>
  @font-face{font-family:Inter;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format('woff2')}
  html,body{margin:0;width:1200px;height:630px;background:radial-gradient(ellipse at 70% 30%,#352D27,#221D1A 55%,#181512);font-family:Inter}
  .wrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:44px}
  img{width:220px;height:220px}
  h1{margin:0;color:#F3EDE7;font-size:132px;font-weight:600;letter-spacing:.16em}
  p{margin:14px 0 0;color:#EBA774;font-size:30px;letter-spacing:.24em;text-transform:uppercase;font-weight:500}
</style></head><body><div class="wrap"><img src="data:image/png;base64,${icon}" alt=""><div><h1>VICUS</h1><p>Inteligência territorial</p></div></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
writeFileSync(join(BRAND, 'og-image.png'), await page.screenshot({ type: 'png' }));
console.log('og-image.png 1200x630');

if (preview) {
  await page.setViewportSize({ width: 960, height: 300 });
  const claro = readFileSync(join(BRAND, 'vicus-logo-claro.svg'), 'utf8');
  const escuro = readFileSync(join(BRAND, 'vicus-logo-escuro.svg'), 'utf8');
  await page.setContent(`<body style="margin:0;display:grid;grid-template-columns:1fr 1fr;height:300px">
    <div style="background:#f6f5f1;display:grid;place-items:center">${claro.replace('width="430" height="100"', 'width="400"')}</div>
    <div style="background:#181512;display:grid;place-items:center">${escuro.replace('width="430" height="100"', 'width="400"')}</div></body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(preview, 'logos.png') });
}
await browser.close();
