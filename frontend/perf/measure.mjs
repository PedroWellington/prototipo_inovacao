// Mede as metas de fluidez (docs/PERFORMANCE.md) no build de produção servido pelo nginx.
//   cd frontend; npm run perf            (abre o Edge instalado; HEADLESS=1 para sem janela)
// Pré-requisito: docker compose up -d e Recife carregado (load_city).
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.APP_URL || 'http://localhost:8080';
const RECIFE = 2611606;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: process.env.HEADLESS === '1' });
const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const out = {};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
  return { n: s.length, p50: +at(50).toFixed(1), p95: +at(95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
};

// Observa LCP e CLS desde o início de cada carregamento.
await ctx.addInitScript(() => {
  performance.setResourceTimingBufferSize(20000); // os tiles dos municípios enchem o buffer padrão (250)
  window.__cls = 0;
  window.__lcp = 0;
  new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => l.getEntries().forEach((e) => (window.__lcp = e.startTime))).observe({ type: 'largest-contentful-paint', buffered: true });
});

// 1) Tela de login: LCP e CLS (cache frio)
await page.goto(`${BASE}/app/#/login`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
out.login = await page.evaluate(() => ({ lcp_ms: Math.round(window.__lcp), cls: +window.__cls.toFixed(4), js_kb: Math.round(performance.getEntriesByType('resource').filter((r) => r.name.endsWith('.js')).reduce((a, r) => a + r.transferSize, 0) / 1024) }));

// 2) Usuário descartável com onboarding concluído (farmácia, sede em Recife)
const email = `perf-${Date.now()}@example.com`;
await ctx.request.post(`${BASE}/api/auth/register`, { data: { name: 'Perf', email, password: 'perf-senha-123', accept_terms: true } });
const { csrf_token } = await (await ctx.request.get(`${BASE}/api/auth/me`)).json();
const headers = { 'X-CSRF-Token': csrf_token };
await ctx.request.put(`${BASE}/api/profile`, {
  headers,
  data: {
    segment_key: 'farmacia', revenue_band: 'nao_informar', has_hq: true, hq_uf: 'PE', hq_municipality_ibge: RECIFE,
    criteria: [
      { business_type_key: 'hospital', direction: 'attract', weight: 3 },
      { business_type_key: 'clinica', direction: 'attract', weight: 3 },
      { business_type_key: 'farmacia', direction: 'repel', weight: 3 },
    ],
  },
});

// Créditos do usuário descartável (comando de concessão manual) e liberações feitas antes de medir:
// a confirmação de gasto é testada à parte; aqui medimos só a fluidez.
execSync(`docker compose run --rm -T backend python -m app.credits grant --email ${email} --amount 5 --note medicao`, {
  cwd: new URL('../../', import.meta.url),
  stdio: 'ignore',
});
await ctx.request.post(`${BASE}/api/credits/cities/${RECIFE}`, { headers });
await ctx.request.post(`${BASE}/api/credits/searches`, { headers, data: {} });

// 2b) Tela inicial pós-login: LCP e CLS (carregamento completo)
await page.goto('about:blank');
await page.goto(`${BASE}/app/#/home`);
await page.locator('.ov-analysis').first().waitFor();
await page.waitForTimeout(500);
out.home = await page.evaluate(() => ({ lcp_ms: Math.round(window.__lcp), cls: +window.__cls.toFixed(4) }));

// 3) Explorador: "Sim, tenho uma cidade em mente" abre direto no Recife (sede). Tempo até o mapa colorido.
const chooseCity = () => page.locator('[data-start="city"]').click();
await page.goto('about:blank'); // só trocar o hash não recarrega o app, que ainda guarda o usuário deslogado
const t0 = Date.now();
await page.goto(`${BASE}/app/#/explorer`);
await chooseCity();
await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
out.explorer_first_colored_ms = Date.now() - t0;
await page.waitForTimeout(1500); // termina a animação de câmera

// 4) Geometria na segunda visita (recarrega a página: cache HTTP)
await page.reload();
await chooseCity();
await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
out.geojson_second_visit = await page.evaluate(() => {
  const r = performance.getEntriesByType('resource').find((e) => e.name.includes('neighborhoods.geojson'));
  return r && { duration_ms: Math.round(r.duration), transfer_kb: Math.round(r.transferSize / 1024), from_cache: r.transferSize === 0 };
});
const geo = await ctx.request.get(`${BASE}/api/cities/${RECIFE}/neighborhoods.geojson`, { headers: { 'Accept-Encoding': 'gzip' } });
out.geojson_size = { raw_kb: Math.round((await geo.body()).length / 1024) };
await page.waitForTimeout(1500);

// 5) Recalcular: mexe no peso e mede rede (rank) e recoloração após a resposta
const recolor = [], rankNet = [], total = [];
for (let i = 0; i < 12; i++) {
  await page.evaluate(() => performance.clearMeasures('app:recolor'));
  const start = await page.evaluate((w) => {
    const el = document.querySelector('[data-weight="0"]');
    el.value = String(w);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return performance.now();
  }, (i % 5) + 1 === 3 ? 4 : (i % 5) + 1);
  await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 10000 });
  const m = await page.evaluate((s) => {
    const rec = performance.getEntriesByName('app:recolor').at(-1);
    const net = performance.getEntriesByType('resource').filter((r) => r.name.includes('/rank')).at(-1);
    return { recolor: rec.duration, net: net.responseEnd - net.requestStart, total: rec.startTime + rec.duration - s };
  }, start);
  recolor.push(m.recolor);
  rankNet.push(m.net);
  total.push(m.total);
}
out.recalc = { rank_network_ms: stats(rankNet), recolor_after_response_ms: stats(recolor), slider_to_recolored_ms_incl_250ms_debounce: stats(total) };

