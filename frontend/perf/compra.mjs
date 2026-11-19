// Compra de créditos com pagamento SIMULADO, de ponta a ponta (backend com PAYMENTS_MODE=demo):
// boas-vindas (5), total em tempo real, nova aba de checkout, confirmação, saldo atualizado sem recarregar
// (barra, Análises, Visão geral), aba bloqueada ("Abrir pagamento"), "Fechar", axe e capturas nos dois temas.
//   docker compose up -d (backend com PAYMENTS_MODE=demo); cd frontend; node perf/compra.mjs   (SHOTS=1: docs/visual/compra/)
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
const SHOTS = process.env.SHOTS === '1' && new URL('../../docs/visual/compra/', import.meta.url);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? 'ok ' : 'FALHA'} ${msg}`); };

async function axe(page, name) {
  await page.waitForTimeout(700);
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] }));
  const v = r.violations.flatMap((x) => x.nodes.map((n) => `${x.id}: ${n.target.join(' ')} ${n.failureSummary?.split('\n')[1]?.trim() || ''}`));
  ok(v.length === 0, `${name}: axe ${v.length} violação(ões)${v.length ? ` (${v.slice(0, 3).join('; ')})` : ''}`);
}

async function onboard(page, tag) {
  await page.goto(`${BASE}/app/#/register`);
  await page.waitForSelector('#name');
  await page.fill('#name', 'Bia Compra');
  await page.fill('#email', `compra-${Date.now()}-${tag}@example.com`);
  await page.fill('#password', 'compra-senha-12345');
  await page.check('input[name="accept_terms"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/#\/onboarding/);
  for (let i = 0; i < 10; i++) { // mesmo roteiro do perf/a11y.mjs
    await page.waitForSelector('.ob-card, [data-dashboard]');
    if (await page.$('[data-dashboard]')) break;
    if (/sede/i.test(await page.textContent('.ob-card h1'))) await page.click('.tile[data-value="false"]');
    else if ((await page.$('.tile[aria-checked="false"]')) && !(await page.$('.tile[aria-checked="true"]'))) await page.click('.tile >> nth=0');
    const submit = page.locator('.ob-card button[type="submit"]');
    if ((await submit.isDisabled()) && (await page.$('[data-skip]'))) await page.click('[data-skip]');
    else await submit.click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('.tour.is-open .tour-card', { timeout: 15000 }).then(() => page.keyboard.press('Escape')).catch(() => {});
}

const chip = (page) => page.locator('.topbar [data-credit-balance]').first();
const waitChip = (page, n) => page.waitForFunction((v) => document.querySelector('.topbar [data-credit-balance]')?.textContent.trim() === v, String(n), { timeout: 10000 }).then(() => true, () => false);

for (const [device, viewport, theme] of [
  ['desktop', { width: 1440, height: 900 }, 'light'], ['desktop escuro', { width: 1440, height: 900 }, 'dark'],
  ['celular', { width: 390, height: 844 }, 'light'], ['celular escuro', { width: 390, height: 844 }, 'dark'],
]) {
  const mobile = device.startsWith('celular');
  const ctx = await browser.newContext({ bypassCSP: true, viewport, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
  const page = await ctx.newPage();
  const d = (m) => `${device}: ${m}`;
  const shot = (p, name) => SHOTS && p.screenshot({ path: fileURLToPath(new URL(`${name}-${mobile ? 'celular' : 'desktop'}-${theme}.png`, SHOTS)), fullPage: false });

  await onboard(page, device.replace(/\W/g, ''));
  ok(await waitChip(page, 5), d('conta nova com 5 créditos de boas-vindas (barra)'));
  ok(!(await page.textContent('body')).includes('Plano'), d('nada de "Plano" na Visão geral'));

  await page.goto(`${BASE}/app/#/creditos`);
  await page.waitForSelector('#buyQty');
  const total = () => page.textContent('[data-total]').then((t) => t.replace(/\s/g, ' ').trim());
  ok((await total()) === 'R$ 178,00', d(`10 créditos = ${await total()}`));
  await page.click('[data-step="1"]');
  ok((await page.inputValue('#buyQty')) === '11' && (await total()) === 'R$ 195,80', d('+ soma 1 e o total acompanha'));
  await page.click('[data-pack="25"]');
  ok((await total()) === 'R$ 445,00' && (await page.getAttribute('[data-pack="25"]', 'aria-pressed')) === 'true', d('atalho 25'));
  await page.fill('#buyQty', '60');
  ok((await page.inputValue('#buyQty')) === '50', d('máximo 50 por pedido'));
  ok((await page.textContent('body')).includes('Valor de demonstração, a definir.'), d('preço marcado como demonstração'));
  await page.click('[data-pack="10"]');
  await axe(page, d('Comprar créditos'));
  await shot(page, 'comprar');

  // Comprar: a nova aba nasce no clique; confirmar credita e esta aba atualiza sem recarregar.
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.click('[data-buy]')]);
  await tab.waitForSelector('[data-confirm]');
  ok((await tab.textContent('.checkout-sim')).replace(/\s+/g, ' ').includes('Pagamento simulado. Nenhuma cobrança real será feita.'), d('aviso de pagamento simulado em destaque'));
  ok(!(await tab.$('input')), d('checkout sem nenhum campo de pagamento'));
  ok((await tab.textContent('.checkout-total')).replace(/\s/g, ' ').trim() === 'R$ 178,00', d('checkout com o valor do servidor'));
  await axe(tab, d('checkout'));
  await shot(tab, 'checkout');
  const navs = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && navs.push(f.url()));
  await tab.click('[data-confirm]');
  await tab.waitForSelector('.buy-ok');
  await axe(tab, d('checkout confirmado'));
  await shot(tab, 'checkout-confirmado');
  ok(await waitChip(page, 15), d('saldo na barra foi a 15 sem recarregar'));
  ok(Number(await page.textContent('.buy-balance [data-credit-balance]')) === 15, d('saldo da tela de compra atualizado'));
  await page.waitForSelector('.buy-ok', { timeout: 8000 }).catch(() => {});
  ok(navs.length === 0, d('aba original não recarregou'));
  await page.bringToFront();
  await shot(page, 'saldo-atualizado');
  const [closed] = await Promise.all([tab.waitForEvent('close', { timeout: 5000 }).then(() => true, () => false), tab.click('[data-close]')]);
  ok(closed, d('botão Fechar fecha a aba'));

  // Navegador que bloqueia a nova aba: aparece o link "Abrir pagamento".
  await page.evaluate(() => { window.open = () => null; });
  await page.click('[data-pack="5"]');
  await page.click('[data-buy]');
  await page.waitForSelector('[data-open-checkout]');
  ok((await page.textContent('[data-status]')).includes('bloqueou'), d('aba bloqueada: link "Abrir pagamento"'));

  for (const [hash, sel] of [['#/analises', '.metric [data-credit-balance]'], ['#/home', '.metric [data-credit-balance]']]) {
    await page.goto(`${BASE}/app/${hash}`);
    await page.waitForSelector(sel);
    await page.waitForTimeout(1200);
    ok((await page.textContent(sel)).trim() === '15', d(`${hash}: saldo 15`));
  }
  await page.goto(`${BASE}/app/#/termos`);
  await page.waitForSelector('#creditos');
  ok((await page.textContent('body')).includes('os pagamentos são simulados'), d('Termos: pagamentos simulados'));
  await ctx.close();
}
await browser.close();
console.log(fails.length ? `\n${fails.length} falha(s)` : '\ntudo certo');
process.exit(fails.length ? 1 : 0);
