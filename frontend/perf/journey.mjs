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
await step('recarregar /app/#/home mantém a tela', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-dashboard]');
});
await step('explorador abre e o mapa aparece', async () => {
  await page.goto(`${BASE}/app/#/explorer`);
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 });
  expect(await page.getAttribute('.ex-logo', 'href') === '#/home', 'logo do explorador');
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
