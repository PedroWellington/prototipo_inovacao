// Holograma no explorador real (Recife): inclinar + subir, giro parado e voltar ao plano, medidos à parte.
//   docker compose up -d --build; cd frontend; node perf/holo-fps.mjs     (HEADLESS=1: ~60 Hz; com janela: tela real)
// CPU normal e 4x, desktop e celular simulado. Cria um usuário descartável (holo-…@example.com).
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const HEADLESS = process.env.HEADLESS === '1';
// Sem limitar janelas encobertas ou em segundo plano (senão o rAF cai para ~1 por segundo e a medida não vale).
const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || 'msedge',
  headless: HEADLESS,
  args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: s.length, fps: +(1000 / avg).toFixed(1), p95: +at(95).toFixed(1), max: +s.at(-1).toFixed(1), over50: s.filter((x) => x > 50).length };
};

async function onboard(page) {
  await page.goto(`${BASE}/app/#/register`);
  await page.fill('#name', 'Holo Teste'); await page.fill('#email', `holo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`); await page.fill('#password', 'holo-senha-12345');
  await page.check('input[name="accept_terms"]'); await page.click('button[type="submit"]');
  await page.waitForURL(/#\/onboarding/);
  for (let i = 0; i < 10 && !/#\/home/.test(page.url()); i++) {
    await page.waitForSelector('.ob-card, [data-dashboard]');
    if (await page.$('[data-dashboard]')) break;
    if (/sede/i.test(await page.textContent('.ob-card h1'))) await page.click('.tile[data-value="false"]');
    else if ((await page.$('.tile[aria-checked="false"]')) && !(await page.$('.tile[aria-checked="true"]'))) await page.click('.tile >> nth=0');
    const submit = page.locator('.ob-card button[type="submit"]');
    if ((await submit.isDisabled()) && (await page.$('[data-skip]'))) await page.click('[data-skip]');
    else await submit.click();
    await page.waitForTimeout(400);
  }
}

// Amostra o intervalo entre quadros durante ms; long tasks e CLS no mesmo intervalo.
const sample = (page, ms) =>
  page.evaluate(
    (ms) =>
      new Promise((done) => {
        const f = [], lt = [];
        let cls = 0;
        const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push(Math.round(e.duration))));
        po.observe({ type: 'longtask' });
        const pc = new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (cls += e.value)));
        pc.observe({ type: 'layout-shift' });
        // Trabalho da thread principal por quadro (mesmo método de landing/perf/measure.mjs): do início do quadro
        // (timestamp do rAF, comum a todos os callbacks, inclusive o do MapLibre) até uma mensagem postada nele,
        // que só roda depois de estilo, layout e pintura desse quadro.
        const work = [];
        const ch = new MessageChannel();
        let pendingT = 0;
        ch.port1.onmessage = () => work.push(performance.now() - pendingT);
        let last = 0, t0 = 0;
        const tick = (t) => {
          if (!t0) t0 = t;
          if (last) f.push(t - last);
          last = t;
          pendingT = t;
          ch.port2.postMessage(0);
          if (t - t0 < ms) requestAnimationFrame(tick);
          else {
            po.disconnect();
            pc.disconnect();
            const st = document.querySelector('[data-holo]').holoStats();
            done({ f, work, lt, cls, mem: st.decoded, loaded: st.loaded, paints: st.paints });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['celular', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: device === 'celular' ? 3 : 1, isMobile: device === 'celular', hasTouch: device === 'celular' });
  const page = await ctx.newPage();
  await page.bringToFront(); // janela encoberta: o Edge limita o rAF a ~1 por segundo
  await onboard(page);
  await page.goto(`${BASE}/app/#/explorer?city=2611606`);
  await page.click('dialog .btn-primary', { timeout: 20000 });
  await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-holo]').holoStats().loaded >= 360, null, { timeout: 60000 });
  const cdp = await ctx.newCDPSession(page);
  await page.waitForTimeout(2500); // a câmera termina o enquadramento do Recife antes do primeiro clique
  for (const cpu of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    // Referência: arrastar o mapa no plano, sem holograma (custo do mapa sozinho, já existente antes).
    const mb = await page.locator('[data-map]').boundingBox();
    const cx = mb.x + mb.width / 2, cy = mb.y + mb.height / 2;
    const refP = sample(page, 900);
    if (device === 'celular') {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
      for (let k = 1; k <= 12; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - k * 8, y: cy - k * 3 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(cx, cy); await page.mouse.down();
      await page.mouse.move(cx - 100, cy - 40, { steps: 12 }); await page.mouse.up();
    }
    const ref = await refP;
    await page.waitForTimeout(1200);
    // Entrada: clique de mouse real (mapa parado), para o navegador marcar entrada recente do usuário.
    const pt = await page.evaluate(() => { const L = document.querySelector('[data-holo]'); return L.holoPoint(L.holoState().top[0]); });
    const box = await page.locator('[data-map]').boundingBox();
    const inP = sample(page, 900);
    if (device === 'celular') await page.touchscreen.tap(box.x + pt.x, box.y + pt.y + 8);
    else await page.mouse.click(box.x + pt.x, box.y + pt.y + 8);
    const tin = await inP;
    const spin = await sample(page, 4000);
    const outP = sample(page, 900);
    await page.click('[data-plane]');
    const tout = await outP;
    const giro = +((spin.paints - tin.paints) / 4).toFixed(1);
    for (const [fase, r] of [['referência: arrastar no plano', ref], ['inclinar+subir', tin], ['giro', spin], ['voltar ao plano', tout]])
      console.log(JSON.stringify({ device, cpu, fase, ...stats(r.f), trabalho_p95: stats(r.work).p95, trabalho_max: stats(r.work).max, longtasks: r.lt, cls: +r.cls.toFixed(4), memoria_mb: +r.mem.toFixed(1), ...(fase === 'giro' ? { quadros_de_giro_por_s: giro } : {}) }));
    await page.waitForTimeout(800);
  }
  await ctx.close();
}
await browser.close();
