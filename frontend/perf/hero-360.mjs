// Hero com o mapa real (docs/HERO-360.md): fluidez da rolagem pela cena, tiles, holograma, tempos e memória.
//   docker compose up -d; cd frontend; node perf/hero-360.mjs      (BASE=..., HEADLESS=1, CPU=1,4, TELAS=desktop,celular, MODOS=mapa,estatico, DE=0.55)
// Meta (referência 60 Hz, decisão de 2026-11-17): >= 55 fps e trabalho por quadro p95 <= 16,7 ms (o orçamento de um
// quadro a 60 Hz), também com CPU 4× mais lenta. Esta máquina tem tela de 144 Hz: o intervalo entre quadros chega em
// degraus de 6,9 ms, então um quadro de 15 ms aparece como 20,8 ms. A coluna 'acima de 7 ms' mostra quantos quadros
// perdem a batida numa tela de 144 Hz.
// "tiles faltando" = passos da rolagem em que o mapa ainda tinha tile por carregar (tile cinza);
// "holograma completo" = todos os quadros do holograma já baixados quando ele começa a subir.
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const HEADLESS = process.env.HEADLESS === '1';
const MODES = (process.env.MODOS || 'mapa').split(',');
const CPUS = (process.env.CPU || '1,4').split(',').map(Number);
const VIEWS = (process.env.TELAS || 'desktop,celular').split(',');
const DE = Number(process.env.DE || 0); // início da medição (0 = o hero inteiro, do Brasil ao bairro)
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))];
  return { p95: +at(0.95).toFixed(1), max: +s.at(-1).toFixed(1), over7: +((100 * s.filter((x) => x > 7.5).length) / s.length).toFixed(1) };
};
// Memória privada somada de todos os processos do Edge do teste (perfil temporário do Playwright).
function memoryMB() {
  try {
    const ps = "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*playwright*' } | Measure-Object PrivatePageCount -Sum).Sum";
    return Math.round(Number(execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' }).trim()) / 1048576) || null;
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
  const t0 = Date.now();
  await page.goto(`${BASE}/${mode === 'estatico' ? '?hero=estatico' : ''}`);
  await page.waitForFunction(() => window.__hero && (window.__hero.mode === 'map' || window.__hero.stillReady), null, { timeout: 90000 });
  const ready = Date.now() - t0;
  const geo = await page.evaluate(() => { const s = document.getElementById('inicio'); return { top: s.offsetTop, range: s.offsetHeight - innerHeight }; });
  await page.evaluate(([y]) => scrollTo(0, y), [geo.top + DE * geo.range]);
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    window.__f = []; window.__work = [];
    let last = performance.now();
    const mc = new MessageChannel(); let start = 0;
    mc.port1.onmessage = () => window.__work?.push(performance.now() - start);
    const tick = (t) => { if (!window.__f) return; window.__f.push(t - last); last = t; start = performance.now(); mc.port2.postMessage(0); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  let peak = 0, missingTiles = 0, holoComplete = null;
  const steps = 70, box = mobile ? { x: 195, y: 420 } : { x: 720, y: 450 };
  await page.mouse.move(box.x, box.y);
  const dy = ((1.02 - DE) * geo.range) / steps;
  for (const dir of [1, -1]) for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dir * dy);
    await page.waitForTimeout(45);
    const st = await page.evaluate(() => {
      const h = window.__hero;
      const s = h.api?.stats();
      const p = (scrollY - document.getElementById('inicio').offsetTop) / (document.getElementById('inicio').offsetHeight - innerHeight);
      return { tiles: s ? s.tiles : true, holo: s?.holo.loaded ?? null, p };
    });
    if (!st.tiles) missingTiles++;
    if (holoComplete === null && st.p > 0.82 && st.holo != null) holoComplete = st.holo;
    if (i % 20 === 0) peak = Math.max(peak, memoryMB() || 0);
  }
  const res = await page.evaluate(() => { const f = window.__f.slice(1); const w = window.__work.slice(1); window.__f = null; return { f, w, mode: window.__hero.mode }; });
  const fs = stats(res.f), ws = stats(res.w);
  const fps = +(1000 / (res.f.reduce((a, b) => a + b, 0) / res.f.length)).toFixed(1);
  rows.push({ tela: view, caminho: res.mode, cpu: `${cpu}x`, fps, p95_quadro: fs.p95, pior_quadro: fs.max, trabalho_p95: ws.p95,
    pronto_ms: ready, tiles_faltando: `${missingTiles}/${steps * 2}`, holograma_quadros: holoComplete, memoria_pico_mb: peak || null,
    acima_7ms_pct: fs.over7, ok_60hz: fps >= 55 && ws.p95 <= 16.7 ? '✅' : '❌', erros: errors.length });
  await browser.close();
}
console.table(rows);
