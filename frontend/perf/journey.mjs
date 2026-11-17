// Teste de ponta a ponta da integração landing (/) + app (/app/), com o Edge instalado.
//   docker compose up -d --build; cd frontend; node perf/journey.mjs        (BASE=http://host:porta para outro endereço)
// Cria um usuário descartável (perf-…@example.com). Sai com código 1 se algum passo falhar.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
// bypassCSP nos contextos: a CSP do nginx (nginx-security.inc) bloqueia o waitForFunction com string e o axe injetado; o site continua com a CSP.
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: process.env.HEADED !== '1' });
const results = [];
const errors = [];
async function step(name, fn) {
  try { await fn(); results.push(['✅', name]); } catch (e) { results.push(['❌', `${name}: ${e.message.split('\n')[0]}`]); }
}
const expect = (ok, msg) => { if (!ok) throw new Error(msg); };
const watch = (page) => {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/401/.test(m.text()) && errors.push(m.text())); // 401 de /api/auth/me = visitante
};

// --- Cabeçalho da landing: só a marca, o botão de tema e "Entrar"; nada de menu ------------------------
async function header(label, viewport, mobile) {
  const ctx = await browser.newContext({ bypassCSP: true, viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await ctx.newPage(); watch(page);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await step(`${label}: cabeçalho = marca + Entrar`, async () => {
    const r = await page.evaluate(() => ({
      old: !!document.querySelector('#navbar .nav-links, #navbar .nav-toggle'),
      links: [...document.querySelectorAll('#navbar a')].filter((a) => a.getBoundingClientRect().width > 0)
        .map((a) => [a.textContent.trim().replace(/\s+/g, ' '), a.getAttribute('href')]),
    }));
    expect(!r.old, 'menu antigo ainda no cabeçalho');
    expect(r.links.length === 2, `${r.links.length} links visíveis: ${JSON.stringify(r.links)}`);
    expect(r.links[1][0] === 'Entrar' && r.links[1][1] === '/app/#/login', `botão = ${JSON.stringify(r.links[1])}`);
  });
  await ctx.close();
}
await header('desktop', { width: 1440, height: 900 }, false);
await header('celular', { width: 390, height: 844 }, true);

// --- Caminho completo: visitante -> conta -> onboarding -> home -> explorador -> landing -> app ---------
const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); watch(page);
const email = `perf-${Date.now()}@example.com`;
await step('landing: visitante vê "Criar conta" e "Entrar"', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  expect(await page.isVisible('.end-actions [data-app-route="#/register"]'), '"Criar conta" invisível');
  expect(!(await page.isVisible('.end-actions [data-app-route="#/home"]')), '"Ir para a plataforma" visível para visitante');
  expect(await page.locator('.plan').count() === 3, 'três planos pagos, nenhum gratuito');
  expect(await page.locator('.plan-cta[disabled]').count() === 3, 'botões "Em breve" desativados');
});
await step('landing -> Criar conta abre /app/#/register', async () => {
  await page.click('.end-actions [data-app-route="#/register"]');
  await page.waitForURL(/\/app\/#\/register$/);
  await page.waitForSelector('#name');
});
await step('cadastro -> onboarding', async () => {
  await page.fill('#name', 'Teste Jornada'); await page.fill('#email', email); await page.fill('#password', 'jornada-senha-123');
  await page.check('input[name="accept_terms"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/#\/onboarding/);
});
await step('onboarding (6 passos) -> tela inicial', async () => {
  for (let i = 0; i < 8 && !/#\/home/.test(page.url()); i++) {
    await page.waitForSelector('.ob-card, [data-dashboard]', { timeout: 10000 });
    if (await page.$('[data-dashboard]')) break;
    const h1 = await page.textContent('.ob-card h1');
    if (/sede/i.test(h1)) await page.click('.tile[data-value="false"]');
    else if (await page.$('.tile[aria-checked="false"]') && !(await page.$('.tile[aria-checked="true"]'))) await page.click('.tile >> nth=0');
    const submit = page.locator('.ob-card button[type="submit"]');
    if (await submit.isDisabled() && await page.$('[data-skip]')) await page.click('[data-skip]');
    else await submit.click();
    await page.waitForTimeout(500);
  }
  await page.waitForURL(/#\/home/, { timeout: 15000 });
});
await step('tutorial: aparece na primeira vez, 5 passos, foco no cartão, Próximo e Concluir gravam no servidor', async () => {
  await page.waitForSelector('.tour.is-open .tour-card', { timeout: 15000 });
  const first = await page.evaluate(() => ({ step: document.querySelector('#tourStep').textContent, modal: document.querySelector('.tour-card').getAttribute('aria-modal'), focus: document.activeElement?.hasAttribute('data-tour-next') }));
  expect(first.step === '1 de 5' && first.modal === 'true' && first.focus, JSON.stringify(first));
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.tour-card'))), 'foco saiu do cartão');
  for (let i = 0; i < 5; i++) { await page.click('[data-tour-next]'); await page.waitForTimeout(450); }
  expect(!(await page.$('.tour')), 'tutorial não fechou no Concluir');
  await page.waitForTimeout(400);
  expect((await page.evaluate(async () => (await (await fetch('/api/auth/me')).json()).tutorial_done)) === true, 'servidor não gravou');
});
await step('tutorial: não volta ao recarregar nem ao trocar de aba; "Ver tutorial novamente" roda sem gravar', async () => {
  await page.reload(); await page.waitForSelector('[data-cx]'); await page.waitForTimeout(900);
  expect(!(await page.$('.tour')), 'voltou ao recarregar');
  await page.click('.topnav [data-nav="analises"]'); await page.waitForSelector('[data-cx]');
  await page.click('.topnav [data-nav="home"]'); await page.waitForSelector('[data-cx]'); await page.waitForTimeout(900);
  expect(!(await page.$('.tour')), 'voltou ao trocar de aba');
  await page.goto(`${BASE}/app/#/conta`); await page.click('a[href="#/home?tutorial=1"]');
  await page.waitForSelector('.tour.is-open .tour-card', { timeout: 15000 });
  await page.keyboard.press('Escape');
  expect(!(await page.$('.tour')), 'Esc não fechou');
});
await step('tela inicial: logo volta para #/home e há "Conhecer a VICUS"', async () => {
  expect(await page.getAttribute('.logo-link', 'href') === '#/home', 'logo não aponta para #/home');
  expect(await page.getAttribute('.about-link', 'href') === '/', 'link da landing ausente');
});
await step('menu: ordem Visão geral · Análises · Comparar · Dados e fontes · Explorar; rótulo visível no hover', async () => {
  const items = await page.$$eval('.topbar .topnav [data-nav]', (els) => els.map((e) => e.textContent.trim()));
  expect(JSON.stringify(items) === JSON.stringify(['Visão geral', 'Análises', 'Comparar', 'Dados e fontes', 'Explorar']), items.join(' · '));
  await page.hover('.topnav [data-nav="explorer"]'); await page.waitForTimeout(250);
  const vis = await page.evaluate(() => { const a = document.querySelector('.topnav [data-nav="explorer"]'); const c = getComputedStyle(a); return c.opacity !== '0' && c.visibility === 'visible' && c.color !== c.backgroundColor; });
  expect(vis, 'rótulo some no hover');
  expect(!(await page.evaluate(() => document.querySelector('.topbar').innerText.includes('Inteligência territorial'))), '"Inteligência territorial" ainda na barra');
  expect(await page.getAttribute('.topbar .logo-link', 'href') === '#/home', 'logo não leva à Visão geral');
});
await step('menu: "Dados e fontes" e "Análises" são páginas próprias (rota, item ativo, esqueleto e dados reais)', async () => {
  await page.click('.topnav [data-nav="fontes"]');
  await page.waitForSelector('.src-table');
  const r = await page.evaluate(() => ({ hash: location.hash, active: document.querySelector('.topnav [aria-current="page"]')?.dataset.nav, rows: document.querySelectorAll('.src-table tbody tr').length }));
  expect(r.hash === '#/dados' && r.active === 'fontes' && r.rows >= 4, JSON.stringify(r));
  await page.click('.topnav [data-nav="analises"]');
  await page.waitForSelector('.ov-analyses, .ov-empty-big');
  expect((await page.evaluate(() => location.hash)) === '#/analises', 'rota de Análises');
  await page.click('.topbar .logo-link'); await page.waitForSelector('[data-dashboard] .ov-hero'); 
  expect((await page.evaluate(() => location.hash)) === '#/home', 'a logo não voltou à Visão geral');
});
await step('recarregar /app/#/home mantém a tela', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-dashboard]');
});
await step('explorador abre e o mapa aparece', async () => {
  await page.goto(`${BASE}/app/#/explorer`);
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 });
  expect(await page.getAttribute('.view-layer .logo-link', 'href') === '#/home', 'logo do explorador');
});
// --- Explorador: Recife, ranking animado (mesmas linhas), recálculo e ida/volta sem recarregar ---------
const recolors = () => page.evaluate(() => performance.getEntriesByName('app:recolor').length);
await step('explorador: abre Recife com confirmação de crédito', async () => {
  await page.goto(`${BASE}/app/#/explorer?city=2611606`);
  await page.waitForSelector('dialog .btn-primary', { timeout: 20000 });
  await page.click('dialog .btn-primary');
  await page.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  await page.waitForSelector('[data-rank-list] li');
  expect(await page.isVisible('.cov-line'), 'cobertura não aparece no ranking');
  expect(await page.locator('.ex-left').isVisible() && await page.locator('.ex-right').isVisible(), 'três colunas');
});
await step('explorador: mudar o peso reordena as MESMAS linhas (FLIP) em até 150 ms', async () => {
  await page.evaluate(() => document.querySelectorAll('[data-rank-list] li').forEach((li) => (li.__keep = true)));
  const before = await page.$$eval('[data-rank-list] li', (ls) => ls.map((l) => l.dataset.key).join());
  const n0 = await recolors();
  const t = await page.evaluate(() => {
    const r = document.querySelector('[data-weight="0"]');
    r.value = r.value === '5' ? '1' : '5';
    window.__t0 = performance.now();
    r.dispatchEvent(new Event('input', { bubbles: true }));
    return window.__t0;
  });
  await page.waitForFunction((n) => performance.getEntriesByName('app:recolor').length > n, n0, { timeout: 10000 });
  await page.waitForTimeout(600);
  const r = await page.evaluate((t0) => {
    const e = performance.getEntriesByName('app:recolor').at(-1);
    const lis = [...document.querySelectorAll('[data-rank-list] li')];
    return { ms: Math.round(e.startTime + e.duration - t0), kept: lis.filter((l) => l.__keep).length, total: lis.length, order: lis.map((l) => l.dataset.key).join() };
  }, t);
  console.log(`   recálculo do ranking (peso -> mapa recolorido): ${r.ms} ms; linhas reaproveitadas ${r.kept}/${r.total}; ordem mudou: ${r.order !== before}`);
  expect(r.kept > 0, 'a lista foi reconstruída');
  expect(r.ms <= 150, `recálculo levou ${r.ms} ms`);
});
await step('explorador: aba Detalhes ao escolher um bairro', async () => {
  await page.click('[data-rank-list] li >> nth=0 >> button');
  await page.waitForSelector('[data-tab="detail"][aria-selected="true"]');
  expect(await page.isVisible('.detail .hd'), 'detalhe do bairro');
});
// --- Holograma: máquina de estados PLANO <-> INCLINADO(bairro) -----------------------------------------
const hs = () => page.evaluate(() => document.querySelector('[data-holo]').holoState());
// Calcula o ponto do bairro e clica no MESMO instante (dentro da página): com a câmera em movimento, um
// clique de fora chega alguns ms depois, quando o bairro já saiu daquele ponto. Clica no ponto do rótulo
// (dentro do bairro): com a câmera aproximando, qualquer deslocamento cai no bairro vizinho.
const clickHood = (id) =>
  page.evaluate((id) => {
    const pt = document.querySelector('[data-holo]').holoPoint(id);
    const canvas = document.querySelector('.maplibregl-canvas');
    const r = canvas.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + pt.x, clientY: r.top + pt.y, button: 0, buttons: 1, view: window };
    canvas.dispatchEvent(new MouseEvent('mousedown', o));
    canvas.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  }, id);
