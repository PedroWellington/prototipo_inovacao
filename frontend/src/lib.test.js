import { describe, expect, it, vi } from 'vitest';
import { bbox, debounce, establishmentsText, normalize, scoreColor } from './lib.js';
import { resolve } from './router.js';

const STOPS = ['#d73027', '#fc8d59', '#f2d06b', '#91cf60', '#1a9850'];

describe('bbox', () => {
  it('cobre polígonos e multipolígonos', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [0, 0]]] } },
        { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[-1, -3], [0, 5], [-1, -3]]]] } },
      ],
    };
    expect(bbox(fc)).toEqual([[-1, -3], [2, 5]]);
  });
});

describe('scoreColor', () => {
  it('extremos são vermelho (0) e verde (100)', () => {
    expect(scoreColor(0, STOPS)).toBe('rgb(215,48,39)');
    expect(scoreColor(100, STOPS)).toBe('rgb(26,152,80)');
    expect(scoreColor(150, STOPS)).toBe('rgb(26,152,80)');
  });
  it('meio da escala é o amarelo', () => {
    expect(scoreColor(50, STOPS)).toBe('rgb(242,208,107)');
  });
});

describe('textos', () => {
  it('singular e plural', () => {
    expect(establishmentsText(1)).toBe('1 estabelecimento');
    expect(establishmentsText(1234)).toBe('1.234 estabelecimentos');
  });
  it('normaliza acentos', () => expect(normalize('  São JOSÉ ')).toBe('sao jose'));
});

describe('debounce', () => {
  it('chama só a última', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 250);
    d(1);
    d(2);
    vi.advanceTimersByTime(260);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });
});

describe('roteamento', () => {
  const done = { onboarding_completed: true };
  const fresh = { onboarding_completed: false };
  it('sem sessão vai para o login', () => expect(resolve('/explorer', null)).toBe('/login'));
  it('primeiro acesso força onboarding', () => expect(resolve('/explorer', fresh)).toBe('/onboarding'));
  it('logado não vê login', () => expect(resolve('/login', done)).toBe('/explorer'));
  it('termos abrem para todos', () => expect(resolve('/termos', null)).toBe('/termos'));
});
