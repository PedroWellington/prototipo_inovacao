// Hero 360: casos que precisam cair no quadro estático (ou nunca ficar pretos). docs/HERO-360.md.
//   docker compose up -d; cd frontend; node perf/hero-360-casos.mjs [pasta para capturas]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.argv[2];
if (OUT) mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
let fail = 0;
const expect = (ok, msg) => { console.log(`${ok ? '✅' : '❌'} ${msg}`); if (!ok) fail++; };
const hero = (url) => /\/app\/hero-360\//.test(url);

async function open(opts = {}, setup = async () => {}) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const asked = [];
  page.on('request', (r) => hero(r.url()) && asked.push(r.url().split('/hero-360/')[1]));
  await setup(page, ctx);
  await page.goto(`${BASE}/`);
  await page.waitForLoadState('load');
  return { ctx, page, asked };
}
const toScene = async (page, p) => {
  await page.evaluate((q) => { const s = document.getElementById('inicio'); scrollTo(0, s.offsetTop + q * (s.offsetHeight - innerHeight)); }, p);
  await page.waitForTimeout(1200);
};
// Um ponto no meio da cena: pixel escuro demais em toda a tela = tela preta.
const notBlack = (page) => page.evaluate(async () => {
  const el = document.querySelector('.hero-seq');
  const cs = getComputedStyle(el);
  return { visible: cs.visibility === 'visible' && Number(cs.opacity) > 0.5, still: document.querySelector('.hero-seq-still').naturalWidth > 0 };
});

