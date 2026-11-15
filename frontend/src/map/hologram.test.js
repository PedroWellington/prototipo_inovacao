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
