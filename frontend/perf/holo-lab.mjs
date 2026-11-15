// Holograma fora do mapa (holo-lab.html): subida de 700 ms + giro, com CPU normal e 4x, desktop e celular.
//   cd frontend; npx vite --port 5179     (outro terminal)    node perf/holo-lab.mjs   (LAB=http://...)
// Mede: intervalo entre quadros (p95, pior), memória dos quadros decodificados e quadros de giro por segundo.
import { chromium } from 'playwright-core';

const LAB = process.env.LAB || 'http://localhost:5179/app/holo-lab.html';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: process.env.HEADLESS === '1' });
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
  return { n: s.length, p50: +at(50).toFixed(1), p95: +at(95).toFixed(1), max: +s.at(-1).toFixed(1), over50: s.filter((x) => x > 50).length };
};

for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  for (const cpu of [1, 4]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: device === 'celular' ? 3 : 1, isMobile: device === 'celular' });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(LAB);
    await page.waitForFunction(() => window.lab?.ready, null, { timeout: 120000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    const r = await page.evaluate(async () => {
      const { holo } = window.lab;
      const frames = [], mem = [];
      const ease = (x) => 1 - Math.pow(1 - x, 4); // só para a subida do teste
      let last = 0, t0 = 0;
      await new Promise((done) => {
        const tick = (t) => {
          if (!t0) t0 = t;
          if (last) frames.push(t - last);
          last = t;
          const e = Math.min(1, (t - t0) / 700);
          holo.set(0, { lngLat: [0, 0], rise: ease(e) });
          mem.push(holo.stats().decoded);
          if (t - t0 < 6700) requestAnimationFrame(tick);
          else done();
        };
        requestAnimationFrame(tick);
      });
      return { frames, maxMB: Math.max(...mem), loaded: holo.stats().loaded, giroPorSegundo: +(holo.stats().paints / 6.7).toFixed(1) };
    });
    const row = { device, cpu, ...stats(r.frames), fps: +(1000 / (r.frames.reduce((a, b) => a + b, 0) / r.frames.length)).toFixed(1), memoria_mb: +r.maxMB.toFixed(1), quadros_baixados: r.loaded, quadros_de_giro_por_s: r.giroPorSegundo };
    console.log(JSON.stringify(row));
    await ctx.close();
  }
}
await browser.close();