// 6) Hover: tooltip sem rede
const box = await page.locator('[data-map]').boundingBox();
const before = await page.evaluate(() => performance.getEntriesByType('resource').length);
for (let i = 0; i < 60; i++) {
  await page.mouse.move(box.x + box.width * (0.3 + 0.4 * Math.random()), box.y + box.height * (0.3 + 0.4 * Math.random()));
}
const hover = await page.evaluate((b) => ({
  tooltip: performance.getEntriesByName('app:tooltip').map((e) => e.duration),
  network_requests_during_hover: performance.getEntriesByType('resource').slice(b).filter((r) => r.name.includes('/api/')).length,
  hover_urls: performance.getEntriesByType('resource').slice(b).filter((r) => r.name.includes('/api/')).map((r) => r.name.replace(location.origin, '')),
}), before);
out.hover = { tooltip_ms: stats(hover.tooltip), network_requests_during_hover: hover.network_requests_during_hover, urls: hover.hover_urls };

// 7) FPS durante arrastar e zoom (quadros medidos por requestAnimationFrame)
await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const loop = (t) => {
    window.__frames.push(t - last);
    last = t;
    if (window.__frames.length < 100000 && !window.__stop) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
for (let k = 0; k < 3; k++) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(cx + Math.sin(i / 6) * 200, cy + Math.cos(i / 6) * 120, { steps: 2 });
  await page.mouse.up();
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, k % 2 ? 240 : -240);
    await page.waitForTimeout(60);
  }
}
await page.waitForTimeout(500);
const frames = await page.evaluate(() => {
  window.__stop = true;
  return window.__frames.slice(2);
});
const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
out.map_interaction = {
  frames: frames.length,
  avg_fps: +(1000 / avg).toFixed(1),
  frames_over_33ms: frames.filter((f) => f > 33.4).length,
  frames_over_50ms: frames.filter((f) => f > 50).length,
  worst_frame_ms: +Math.max(...frames).toFixed(1),
};
out.explorer_cls = await page.evaluate(() => +window.__cls.toFixed(4));

// 8) Troca de tela (hash) e de nível
let t = Date.now();
await page.evaluate(() => (location.hash = '#/conta'));
await page.getByRole('heading', { name: 'Minha conta' }).waitFor();
out.nav_explorer_to_account_ms = Date.now() - t;
t = Date.now();
await page.evaluate(() => (location.hash = '#/explorer'));
// O explorador fica vivo (router.js): volta já no Recife, sem recriar o mapa.
await page.waitForFunction(() => document.querySelector('.view-layer.is-shown .ex-head h1')?.textContent === 'Recife', null, { timeout: 15000 });
out.nav_account_to_explorer_ms = Date.now() - t;
t = Date.now();
await page.getByRole('button', { name: 'Pernambuco' }).click();
await page.getByRole('heading', { name: 'Escolha uma cidade' }).waitFor();
out.level_change_panel_ms = Date.now() - t;

