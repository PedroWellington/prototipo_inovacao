// CountUp: só inteiros a partir de 10 contam, sempre em inteiros; o resto (e o movimento reduzido) mostra o final direto.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countNumber, countUp, dec } from './motion.js';

let frames, reduce;
const el = () => ({
  textContent: '', dataset: {}, attrs: {}, sibling: null,
  setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, after(n) { this.sibling = n; },
});
beforeEach(() => {
  frames = []; reduce = false;
  globalThis.matchMedia = () => ({ matches: reduce });
  globalThis.requestAnimationFrame = (f) => frames.push(f);
  globalThis.document = { createElement: () => ({ removed: false, remove() { this.removed = true; } }) };
});
afterEach(() => { delete globalThis.matchMedia; delete globalThis.requestAnimationFrame; delete globalThis.document; });
// Roda os quadros pendentes num relógio falso; devolve os textos mostrados.
function run(e) {
  const seen = [e.textContent];
  for (let t = performance.now(), i = 0; frames.length && i < 200; i++, t += 16) { frames.shift()(t); seen.push(e.textContent); }
  return seen;
}

describe('countUp', () => {
  it('1 e 7 aparecem direto, sem animação', () => {
    for (const v of [1, 7]) {
      const e = el();
      countUp(e, v);
      expect(e.textContent).toBe(String(v));
      expect(frames).toHaveLength(0);
    }
  });

  it('5.570 conta só em inteiros e termina exato', () => {
    const e = el();
    countUp(e, 5570);
    expect(frames).toHaveLength(1);
    expect(e.attrs['aria-hidden']).toBe('true'); // números que passam: escondidos do leitor de tela
    expect(e.sibling.textContent).toBe('5.570'); // ...que lê só o final
    const seen = run(e).filter(Boolean);
    expect(seen.length).toBeGreaterThan(5);
    for (const s of seen) expect(s).toMatch(/^\d{1,3}(\.\d{3})*$/); // nada de vírgula no meio
    expect(seen.at(-1)).toBe('5.570');
    expect(e.attrs['aria-hidden']).toBeUndefined();
    expect(e.sibling.removed).toBe(true);
  });

  it('decimais de verdade aparecem direto, com formatação brasileira', () => {
    const ratio = el();
    countUp(ratio, 1.6, { fmt: (v) => `${dec(v, 1)}x`, decimals: 1 });
    expect(ratio.textContent).toBe('1,6x');
    const money = el();
    countUp(money, 1500.5, { fmt: (v) => `R$ ${dec(v, 2)}` });
    expect(money.textContent).toBe('R$ 1.500,50');
    expect(frames).toHaveLength(0);
    const tpl = countNumber(1500.5, { decimals: 2 });
    expect(tpl[Object.getOwnPropertySymbols(tpl)[0]]).toContain('>1.500,50<'); // valor final já no HTML
  });

  it('com movimento reduzido nenhum número anima', () => {
    reduce = true;
    const e = el();
    countUp(e, 5570);
    expect(e.textContent).toBe('5.570');
    expect(frames).toHaveLength(0);
    expect(e.attrs['aria-hidden']).toBeUndefined();
  });
});