// 1. Movimento reduzido: sem sequência, sem baixar vídeo nem quadros; último quadro estático no fluxo.
{
  const { ctx, page, asked } = await open({ reducedMotion: 'reduce' });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => {
    const img = document.querySelector('.hero-seq-still');
    const story = document.getElementById('inicio');
    return { src: img.currentSrc.split('/').pop(), h: story.offsetHeight, vh: innerHeight, seq: Boolean(window.__heroSeq), video: Boolean(document.querySelector('.hero-seq-video')) };
  });
  expect(r.src === '359.webp' && !r.seq && !r.video, `movimento reduzido: quadro final (${r.src}), sem sequência nem vídeo`);
  expect(r.h < 3 * r.vh, `movimento reduzido: hero sem o container alto (${r.h}px para janela de ${r.vh}px)`);
  const vis = await page.evaluate(() => { const el = document.querySelector('.hero-seq'); const cs = getComputedStyle(el); return { op: cs.opacity, vis: cs.visibility, h: el.offsetHeight }; });
  expect(Number(vis.op) === 1 && vis.vis === 'visible' && vis.h > 200, `movimento reduzido: quadro final visível (${vis.h}px de altura)`);
  expect(asked.every((u) => u === 'v1/f/359.webp'), `movimento reduzido: só baixou ${asked.join(', ') || 'nada'}`);
  if (OUT) { await page.evaluate(() => document.querySelector('.hero-seq').scrollIntoView()); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/movimento-reduzido.png` }); }
  await ctx.close();
}
// 2. Sem JavaScript: o quadro estático aparece (noscript), nada preto.
{
  const { ctx, page } = await open({ javaScriptEnabled: false });
  await page.waitForTimeout(1500);
  const r = await notBlack(page);
  expect(r.visible && r.still, 'sem JavaScript: cena visível com o quadro estático');
  if (OUT) await page.screenshot({ path: `${OUT}/sem-javascript.png` });
  await ctx.close();
}
// 3. Conexão lenta (economia de dados): quadro estático direto, sem vídeo nem quadros.
{
  const { ctx, page, asked } = await open({}, async (p) => {
    await p.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '2g' } }));
  });
  await page.waitForTimeout(4000);
  const st = await page.evaluate(() => window.__heroSeq.state());
  expect(st.mode === 'static' && !asked.some((u) => u.endsWith('.webm')), `conexão lenta: caminho ${st.mode} (${st.why}), baixou ${asked.join(', ')}`);
  await toScene(page, 0.9);
  const r = await notBlack(page);
  expect(r.visible && r.still, 'conexão lenta: cena com o quadro final');
  await ctx.close();
}
// 4. Aparelho fraco: estático.
{
  const { ctx, page } = await open({}, async (p) => {
    await p.addInitScript(() => { Object.defineProperty(navigator, 'deviceMemory', { value: 1 }); Object.defineProperty(navigator, 'hardwareConcurrency', { value: 2 }); });
  });
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => window.__heroSeq.state());
  expect(st.mode === 'static', `aparelho fraco: caminho ${st.mode} (${st.why})`);
  await ctx.close();
}
// 5. Vídeo falha (bloqueado): cai para os quadros, sem buraco.
{
  const { ctx, page } = await open({}, async (p) => { await p.route('**/sequencia.webm', (r) => r.abort()); });
  await page.waitForFunction(() => window.__heroSeq.state().mode === 'frames', null, { timeout: 30000 });
  await toScene(page, 0.85);
  const st = await page.evaluate(() => window.__heroSeq.state());
  expect(st.shown >= 0 && Math.abs(st.shown - st.want) <= 12, `vídeo bloqueado: quadros (pedido ${st.want}, desenhado ${st.shown}; ${st.why})`);
  // Redimensionar: redesenha o quadro atual no tamanho novo, sem baixar de novo.
  const before = st.downloaded;
  await page.setViewportSize({ width: 1000, height: 700 }); await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ st: window.__heroSeq.state(), w: document.querySelector('.hero-seq-frames').width }));
  expect(after.w > 0 && after.w <= 1500 && after.st.shown >= 0 && after.st.downloaded >= before, `redimensionar: canvas ${after.w}px, quadro ${after.st.shown}, sem recarregar`);
  await ctx.close();
}
// 6. Tudo da cena falha (nem o pôster): a cena não entra e o mapa continua; nada preto.
{
  const { ctx, page } = await open({}, async (p) => { await p.route('**/app/hero-360/**', (r) => r.abort()); });
  await page.waitForTimeout(3000);
  await toScene(page, 0.95);
  const r = await page.evaluate(() => ({ op: getComputedStyle(document.querySelector('.hero-seq')).opacity, canvas: document.getElementById('mapCanvas').width > 0, chapter: getComputedStyle(document.querySelector('.chapter-final')).opacity }));
  expect(Number(r.op) === 0 && r.canvas && Number(r.chapter) > 0.9, `falha total da cena: cena ${r.op}, mapa no lugar, texto visível`);
  if (OUT) await page.screenshot({ path: `${OUT}/falha-de-carregamento.png` });
  await ctx.close();
}
// 7. Teclado: a cena é decorativa e não prende o foco; rolar com teclas atravessa o hero.
{
  const { ctx, page } = await open();
  const r = await page.evaluate(() => ({ hidden: document.querySelector('.hero-seq').getAttribute('aria-hidden'), focusables: document.querySelectorAll('.hero-seq a, .hero-seq button, .hero-seq [tabindex]').length }));
  expect(r.hidden === 'true' && r.focusables === 0, 'teclado e leitor de tela: cena aria-hidden e sem foco');
  await page.click('body', { position: { x: 700, y: 500 } }).catch(() => {});
  for (let i = 0; i < 80; i++) await page.keyboard.press('PageDown');
  await page.waitForTimeout(600);
  const y = await page.evaluate(() => ({ y: scrollY, end: document.getElementById('inicio').offsetTop + document.getElementById('inicio').offsetHeight - innerHeight }));
  expect(y.y >= y.end, `PageDown atravessa o hero (rolou até ${y.y}px; o hero termina em ${y.end}px)`);
  await ctx.close();
}
await browser.close();
console.log(fail ? `${fail} falha(s)` : 'ok');
process.exit(fail ? 1 : 0);
