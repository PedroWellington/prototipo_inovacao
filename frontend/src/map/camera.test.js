import { describe, expect, it } from 'vitest';
import { cameraStep } from './camera.js';

// Simula a câmera a 60 Hz até chegar.
function run(cam, goal, dt = 16.7) {
  const frames = [cam];
  for (let i = 0; i < 2000; i++) {
    const r = cameraStep(frames.at(-1), goal, dt);
    frames.push(r.cam);
    if (r.done) return frames;
  }
  throw new Error('não chegou');
}

describe('cameraStep', () => {
  const brasil = { x: 0.35, y: 0.54, zoom: 3.5 };
  const bairro = { x: 0.4029, y: 0.5224, zoom: 14 };

  it('chega ao destino exato e o zoom avança sem voltar', () => {
    const f = run(brasil, bairro);
    expect(f.at(-1)).toEqual(bairro);
    for (let i = 1; i < f.length; i++) expect(f[i].zoom).toBeGreaterThanOrEqual(f[i - 1].zoom);
  });

  it('o destino nunca sai da vista numa aproximação grande', () => {
    // Vista de 1000 px: meia largura em coordenadas Mercator = 500 / (512 * 2^zoom).
    for (const c of run(brasil, bairro)) {
      const half = 500 / (512 * 2 ** c.zoom);
      expect(Math.abs(c.x - bairro.x)).toBeLessThanOrEqual(half);
      expect(Math.abs(c.y - bairro.y)).toBeLessThanOrEqual(half);
    }
  });

  it('afastando, também termina no destino', () => {
    expect(run(bairro, brasil).at(-1)).toEqual(brasil);
  });

  it('o ritmo não depende da taxa de quadros', () => {
    const at = (dt, ms) => run(brasil, bairro, dt)[Math.round(ms / dt)].zoom;
    expect(Math.abs(at(16.7, 500) - at(6.9, 500))).toBeLessThan(0.15);
  });
});

import { ease } from './camera.js';
describe('ease (cubic-bezier .22,1,.36,1)', () => {
  it('vai de 0 a 1, sem voltar, e acelera no começo', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let prev = 0;
    for (let x = 0.01; x <= 1; x += 0.01) {
      const v = ease(x);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(ease(0.5)).toBeGreaterThan(0.85); // curva "spring": já perto do fim na metade
  });
});
