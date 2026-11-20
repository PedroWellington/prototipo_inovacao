import { describe, expect, it } from 'vitest';
import { compareRows } from './compareRows.js';

const city = (o) => ({
  name: 'X', uf: 'PE', has_data: true, reference_month: '2026-10', division_kind: 'bairro', neighborhoods: 50,
  population: 1000, area_km2: 10, coverage: { total_active: 100, share: 0.9 },
  income: { available: true, median: 1500, source: { name: 'IBGE, Censo', reference_date: '2022-08-01' } }, ...o,
});
const recife = city({ name: 'Recife', population: 1600, coverage: { total_active: 200, share: 0.95 }, income: { available: true, median: 1750, source: { name: 'IBGE, Censo', reference_date: '2022-08-01' } } });
const maceio = city({ name: 'Maceió' });
const row = (rows, label) => rows.find((r) => r.label === label);

describe('compareRows', () => {
  const rows = compareRows(recife, maceio);

  it('razão e diferença em linguagem neutra, com o maior marcado', () => {
    const pop = row(rows, 'População');
    expect(pop.text).toBe('Recife tem 1,6x a população de Maceió; diferença de 600 habitantes');
    expect(pop.max).toBe(0);
    expect(row(rows, 'Renda mediana da cidade').text).toBe('Recife tem 1,2x a renda mediana de Maceió; diferença de R$ 250/mês');
    expect(row(rows, 'Cobertura').text).toBe('diferença de 5 pontos percentuais');
    for (const r of rows) expect(r.text).not.toMatch(/melhor|pior|vencedor|recomend/i);
  });

  it('valores calculados levam "calculado a partir de" e a fonte', () => {
    expect(row(rows, 'Densidade').values).toEqual([160, 100]);
    expect(row(rows, 'Densidade').source).toMatch(/^calculado a partir de: .*IBGE/);
    expect(row(rows, 'Cadastros por 1.000 habitantes').values[0]).toBeCloseTo(125);
    expect(row(rows, 'Cadastros por 1.000 habitantes').source).toMatch(/^calculado a partir de: .*Receita Federal.*IBGE/);
    for (const r of rows) expect(r.source).toBeTruthy();
  });

  it('sem dado em uma cidade: "sem dado suficiente" e nenhum destaque', () => {
    const r = compareRows(recife, city({ name: 'Y', has_data: false, income: { available: false } }));
    for (const label of ['Cadastros ativos (CNPJ)', 'Cobertura', 'Renda mediana da cidade']) {
      expect(row(r, label).text).toBe('sem dado suficiente');
      expect(row(r, label).max).toBeNull();
    }
  });

  it('valores iguais não destacam ninguém', () => {
    expect(row(rows, 'Área')).toMatchObject({ text: 'mesmo valor nas duas cidades', max: null });
  });
});