// 8b) Recolher e abrir o painel lateral: quadros durante a transição (só transform, sem resize do mapa)
await page.evaluate(() => {
  window.__frames = [];
  window.__stop = false;
  let last = performance.now();
  const loop = (t) => {
    window.__frames.push(t - last);
    last = t;
    if (!window.__stop) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
for (let i = 0; i < 6; i++) {
  await page.locator('[data-toggle-panel]').click();
  await page.waitForTimeout(260);
}
const pframes = await page.evaluate(() => {
  window.__stop = true;
  return window.__frames.slice(2);
});
const pavg = pframes.reduce((a, b) => a + b, 0) / pframes.length;
out.panel_toggle = {
  frames: pframes.length,
  avg_fps: +(1000 / pavg).toFixed(1),
  frames_over_33ms: pframes.filter((f) => f > 33.4).length,
  worst_frame_ms: +Math.max(...pframes).toFixed(1),
  cls_after: await page.evaluate(() => +window.__cls.toFixed(4)),
};

// 9) Ranking de cidades ("Não"): Brasil inteiro, primeira coloração, recálculo e fluidez com ~5.570 municípios.
await page.getByRole('button', { name: 'Explorar' }).click();
await page.locator('[data-start="discover"]').click();
const cityRank = async (action) => {
  await page.evaluate(() => performance.clearMeasures('app:city-recolor'));
  const start = await page.evaluate(() => performance.now());
  await action();
  await page.waitForFunction(() => performance.getEntriesByName('app:city-recolor').length > 0, null, { timeout: 20000 });
  return page.evaluate((s) => {
    const rec = performance.getEntriesByName('app:city-recolor').at(-1);
    const net = performance.getEntriesByType('resource').filter((r) => r.name.endsWith('/api/cities/rank')).at(-1);
    return { recolor: rec.duration, net: net.responseEnd - net.requestStart, total: rec.startTime + rec.duration - s };
  }, start);
};
t = Date.now();
await cityRank(() => page.locator('[data-scope="br"]').click());
out.cities_br_first_colored_ms = Date.now() - t;
await page.waitForTimeout(1500);
for (const [label, minPop] of [['min_20k', null], ['min_0', 0]]) {
  if (minPop !== null) {
    await cityRank(async () => {
      await page.locator('[data-min-pop]').fill(String(minPop));
    });
  }
  const net = [], rec = [], tot = [];
  for (let i = 0; i < 10; i++) {
    const m = await cityRank(() =>
      page.evaluate((w) => {
        const el = document.querySelector('[data-weight="0"]');
        el.value = String(w);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, (i % 5) + 1),
    );
    net.push(m.net);
    rec.push(m.recolor);
    tot.push(m.total);
  }
  out[`cities_recalc_${label}`] = {
    analyzed: await page.evaluate(() => document.querySelector('.analyzed strong')?.textContent),
    rank_network_ms: stats(net),
    recolor_after_response_ms: stats(rec),
    slider_to_recolored_ms_incl_250ms_debounce: stats(tot),
  };
}
const rankBr = await ctx.request.post(`${BASE}/api/cities/rank`, {
  headers,
  data: { criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 3 }], min_population: 0 },
});
out.cities_rank_payload_kb_min_0 = Math.round((await rankBr.body()).length / 1024);
// Tamanho dos tiles: medido no servidor (o MapLibre baixa tiles em web workers, fora do Resource Timing da página).
// FPS arrastando e com zoom sobre o Brasil inteiro (tiles + feature-state de ~5.570 municípios)
const mbox = await page.locator('[data-map]').boundingBox();
await page.evaluate(() => {
  window.__frames = [];
  window.__stop = false;
  let last = performance.now();
  const loop = (t) => {
    window.__frames.push(t - last);
    last = t;
    if (!window.__stop) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
});
const mx = mbox.x + mbox.width / 2, my = mbox.y + mbox.height / 2;
for (let k = 0; k < 3; k++) {
  await page.mouse.move(mx, my);
  await page.mouse.down();
  for (let i = 0; i < 40; i++) await page.mouse.move(mx + Math.sin(i / 6) * 200, my + Math.cos(i / 6) * 120, { steps: 2 });
  await page.mouse.up();
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, k % 2 ? 240 : -240);
    await page.waitForTimeout(60);
  }
}
await page.waitForTimeout(500);
const cframes = await page.evaluate(() => {
  window.__stop = true;
  return window.__frames.slice(2);
});
const cavg = cframes.reduce((a, b) => a + b, 0) / cframes.length;
out.cities_map_interaction = {
  frames: cframes.length,
  avg_fps: +(1000 / cavg).toFixed(1),
  frames_over_33ms: cframes.filter((f) => f > 33.4).length,
  frames_over_50ms: cframes.filter((f) => f > 50).length,
  worst_frame_ms: +Math.max(...cframes).toFixed(1),
};

await ctx.request.delete(`${BASE}/api/account`, { headers });
await browser.close();

mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`, import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
