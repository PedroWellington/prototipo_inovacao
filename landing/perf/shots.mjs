// Capturas da jornada em pontos fixos do scroll (conferência visual).
//   node perf/shots.mjs <página> <prefixo-de-saída> [desktop|mobile|reduced] [lista de progressos]
import { chromium } from 'playwright-core';
const [,, page_ = '/', out, mode = 'desktop', list = '0,.15,.29,.43,.51,.58,.66,.75,.83,.9,.97'] = process.argv;
const b = await chromium.launch({ channel: 'msedge', headless: true });
const mobile = mode === 'mobile';
const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
const p = await ctx.newPage();
const logs = []; p.on('console', m => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', e => logs.push('pageerror: ' + e.message));
await p.goto('http://localhost:4173' + page_, { waitUntil: 'load' }); await p.waitForTimeout(2500);
if (mode === 'reduced') { await p.screenshot({ path: `${out}-reduced-full.png`, fullPage: true }); }
else for (const v of list.split(',')) {
  await p.evaluate(v => { const s = document.querySelector('.story'); scrollTo(0, s.offsetTop + v * (s.offsetHeight - innerHeight)); }, +v);
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${out}-${mode}-${v}.png` });
}
console.log(logs.join('\n'));
await b.close();
