// Vídeo "como funciona" da landing: nada do vídeo carrega com a página; modal abre, prende o foco, fecha (botão, Esc
// fora e dentro do iframe, clique fora) e remove o iframe; CSP real (sem bypass); celular 16:9; movimento reduzido.
// Dois vídeos: index.html no tema claro, escuro.html no escuro (escolhido ao abrir o modal). Depois, cada vídeo toca as
// 11 cenas inteiras: a narração em MP3 avança em todas, sem erro no console, e o botão de som silencia o MP3.
//   docker compose up -d; cd frontend; node perf/video.mjs      (SHOTS=1 grava capturas em docs/visual/video/)
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:8080';
const SHOTS = process.env.SHOTS === '1' && new URL('../../docs/visual/video/', import.meta.url);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true, args: ['--autoplay-policy=user-gesture-required'] });
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? 'ok ' : 'FALHA'} ${msg}`); };

for (const [device, viewport, theme, reduced] of [
  ['desktop', { width: 1440, height: 900 }, 'light', false], ['desktop escuro', { width: 1440, height: 900 }, 'dark', false],
  ['celular', { width: 390, height: 844 }, 'light', false], ['celular escuro', { width: 390, height: 844 }, 'dark', true],
]) {
  const mobile = device.startsWith('celular');
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
  const page = await ctx.newPage();
  const urls = [], errors = [];
  page.on('request', (r) => urls.push(r.url()));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  const d = (m) => `${device}: ${m}`;
  const shot = async (name, el) => SHOTS && (el || page).screenshot({ path: fileURLToPath(new URL(`${name}-${mobile ? 'celular' : 'desktop'}-${theme}.png`, SHOTS)) });
  const isOpen = () => page.evaluate(() => document.getElementById('videoModal').open);
  const frames = () => page.locator('#videoModal iframe').count();
  // o <dialog> fecha na hora, mas o evento close (que remove o iframe) roda numa tarefa seguinte: espera até 1 s
  const closed = async () => { for (let i = 0; i < 20; i++) { if (!(await isOpen()) && (await frames()) === 0) return true; await page.waitForTimeout(50); } return false; };

  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  ok(!urls.some((u) => /\/video\/(index\.html|escuro\.(html|js)|narracao\.mp3|video\.js)/.test(u)), d('iframe, MP3 e animação não carregam com a página'));
  ok(!urls.some((u) => /\/video\/poster(-escuro)?\.jpg/.test(u)), d('capa lazy: não carrega no topo'));
  const video = theme === 'dark' ? 'escuro' : 'index';

  const btn = page.locator('#videoOpen');
  await btn.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200); // revelação .rv e a capa
  const box = await page.locator('.video-play').boundingBox();
  ok(box.height >= 48, d(`botão de play com ${Math.round(box.height)} px de altura (toque)`));
  ok(await page.evaluate(() => [...document.querySelectorAll('#videoOpen img')].some((i) => i.offsetParent && i.complete && i.naturalWidth === 1280 && i.getAttribute('width') && i.getAttribute('height'))), d('capa carregada com width/height'));
  const poster = theme === 'dark' ? 'poster-escuro.jpg' : 'poster.jpg', other = theme === 'dark' ? '/video/poster.jpg' : '/video/poster-escuro.jpg';
  ok(urls.some((u) => u.endsWith('/video/' + poster)) && !urls.some((u) => u.endsWith(other)), d(`capa do tema (${poster}); a outra não é baixada`));
  ok(await page.locator('.video-note').first().isVisible(), d('aviso "Animação ilustrativa" abaixo da capa'));
  await shot('bloco', btn);

  // Teclado: foco no botão, Enter abre; foco vai para "Fechar"; iframe com src/allow/title.
  await btn.focus();
  await page.keyboard.press('Enter');
  ok(await isOpen(), d('Enter abre o modal'));
  ok(await page.evaluate(() => document.activeElement.classList.contains('video-close')), d('foco no botão Fechar'));
  const attrs = await page.locator('#videoModal iframe').evaluate((f) => [f.getAttribute('src'), f.allow, f.title]);
  ok(attrs.join('|') === `/video/${video}.html?embed=1&auto=1|autoplay|Vídeo: como o VICUS funciona`, d(`iframe ${attrs.join(' | ')}`));
  ok(await page.locator('#videoModal .video-note').isVisible(), d('aviso "Animação ilustrativa" no modal'));
  const dlg = await page.locator('#videoModal').evaluate((e) => [e.getAttribute('role'), e.getAttribute('aria-modal'), e.getAttribute('aria-label')].join('|'));
  ok(dlg === 'dialog|true|Vídeo: como o VICUS funciona', d('role, aria-modal e aria-label'));
  await page.waitForTimeout(3500);
  const inner = page.frameLocator('#videoModal iframe');
  ok(await inner.locator('#cap').count() === 1, d('animação abriu dentro do iframe (CSP real)'));
  ok(urls.some((u) => u.includes('/video/narracao.mp3')), d('narração buscada só depois do clique'));
  const fb = await page.locator('#videoModal iframe').boundingBox();
  ok(Math.abs(fb.width / fb.height - 16 / 9) < 0.02, d(`iframe 16:9 (${Math.round(fb.width)}x${Math.round(fb.height)})`));
  if (mobile) ok(Math.round(fb.width) === viewport.width, d('celular: vídeo na largura toda'));
  await shot('modal');

  // Foco preso: Tab várias vezes não sai do modal.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.getElementById('videoModal').contains(document.activeElement) || document.activeElement === document.body), d('Tab não sai do modal'));
  await page.locator('.video-close').focus();
  await page.keyboard.press('Escape');
  ok(await closed(), d('Esc fecha e remove o iframe'));
  ok(await page.evaluate(() => document.activeElement.id === 'videoOpen'), d('foco volta ao botão'));

  // Esc com o foco dentro do iframe.
  await btn.click();
  await page.waitForTimeout(1500);
  await page.locator('#videoModal iframe').focus();
  await page.locator('#videoModal iframe').evaluate((f) => f.contentWindow.focus());
  await page.keyboard.press('Escape');
  ok(await closed(), d('Esc dentro do iframe fecha'));

  // Clique fora do vídeo e botão Fechar.
  await btn.click();
  await page.mouse.click(8, viewport.height - 8);
  ok(await closed(), d('clique fora fecha'));
  await btn.click();
  await page.locator('.video-close').click();
  ok(await closed(), d('botão Fechar fecha'));
  ok(await page.evaluate(() => document.activeElement.id === 'videoOpen'), d('foco volta ao botão (Fechar)'));
  ok(!errors.some((e) => /Content Security Policy|frame|Refused/i.test(e)), d(`sem erro de CSP (${errors.filter((e) => /Content Security|Refused/.test(e)).join('; ') || 'nenhum'})`));
  await ctx.close();
}

// Autoplay bloqueado (política do navegador): ?auto=1 mostra "Toque para começar" em vez de ficar mudo.
for (const video of ['index', 'escuro']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/video/${video}.html?embed=1&auto=1`);
  await page.waitForTimeout(1500);
  ok(await page.locator('#start').isVisible(), `${video}.html: sem gesto, mostra "Toque para começar"`);
  ok(!(await page.locator('#voice').isVisible()) || !(await page.locator('#voice').innerText()).trim(), `${video}.html: rótulo "Voz" escondido`);
  await ctx.close();
}
await browser.close();

