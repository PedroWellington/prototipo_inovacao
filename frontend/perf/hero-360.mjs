// Hero 360 (docs/HERO-360.md): fluidez da rolagem pela cena, tempos e memória, nos três caminhos.
//   docker compose up -d; cd frontend; node perf/hero-360.mjs      (BASE=..., HEADLESS=1, CPU=4, MODOS=video,quadros,estatico)
// fps e p95 do intervalo entre quadros (meta: >= 55 fps e p95 <= 12 ms), trabalho da thread principal por quadro,
// tempo até a primeira imagem da cena, tempo até ela ficar pronta e pico de memória de todos os processos do navegador.
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const HEADLESS = process.env.HEADLESS === '1';
const MODES = (process.env.MODOS || 'video,quadros,estatico').split(',');
const CPUS = (process.env.CPU || '1,4').split(',').map(Number);
const VIEWS = (process.env.TELAS || 'desktop,celular').split(',');
const DE = Number(process.env.DE || 0.66); // de onde a medição começa (0,74 = só a cena, sem o mapa do canvas)
const ANTES = process.env.ANTES === '1'; // landing sem a cena (main, com a foto da loja): base de comparação
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))];
  return { n: s.length, p50: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +s.at(-1).toFixed(1) };
};
// Memória de todos os processos do navegador lançado (o vídeo decodificado fica no processo de GPU, fora do JS).
// Soma a memória privada de todos os processos do Edge do teste (perfil temporário do Playwright na linha de comando).
function memoryMB() {
  try {
    const ps = "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*playwright*' } | Measure-Object PrivatePageCount -Sum).Sum";
    const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' });
    return Math.round(Number(out.trim()) / 1048576) || null;
  } catch { return null; }
}

const rows = [];
for (const view of VIEWS) for (const mode of MODES) for (const cpu of CPUS) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: HEADLESS });
  const mobile = view === 'celular';
  const ctx = await browser.newContext({ bypassCSP: true, viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const q = mode === 'video' ? '' : `?hero=${mode}`;
  const t0 = Date.now();
  await page.goto(`${BASE}/${q}`);
  // Primeira imagem da cena (pôster ou quadro final) e cena pronta (vídeo calibrado, quadros na 1ª onda, ou estático).
  if (ANTES) await page.waitForLoadState('load');
  else await page.waitForFunction(() => document.querySelector('.hero-seq-still')?.complete && document.querySelector('.hero-seq-still').naturalWidth > 0, null, { timeout: 60000 });
  const firstImage = Date.now() - t0;
  if (!ANTES) await page.waitForFunction(() => {
    const st = window.__heroSeq?.state();
    return st && (st.mode === 'video' || st.mode === 'static' || (st.mode === 'frames' && st.downloaded >= 30));
  }, null, { timeout: 90000 });
  const smooth = Date.now() - t0;
  const geo = await page.evaluate(() => { const s = document.getElementById('inicio'); return { top: s.offsetTop, range: s.offsetHeight - innerHeight }; });
  // Rolagem: da entrada da cena (p = 0,66) até o fim e de volta, em passos como a roda do mouse ou o dedo.
  await page.evaluate(([y]) => scrollTo(0, y), [geo.top + DE * geo.range]);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.__f = []; window.__work = [];
    let last = performance.now();
    const mc = new MessageChannel(); let start = 0;
    mc.port1.onmessage = () => window.__work?.push(performance.now() - start);
    const tick = (t) => { if (!window.__f) return; window.__f.push(t - last); last = t; start = performance.now(); mc.port2.postMessage(0); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  let peak = 0;
  const steps = 60;
  // Roda do mouse de verdade (como a pessoa rola), descendo pela cena inteira e voltando.
  const box = mobile ? { x: 195, y: 420 } : { x: 720, y: 450 };
  await page.mouse.move(box.x, box.y);
  const dy = ((1.02 - DE) * geo.range) / steps;
  for (const dir of [1, -1]) for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dir * dy);
    await page.waitForTimeout(45);
    if (i % 20 === 0) peak = Math.max(peak, memoryMB() || 0);
  }
  const res = await page.evaluate(() => { const f = window.__f.slice(1); const w = window.__work.slice(1); window.__f = null; return { f, w, st: window.__heroSeq?.state() }; });
  const fs = stats(res.f), ws = stats(res.w);
  const fps = +(1000 / (res.f.reduce((a, b) => a + b, 0) / res.f.length)).toFixed(1);
  rows.push({ tela: view, caminho: ANTES ? 'main (foto da loja)' : res.st?.mode, cpu: `${cpu}x`, fps, p95_quadro: fs.p95, max_quadro: fs.max, trabalho_p95: ws.p95,
    primeira_imagem_ms: firstImage, pronta_ms: smooth, memoria_pico_mb: peak || null, ok: fps >= 55 && fs.p95 <= 12 ? '✅' : '❌', erros: errors.length });
  if (process.env.VERBOSE) console.log(view, mode, cpu, res.st);
  await browser.close();
}
console.table(rows);
