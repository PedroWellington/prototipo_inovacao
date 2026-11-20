import { describe, expect, it, vi } from 'vitest';
import { activeCities, bbox, debounce, establishmentsText, firstName, lastCity, normalize, scoreColor } from './lib.js';
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
  it('logado não vê login: vai para o início', () => expect(resolve('/login', done)).toBe('/home'));
  it('raiz leva ao início', () => expect(resolve('/', done)).toBe('/home'));
  it('termos abrem para todos', () => expect(resolve('/termos', null)).toBe('/termos'));
});

describe('activityText', () => {
  it('diz que conta a atividade principal, no singular e no plural', async () => {
    const { activityText } = await import('./lib.js');
    expect(activityText(1, 'Hospital')).toBe('1 estabelecimento com atividade principal de hospital');
    expect(activityText(1200, 'Farmácia')).toBe('1.200 estabelecimentos com atividade principal de farmácia');
  });
});

describe('ranking de cidades', () => {
  const res = {
    columns: ['ibge', 'name', 'score', 'rank', 'total_active', 'located', 'income_median', 'income_quartile', 'lx', 'ly', 'n', 'per_10k', 'per_km2', 'lower_share', 'higher_share'],
    rows: [
      [1, 'Alfa', 100, 1, 10, 5, 3000, 4, -35, -8, [9], [3], [0.009], [1], [0]],
      [2, 'Beta', 0, 2, 0, 0, null, null, null, null, [5], [1], [0.5], [0], [1]],
    ],
    criteria: [{ business_type_key: 'hospital', direction: 'attract', weight: 1 }],
    income: { note: 'nota', missing: 'sem renda', source: null },
  };
  it('remonta cada cidade sem recalcular nota', async () => {
    const { cityRankRows } = await import('./lib.js');
    const [a, b] = cityRankRows(res);
    expect([a.name, a.score, a.rank]).toEqual(['Alfa', 100, 1]);
    expect(a.criteria[0]).toMatchObject({ type: 'hospital', n: 9, per_10k: 3, per_km2: 0.009, lower: 1, higher: 0 });
    expect(a.income).toMatchObject({ available: true, text: 'Renda mediana da cidade: R$ 3.000/mês', note: 'nota' });
    expect(a.label).toEqual([-35, -8]);
    expect(b.income).toEqual({ available: false, label: 'Renda mediana da cidade', message: 'sem renda', note: 'nota', source: null });
    expect(b.coverage.share).toBe(0);
  });
  it('frase comparativa igual à dos bairros', async () => {
    const { cityComparisonText } = await import('./lib.js');
    expect(cityComparisonText('attract', 0.75, 0, 'estabelecimentos por km²')).toBe('mais estabelecimentos por km² que 75% das cidades analisadas');
    expect(cityComparisonText('repel', 0.75, 0.2, 'x')).toBe('menos x que 20% das cidades analisadas');
    expect(cityComparisonText('repel', 0.5, 0, 'x')).toBe('mais x que 50% das cidades analisadas');
  });
});

describe('countText', () => {
  it('mostra a fonte do tipo e o complemento do CNPJ para o CNES', async () => {
    const { countText } = await import('./lib.js');
    expect(countText(2, 4, { name: 'Hospital', source: 'cnes' })).toBe(
      '2 unidades ativas no CNES (Ministério da Saúde); complemento: 4 locais com CNPJ de atividade principal de hospital',
    );
    expect(countText(3, 3, { name: 'Farmácia', source: 'cnpj' })).toBe('3 estabelecimentos com atividade principal de farmácia');
  });
});

describe('conta', () => {
  it('iniciais da empresa', async () => {
    const { initials } = await import('./lib.js');
    expect(initials('Farmácia do Bairro')).toBe('FB');
    expect(initials('ana')).toBe('A');
    expect(initials('')).toBe('?');
  });
  it('confirmação de gasto', async () => {
    const { spendText } = await import('./lib.js');
    expect(spendText(1, 3)).toBe('Isto usa 1 crédito. Restam 3 (depois desta análise: 2).');
  });
});

describe('dashboard', () => {
  it('saudação com o primeiro nome capitalizado', () => {
    expect(firstName('ana MARIA silva')).toBe('Ana');
    expect(firstName('  élida ')).toBe('Élida');
    expect(firstName('')).toBe('');
  });
  it('última cidade analisada e cidades no prazo', () => {
    const st = {
      cities: [
        { ibge: 1, name: 'Olinda', unlocked_at: '2026-09-01T00:00:00', active: false },
        { ibge: 2, name: 'Recife', unlocked_at: '2026-11-01T00:00:00', active: true },
      ],
    };
    expect(lastCity(st).name).toBe('Recife');
    expect(activeCities(st).map((c) => c.ibge)).toEqual([2]);
    expect(lastCity({ cities: [] })).toBeNull();
  });
});
