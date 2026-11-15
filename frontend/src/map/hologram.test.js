import { describe, expect, it } from 'vitest';
import { frameAt, layout, nearest, windowOf } from './hologram.js';

describe('holograma: giro por tempo', () => {
  it('uma volta a cada 12 s, independente da taxa de quadros', () => {
    expect(frameAt(0, 360)).toBe(0);
    expect(frameAt(3, 360)).toBe(90);
    expect(frameAt(12, 360)).toBe(0);
    expect(frameAt(18, 360)).toBe(180);
    // 60 Hz e 144 Hz chegam ao mesmo quadro no mesmo instante
    let a = 0.21, b = 0.21; // fora da fronteira entre dois quadros
    for (let k = 0; k < 60; k++) a += 1 / 60;
    for (let k = 0; k < 144; k++) b += 1 / 144;
    expect(frameAt(a, 360)).toBe(frameAt(b, 360));
  });
});

describe('holograma: janela deslizante', () => {
  it('cobre poucos quadros, com a volta (359 -> 0)', () => {
    const w = windowOf(358, 360, 3, 18);
    expect(w.length).toBe(22);
    expect(w).toContain(355);
    expect(w).toContain(0);
    expect(w).toContain(16);
    expect(w).not.toContain(17);
  });
  it('sem o quadro pedido, mostra o mais próximo já decodificado', () => {
    const has = (i) => i === 10 || i === 300;
    expect(nearest(12, 360, has)).toBe(10);
    expect(nearest(330, 360, has)).toBe(300);
    expect(nearest(5, 360, () => false)).toBe(-1);
  });
});

describe('holograma: posição', () => {
  const area = { left: 300, right: 1100, top: 70, bottom: 800 };
  it('fica acima do bairro, com o cone até o ponto', () => {
    const L = layout({ x: 700, y: 500 }, area, 230, 210, 64);
    expect(L.x).toBe(700 - 115);
    expect(L.y + 210).toBe(500 - 64);
    expect(L.cone.len).toBe(64);
    expect(L.cone.deg).toBe(0);
    expect(L.visible).toBe(true);
  });
  it('nunca invade painel nem topo: limita o corpo e inclina o cone', () => {
    const L = layout({ x: 310, y: 120 }, area, 230, 210, 64);
    expect(L.x).toBeGreaterThanOrEqual(area.left);
    expect(L.y).toBeGreaterThanOrEqual(area.top);
    expect(L.cone.deg).not.toBe(0);
  });
  it('bairro fora da área livre: some', () => {
    expect(layout({ x: 1300, y: 400 }, area, 230, 210, 64).visible).toBe(false);
  });
});

import { loadOrder, setFor, stillFrame, windowMB } from './hologram.js';
// Conjuntos falsos: trocar a imagem (N quadros) não muda o código nem a velocidade do giro.
describe('holograma trocável pelo manifesto (N = 36, 120 e 360)', () => {
  const sets = [36, 120, 360].map((count) => ({ dir: `t${count}/`, pattern: 'quadro-{i}.webp', count, width: 511, height: 411 }));
  it('mesmo ângulo no mesmo instante, com qualquer N (velocidade vem do período)', () => {
    for (const t of [0.5, 3, 7.25, 11.9]) {
      const angles = sets.map((s) => (frameAt(t, s.count, 12) / s.count) * 360);
      const step = 360 / 36; // a diferença máxima é um quadro do conjunto mais grosso
      expect(Math.max(...angles) - Math.min(...angles)).toBeLessThanOrEqual(step);
    }
    expect(frameAt(3, 36, 12)).toBe(9);
    expect(frameAt(3, 120, 12)).toBe(30);
  });
  it('janela e ordem de download se adaptam a N, sem repetir quadros', () => {
    for (const s of sets) {
      const w = windowOf(5, s.count);
      expect(new Set(w).size).toBe(w.length);
      expect(w.length).toBeLessThanOrEqual(s.count);
      const o = loadOrder(s.count);
      expect(new Set(o).size).toBe(s.count);
    }
    expect(windowOf(0, 1)).toEqual([0]); // imagem única: sem giro
    expect(windowOf(0, 4).length).toBe(4);
  });
  it('memória da janela fica abaixo de 80 MB no maior tamanho exibido (520 px)', () => {
    for (const s of sets) expect(windowMB(s, 520)).toBeLessThan(80);
  });
  it('quadro parado pelo ângulo e conjunto por tema com reserva', () => {
    expect(stillFrame(30, 360)).toBe(30);
    expect(stillFrame(30, 36)).toBe(3);
    const m = { sets: { claro: sets[0] } };
    expect(setFor(m, 'escuro')).toBe(sets[0]);
    expect(setFor({ sets: { claro: sets[0], escuro: sets[1] } }, 'escuro')).toBe(sets[1]);
  });
});
