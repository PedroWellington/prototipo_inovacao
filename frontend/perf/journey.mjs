// Teste de ponta a ponta da integração landing (/) + app (/app/), com o Edge instalado.
//   docker compose up -d --build; cd frontend; node perf/journey.mjs        (BASE=http://host:porta para outro endereço)
// Cria um usuário descartável (perf-…@example.com). Sai com código 1 se algum passo falhar.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
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

// --- Menu do topo: clique em cada item, indo e voltando ------------------------------------------------
async function menu(label, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1 });
  const page = await ctx.newPage(); watch(page);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  const order = ['#produto', '#fontes', '#planos', '#final', '#inicio', '#final', '#planos', '#fontes', '#produto', '#inicio'];
  for (const href of order) {
    await step(`${label}: menu ${href}`, async () => {
      if (mobile) { await page.click('.nav-toggle'); await page.waitForSelector('.nav-links a', { state: 'visible' }); }
      await page.click(`.nav-links a[href="${href}"]`);
      await page.waitForTimeout(700);
      const r = await page.evaluate((h) => {
        const sec = document.querySelector(h), nav = document.getElementById('navbar');
        return {
          top: Math.round(sec.getBoundingClientRect().top), navBottom: Math.round(nav.getBoundingClientRect().bottom),
          active: document.querySelector('.nav-links a.is-active')?.getAttribute('href'),
          menuOpen: nav.classList.contains('menu-open'),
          atBottom: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1,
        };
      }, href);
      expect(r.active === href, `ativo = ${r.active}`);
      if (href === '#inicio') expect(r.top === 0 || r.top > -2, `início fora do topo (${r.top})`);
      // A última seção não sobe além do fim da página: basta estar visível com a página no fim.
      else expect((r.top >= r.navBottom - 2 && r.top <= r.navBottom + 30) || (r.atBottom && r.top >= r.navBottom - 2), `seção em ${r.top}px, barra termina em ${r.navBottom}px`);
      expect(!r.menuOpen, 'menu do celular não fechou');
    });
  }
  // Rolagem manual: o destaque acompanha a seção visível
  await step(`${label}: destaque acompanha a rolagem`, async () => {
    await page.evaluate(() => scrollTo(0, document.getElementById('fontes').offsetTop));
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => document.querySelector('.nav-links a.is-active')?.getAttribute('href'));
    expect(a === '#fontes', `ativo = ${a}`);
  });
  await ctx.close();
}
await menu('desktop', { width: 1440, height: 900 }, false);
await menu('celular', { width: 390, height: 844 }, true);

