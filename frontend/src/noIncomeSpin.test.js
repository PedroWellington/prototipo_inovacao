// Renda: só o dado (valor, fonte e data). Falha se alguma frase que interpreta a renda voltar ao repositório:
// frontend, landing, backend (telas, PDF, slides, prompt do assistente) e docs. Mesma lista em backend/app/assistant.py.
// Linhas que só enunciam a regra ("nada de", "nunca", "proibid") ficam de fora.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SPIN = /poder (de compra|aquisitivo)|dispost[oa]s? a pagar|consumidores com (essa|esta|a) renda|perfil de consumo|perfil compat[ií]vel|oferta premium|capacidade de (compra|consumo)/i;
const RULE = /nada de|nunca|proibid|const SPIN|^\s*r"/i;
const ROOT = join(import.meta.dirname, '..', '..');
const DIRS = ['frontend/src', 'frontend/public', 'frontend/index.html', 'landing/index.html', 'landing/js', 'landing/video', 'backend/app', 'docs', 'api', 'CLAUDE.md', 'README.md'];
const EXT = /\.(js|mjs|html|css|py|md|json|csv)$/;

function* files(p) {
  let st;
  try { st = statSync(p); } catch { return; }
  if (st.isFile()) { if (EXT.test(p)) yield p; return; }
  for (const f of readdirSync(p)) if (f !== 'node_modules' && f !== 'fonts' && f !== 'noIncomeSpin.test.js') yield* files(join(p, f));
}

describe('renda sem interpretação', () => {
  it('a lista pega as expressões proibidas', () => {
    for (const t of ['poder de compra', 'dispostas a pagar', 'consumidores com essa renda', 'perfil de consumo', 'Perfil compatível com oferta premium']) expect(t).toMatch(SPIN);
    expect('Renda mediana: R$ 1.500/mês').not.toMatch(SPIN);
  });

  it('nenhum arquivo do repositório interpreta a renda', () => {
    const hits = [];
    for (const d of DIRS) for (const f of files(join(ROOT, d)))
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (SPIN.test(line) && !RULE.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}`); });
    expect(hits).toEqual([]);
  });
});