// As 11 cenas de cada vídeo, do começo ao fim, com o autoplay liberado: o MP3 avança em todas as cenas.
const player = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
for (const video of ['index', 'escuro']) {
  const ctx = await player.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errors = [];
  // Aberto fora do iframe, o navegador pede /favicon.ico (404 aqui); dentro da landing isso não acontece.
  page.on('console', (m) => m.type() === 'error' && !/favicon\.ico$/.test(m.location().url || '') && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(`${BASE}/video/${video}.html?embed=1&auto=1`);
  const seen = new Map(); // cena -> [menor, maior] tempo do MP3 tocando nela
  let muteChecked = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const st = await page.evaluate(() => ({ k: window.__scene, t: NARR.currentTime, playing: !NARR.paused, start: getComputedStyle(document.getElementById('start')).display }));
    if (st.start !== 'none') break;
    if (st.playing && st.k != null) { const r = seen.get(st.k) || [st.t, st.t]; seen.set(st.k, [Math.min(r[0], st.t), Math.max(r[1], st.t)]); }
    if (!muteChecked && st.k === 3 && st.playing) { // botão de som: silencia o MP3 e volta
      await page.click('#mute');
      const m = await page.evaluate(() => NARR.muted);
      await page.click('#mute');
      ok(m === true && (await page.evaluate(() => NARR.muted)) === false, `${video}.html: botão de som silencia a narração em MP3`);
      muteChecked = true;
    }
    if (seen.size === 11 && st.k === 10 && !st.playing) break;
    await page.waitForTimeout(80);
  }
  for (let k = 0; k < 11; k++) { const r = seen.get(k); ok(r && r[1] - r[0] > 0.05, `${video}.html: cena ${k + 1} com narração em MP3 (${r ? r.map((x) => x.toFixed(2)).join('→') : 'sem áudio'} s)`); }
  ok(muteChecked, `${video}.html: botão de som testado`);
  ok(!errors.length, `${video}.html: sem erro no console (${errors.join('; ') || 'nenhum'})`);
  await ctx.close();
}
await player.close();
console.log(fails.length ? `\n${fails.length} falha(s)` : '\ntudo certo');
process.exit(fails.length ? 1 : 0);