// --- Caminho completo: visitante -> conta -> onboarding -> home -> explorador -> landing -> app ---------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); watch(page);
const email = `perf-${Date.now()}@example.com`;
await step('landing: visitante vê "Criar conta" e "Entrar"', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  expect(await page.isVisible('.end-actions [data-app-route="#/register"]'), '"Criar conta" invisível');
  expect(!(await page.isVisible('.end-actions [data-app-route="#/home"]')), '"Ir para a plataforma" visível para visitante');
  const plan = await page.getAttribute('.plan [data-app-route="#/register"]', 'href');
  expect(plan === '/app/#/register', `plano gratuito -> ${plan}`);
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
await step('tela inicial: logo volta para #/home e há "Conhecer a VICUS"', async () => {
  expect(await page.getAttribute('.logo-link', 'href') === '#/home', 'logo não aponta para #/home');
  expect(await page.getAttribute('.about-link', 'href') === '/', 'link da landing ausente');
});
await step('menu: ordem Visão geral · Minhas análises · Dados e fontes · Explorador (por último, em destaque)', async () => {
  const items = await page.$$eval('.topbar .topnav [data-nav]', (els) => els.map((e) => e.textContent.trim()));
  expect(JSON.stringify(items) === JSON.stringify(['Visão geral', 'Minhas análises', 'Dados e fontes', 'Explorador']), items.join(' · '));
  expect(!(await page.evaluate(() => document.querySelector('.topbar').innerText.includes('Inteligência territorial'))), '"Inteligência territorial" ainda na barra');
  expect(await page.getAttribute('.topbar .logo-link', 'href') === '#/home', 'logo não leva à Visão geral');
});
await step('menu na Visão geral: "Dados e fontes" rola até a seção sem recarregar a tela', async () => {
  await page.evaluate(() => (document.querySelector('[data-dashboard]').__keep = true));
  await page.click('.topnav [data-nav="fontes"]');
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({
    same: document.querySelector('[data-dashboard]').__keep === true,
    top: Math.round(document.querySelector('#fontes').getBoundingClientRect().top),
    end: Math.ceil(scrollY + innerHeight) >= document.scrollingElement.scrollHeight - 2, // seção na última linha
    active: document.querySelector('.topnav [aria-current="page"]')?.dataset.nav,
  }));
  expect(r.same, 'a Visão geral foi recarregada');
  expect((r.top < 200 || r.end) && r.active === 'fontes', JSON.stringify(r));
  await page.click('.topbar .logo-link'); await page.waitForTimeout(800);
  expect(await page.evaluate(() => scrollY) < 5, 'a logo não voltou ao topo');
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
// clique de fora chega alguns ms depois, quando o bairro já saiu daquele ponto.
const clickHood = (id) =>
  page.evaluate((id) => {
    const pt = document.querySelector('[data-holo]').holoPoint(id);
    const canvas = document.querySelector('.maplibregl-canvas');
    const r = canvas.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: r.left + pt.x, clientY: r.top + pt.y + 8, button: 0, buttons: 1, view: window };
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
  await clickHood(b);
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
  await page.click('.topnav-cta[href="#/explorer"]');
  await page.waitForFunction(() => document.querySelector('.view-layer').classList.contains('is-shown'));
  const r = await page.evaluate(() => ({
    sameMap: document.querySelector('.maplibregl-canvas').__keep === true,
    city: document.querySelector('.right-head h2')?.textContent,
    tab: document.querySelector('[aria-selected="true"][data-tab]')?.dataset.tab,
  }));
  expect(r.sameMap, 'o mapa foi recriado');
  expect(r.city === 'Recife' && r.tab === 'detail', `estado perdido: ${JSON.stringify(r)}`);
});
await step('menu no explorador: "Minhas análises" leva à seção da Visão geral e o explorador volta como estava', async () => {
  await page.click('.view-layer .topnav [data-nav="analises"]');
  await page.waitForSelector('#view #analises');
  await page.waitForTimeout(1600);
  const r = await page.evaluate(() => ({ top: Math.round(document.querySelector('#analises').getBoundingClientRect().top), y: Math.round(scrollY), h: document.scrollingElement.scrollHeight, end: Math.ceil(scrollY + innerHeight) >= document.scrollingElement.scrollHeight - 2 }));
  expect(r.top < 200 || r.end, `seção em ${JSON.stringify(r)}`);
  await page.click('#view .topnav-cta');
  await page.waitForFunction(() => document.querySelector('.view-layer').classList.contains('is-shown'));
  expect((await page.evaluate(() => document.querySelector('.right-head h2')?.textContent)) === 'Recife', 'cidade perdida');
});
await step('celular: menu (hambúrguer) com Explorador em destaque, abre e fecha pelo teclado', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const p = await m.newPage(); watch(p);
  await p.goto(`${BASE}/app/#/home`); await p.waitForSelector('[data-dashboard]');
  expect(!(await p.isVisible('.topnav-cta')), 'menu aberto sem pedir');
  await p.click('[data-topbar-menu]');
  expect(await p.isVisible('.topnav-cta') && (await p.getAttribute('[data-topbar-menu]', 'aria-expanded')) === 'true', 'menu não abriu');
  await p.keyboard.press('Escape');
  expect(!(await p.isVisible('.topnav-cta')), 'Esc não fechou o menu');
  await m.close();
});
await step('celular: gaveta de navegação e gaveta do ranking', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
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
  const m = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', storageState: await ctx.storageState() });
  const p = await m.newPage(); watch(p);
  await p.goto(`${BASE}/app/#/home`); await p.waitForSelector('[data-dashboard]');
  const anim = await p.evaluate(() => getComputedStyle(document.querySelector('.ov-animate')).animationName);
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
    const o = { bubbles: true, clientX: r.left + pt.x, clientY: r.top + pt.y + 8, button: 0, view: window };
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
const guest = await browser.newContext(); const g = await guest.newPage(); watch(g);
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
