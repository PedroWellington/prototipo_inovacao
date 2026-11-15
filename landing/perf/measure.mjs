// Mede a fluidez da landing (metas em docs/PERFORMANCE.md) com o Edge instalado, via playwright-core.
//   cd landing; npm run serve   (em outro terminal)
//   node perf/measure.mjs                      -> index.html
//   PAGE=/VICUS-Recife-Edicao-Urbana.html LABEL=antes node perf/measure.mjs
// HEADLESS=1 para sem janela (o ritmo de quadros fica menos realista). Resultado em perf/results/<LABEL>.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const URL_ = `${process.env.BASE || 'http://localhost:4173'}${process.env.PAGE || '/'}`;
const LABEL = process.env.LABEL || 'depois';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: process.env.HEADLESS === '1' });

const stats = (xs) => {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
  return { n: s.length, p50: +at(50).toFixed(2), p95: +at(95).toFixed(2), p99: +at(99).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

// Antes de qualquer script da página: cronometra cada callback de rAF (trabalho de JS por quadro),
// guarda o intervalo entre quadros e as tarefas longas.
const instrument = () => {
  window.__frames = [];
  window.__js = [];
  window.__long = [];
  window.__byP = [];
  window.__cls = 0;
  window.__lcp = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => {
    const a = performance.now();
    cb(t);
    if (window.__rec) window.__js.push(performance.now() - a);
  });
  // Trabalho da thread principal por quadro: do início do rAF até o fim da tarefa de renderização
  // (estilo, layout, pintura). A mensagem postada no rAF só roda depois dessa tarefa.
  window.__work = [];
  const mc = new MessageChannel();
  let start = 0;
  mc.port1.onmessage = () => { if (window.__rec) window.__work.push(performance.now() - start); };
  let last = 0;
  const loop = (t) => {
    start = performance.now(); mc.port2.postMessage(0);
    if (window.__rec && last) {
      window.__frames.push(t - last);
      const st = document.querySelector('.story');
      window.__byP.push([(scrollY - st.offsetTop) / (st.offsetHeight - innerHeight), t - last]);
    }
    last = t; raf(loop);
  };
  raf(loop);
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__rec && window.__long.push(e.duration))).observe({ type: 'longtask', buffered: false });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
};

async function run(name, { viewport, mobile = false, cpu = 1 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(instrument);
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL_, { waitUntil: 'load' });
  // Diagnóstico: EXTRA_CSS='seletor{...}' desliga um efeito para medir o custo dele.
  if (process.env.EXTRA_CSS) await page.addStyleTag({ content: process.env.EXTRA_CSS });
  await page.waitForTimeout(2500); // dados geográficos em segundo plano
  const load = await page.evaluate(() => ({ lcp_ms: Math.round(window.__lcp), cls: +window.__cls.toFixed(4) }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const storyPx = await page.evaluate(() => document.querySelector('.story').offsetHeight - innerHeight);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.evaluate(() => (window.__rec = true));
  // Rolagem de "usuário": 120 px a cada 40 ms até o fim da história, pausa, e volta ao topo.
  for (let y = 0; y < storyPx; y += 120) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
  await page.waitForTimeout(800);
  for (let y = storyPx; y > 0; y -= 120) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({ work: window.__work, byP: window.__byP, frames: window.__frames, js: window.__js, long: window.__long, source: document.getElementById('geoSource')?.textContent }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await ctx.close();
  const f = stats(r.frames);
  return {
    name, cpu, ...load,
    frame_ms: f,
    fps_p50: f.p50 ? +(1000 / f.p50).toFixed(1) : null,
    fps_p95_worst: f.p95 ? +(1000 / f.p95).toFixed(1) : null,
    fps_avg: +(1000 / (r.frames.reduce((a, b) => a + b, 0) / r.frames.length)).toFixed(1),
    frames_over_50ms: r.frames.filter((x) => x > 50).length,
    main_thread_ms_per_frame: stats(r.work),
    js_per_raf_ms: stats(r.js),
    long_tasks: { n: r.long.length, max: r.long.length ? Math.round(Math.max(...r.long)) : 0 },
    // Onde ficam os quadros lentos: p95 do intervalo por faixa de progresso (0,0–0,1, 0,1–0,2...).
    slow_by_progress: Object.fromEntries([...Array(10).keys()].map((b) => {
      const xs = r.byP.filter(([p]) => Math.min(9, Math.max(0, Math.floor(p * 10))) === b).map(([, d]) => d);
      return [`${b / 10}`, xs.length ? stats(xs).p95 : null];
    })),
    over_50ms_at: r.byP.filter(([, d]) => d > 50).map(([p, d]) => `${p.toFixed(3)}:${Math.round(d)}ms`),
    geo_source: r.source,
    console_errors: errors,
  };
}

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };
const out = { url: URL_, at: new Date().toISOString(), runs: [] };
const ONLY = process.env.ONLY;
for (const [name, opts] of [
  ['desktop', { viewport: desktop }],
  ['desktop-cpu4x', { viewport: desktop, cpu: 4 }],
  ['celular-cpu4x', { viewport: phone, mobile: true, cpu: 4 }],
]) {
  if (ONLY && name !== ONLY) continue;
  const r = await run(name, opts);
  out.runs.push(r);
  console.log(JSON.stringify(r));
}
await browser.close();
mkdirSync(new URL('results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`results/${LABEL}.json`, import.meta.url), JSON.stringify(out, null, 2));