const settled = () => page.waitForTimeout(950);
await step('holograma: clique no bairro inclina para pitch 40 e sobe o holograma, com rótulo', async () => {
  await page.keyboard.press('Escape'); await settled();
  const [a] = (await hs()).top;
  await clickHood(a); await settled();
  const r = await hs();
  const op = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.holo')].map((e) => +e.style.opacity || 0)));
  expect(r.state === 'INCLINADO' && Math.round(r.pitch) === 40, `estado ${r.state}, pitch ${r.pitch}`);
  expect(op > 0.95, `holograma não subiu (opacidade ${op})`);
  expect(await page.isVisible('[data-plane]'), 'botão "Voltar ao plano"');
  expect(await page.isVisible('.holo-label'), 'rótulo "Visualização conceitual da unidade"');
  const txt = await page.evaluate(() => document.body.innerText);
  expect(!/fluxo estimado|potencial da unidade|126 mil/i.test(txt), 'dado inventado na tela');
});
await step('holograma: reclique no mesmo bairro volta ao plano (pitch 0, sem holograma)', async () => {
  const { id } = await hs();
  await clickHood(id); await settled();
  const r = await hs();
  const op = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.holo')].map((e) => +e.style.opacity || 0)));
  expect(r.state === 'PLANO' && r.pitch < 0.01 && op < 0.01, JSON.stringify({ ...r, op }));
  expect(!(await page.isVisible('[data-plane]')), 'botão ainda visível');
});
await step('holograma: outro bairro já inclinado troca sem voltar ao plano; botão e Esc voltam', async () => {
  const [a, b] = (await hs()).top;
  await clickHood(a); await settled();
  const pitches = page.evaluate(() => new Promise((done) => {
    const out = [];
    const t0 = performance.now();
    const tick = () => (out.push(document.querySelector('[data-holo]').holoState().pitch), performance.now() - t0 < 600 ? requestAnimationFrame(tick) : done(out));
    requestAnimationFrame(tick);
  }));
  await page.click('[data-tab="ranking"]'); // com a câmera no bairro a, o b pode estar fora da tela: troca pelo ranking
  await page.click(`[data-rank-list] [data-hood="${b}"]`);
  const min = Math.min(...(await pitches));
  await settled();
  expect((await hs()).id === b && min > 39, `trocou para ${(await hs()).id}, pitch mínimo ${min}`);
  await page.click('[data-plane]'); await settled();
  expect((await hs()).state === 'PLANO', 'botão não voltou ao plano');
  await clickHood(a); await settled();
  await page.keyboard.press('Escape'); await settled();
  const r = await hs();
  expect(r.state === 'PLANO' && r.pitch < 0.01, 'Esc não voltou ao plano');
});
await step('holograma: clique no meio da transição reverte do ponto atual; arrastar não muda o estado', async () => {
  const [a] = (await hs()).top;
  await clickHood(a); await page.waitForTimeout(180);
  const mid = (await hs()).pitch;
  await clickHood(a); await settled();
  const r = await hs();
  expect(mid > 0 && mid < 40 && r.state === 'PLANO' && r.pitch < 0.01, `meio ${mid}, fim ${JSON.stringify(r)}`);
  await clickHood(a); await settled();
  const box = await page.locator('[data-map]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height * 0.8 - 40, { steps: 8 }); await page.mouse.up();
  await settled();
  const d = await hs();
  expect(d.state === 'INCLINADO' && Math.round(d.pitch) === 40, `arrastar mudou o estado: ${JSON.stringify(d)}`);
  await page.keyboard.press('Escape'); await settled();
});
await step('explorador -> visão geral -> explorador: mesmo mapa, cidade e aba (sem recarregar)', async () => {
  await page.evaluate(() => (document.querySelector('.maplibregl-canvas').__keep = true));
  await page.click('.ex-overview');
  await page.waitForSelector('#view [data-dashboard]');
  await page.waitForFunction(() => !document.querySelector('.view-layer').classList.contains('is-shown'));
  await page.click('.topnav [data-nav="explorer"]');
  await page.waitForFunction(() => document.querySelector('.view-layer').classList.contains('is-shown'));
  const r = await page.evaluate(() => ({
    sameMap: document.querySelector('.maplibregl-canvas').__keep === true,
    city: document.querySelector('.right-head h2')?.textContent,
    tab: document.querySelector('[aria-selected="true"][data-tab]')?.dataset.tab,
  }));
  expect(r.sameMap, 'o mapa foi recriado');
  expect(r.city === 'Recife' && r.tab === 'detail', `estado perdido: ${JSON.stringify(r)}`);
});
await step('menu no explorador: "Análises" abre a página e o explorador volta como estava', async () => {
  await page.click('.view-layer .topnav [data-nav="analises"]');
  await page.waitForSelector('#view .ov-analyses');
  await page.waitForTimeout(600);
  await page.click('#view .topnav [data-nav="explorer"]');
  await page.waitForFunction(() => document.querySelector('.view-layer').classList.contains('is-shown'));
  expect((await page.evaluate(() => document.querySelector('.right-head h2')?.textContent)) === 'Recife', 'cidade perdida');
});
await step('celular: menu (hambúrguer) com Explorar, abre e fecha pelo teclado', async () => {
  const m = await browser.newContext({ bypassCSP: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const p = await m.newPage(); watch(p);
  await p.goto(`${BASE}/app/#/home`); await p.waitForSelector('[data-dashboard]');
  expect(!(await p.isVisible('.topnav [data-nav="explorer"]')), 'menu aberto sem pedir');
  await p.click('[data-topbar-menu]');
  expect(await p.isVisible('.topnav [data-nav="explorer"]') && (await p.getAttribute('[data-topbar-menu]', 'aria-expanded')) === 'true', 'menu não abriu');
  await p.keyboard.press('Escape');
  expect(!(await p.isVisible('.topnav [data-nav="explorer"]')), 'Esc não fechou o menu');
  await m.close();
});
await step('celular: gaveta de navegação e gaveta do ranking', async () => {
  const m = await browser.newContext({ bypassCSP: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const p = await m.newPage(); watch(p);
  await p.goto(`${BASE}/app/#/explorer?city=2611606`);
  await p.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  await p.tap('[data-toggle-panel]');
  await p.waitForSelector('.drawer-open');
  await p.tap('[data-scrim]', { position: { x: 370, y: 400 } });
  await p.waitForSelector('.drawer-open', { state: 'detached' });
  await p.tap('[data-sheet]');
  await p.waitForSelector('.sheet-open [data-rank-list] li');
  await m.close();
});
await step('prefers-reduced-motion: sem entrada escalonada e ranking sem FLIP', async () => {
  const m = await browser.newContext({ bypassCSP: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', storageState: await ctx.storageState() });
  const p = await m.newPage(); watch(p);
  await p.goto(`${BASE}/app/#/home`); await p.waitForSelector('[data-cx]');
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('[data-cx]')).animationName);
  expect(anim === 'none', `cartões animam: ${anim}`);
  await p.goto(`${BASE}/app/#/explorer?city=2611606`);
  await p.waitForFunction(() => performance.getEntriesByName('app:recolor').length > 0, null, { timeout: 30000 });
  await p.waitForSelector('[data-rank-list] li');
  const n0 = await p.evaluate(() => performance.getEntriesByName('app:recolor').length);
  await p.evaluate(() => {
    const r = document.querySelector('[data-weight="0"]');
    r.value = r.value === '5' ? '1' : '5';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForFunction((n) => performance.getEntriesByName('app:recolor').length > n, n0);
  const flips = await p.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('[data-rank-list]')).length);
  expect(flips === 0, `${flips} animações de ranking com movimento reduzido`);
  // Holograma: inclinação instantânea e quadro fixo (sem giro).
  const pr = await p.evaluate(async () => {
    const L = document.querySelector('[data-holo]');
    const [id] = L.holoState().top;
    const pt = L.holoPoint(id);
    const c = document.querySelector('.maplibregl-canvas'), r = c.getBoundingClientRect();
    const o = { bubbles: true, clientX: r.left + pt.x, clientY: r.top + pt.y, button: 0, view: window };
    for (const t of ['mousedown', 'mouseup', 'click']) c.dispatchEvent(new MouseEvent(t, o));
    await new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
    const pitch = L.holoState().pitch;
    await new Promise((d) => setTimeout(d, 600));
    const p1 = L.holoStats().paints;
    await new Promise((d) => setTimeout(d, 1500));
    return { pitch, paints: L.holoStats().paints - p1 };
  });
  expect(Math.round(pr.pitch) === 40, `inclinação não foi instantânea: pitch ${pr.pitch}`);
  expect(pr.paints === 0, `o holograma girou com movimento reduzido (${pr.paints} quadros)`);
  await m.close();
});
await step('"Conhecer a VICUS" -> landing mostra "Ir para a plataforma"', async () => {
  await page.goto(`${BASE}/app/#/home`); await page.waitForSelector('.about-link');
  await page.click('.about-link');
  await page.waitForURL(`${BASE}/`);
  await page.waitForFunction(() => document.documentElement.classList.contains('is-user'), null, { timeout: 8000 });
  expect(await page.isVisible('.end-actions [data-app-route="#/home"]'), 'botão "Ir para a plataforma" invisível');
  expect(!(await page.isVisible('.end-actions [data-app-route="#/register"]')), '"Criar conta" ainda visível');
});
await step('"Ir para a plataforma" -> /app/#/home', async () => {
  await page.click('.end-actions [data-app-route="#/home"]');
  await page.waitForURL(/\/app\/#\/home/); await page.waitForSelector('[data-dashboard]');
});
await ctx.close();

// --- Links diretos sem sessão ----------------------------------------------------------------------------
const guest = await browser.newContext({ bypassCSP: true }); const g = await guest.newPage(); watch(g);
await step('link direto /app/#/login (visitante) e recarregar', async () => {
  await g.goto(`${BASE}/app/#/login`); await g.waitForSelector('#email'); await g.reload(); await g.waitForSelector('#email');
});
await step('/app redireciona para /app/ (mesma porta)', async () => {
  const r = await g.goto(`${BASE}/app`); expect(r.url().startsWith(`${BASE}/app/`), r.url());
});
await step('/app/#/home sem sessão vai para o login', async () => {
  await g.goto(`${BASE}/app/#/home`); await g.waitForURL(/#\/login/);
});
await guest.close();
await browser.close();

for (const [s, n] of results) console.log(s, n);
if (errors.length) console.log('Erros no console:', [...new Set(errors)]);
process.exitCode = results.some(([s]) => s === '❌') || errors.length ? 1 : 0;
