# Acessibilidade: verificação automática

Rodada de 2026-11-15, com `frontend/perf/a11y.mjs`: axe-core 4.14.0 (regras WCAG 2.0 e 2.1, níveis A e AA, contraste incluído), no Microsoft Edge, em 1440×900 e em celular 390×844.

```powershell
docker compose up -d --build
cd frontend; node perf/a11y.mjs      # cria um usuário descartável; sai com código 1 se houver violação
```

| Tela | Desktop | Celular |
|---|---|---|
| Landing (topo e planos) | 0 | 0 |
| Login e cadastro | 0 | 0 |
| Onboarding | 0 | 0 |
| Visão geral | 0 | 0 |
| Explorador: início, ranking do Recife e detalhes do bairro | 0 | 0 |
| Minha conta e termos | 0 | 0 |

## Rodada de 2026-11-20 (landing inteira)

O script passou a rolar até o fim da landing (perguntas frequentes, "Dados e fontes", bloco final) e a medir o hero com o Nordeste
em destaque. Antes, as seções de baixo ainda estavam com opacidade 0 (reveladas pela rolagem) e o axe não as media. Achou, só no
tema claro: numeração e etiqueta do FAQ (`--muted` e `--copper` sobre o papel, 3,2:1 e 3,7:1), de "Dados e fontes" (sobre areia,
2,6:1 e 4,1:1) e a etiqueta do bloco final (cobre sobre grafite, 3,9:1). Corrigido com `--muted-dark`/`--copper-dark` no papel,
`--muted-ink`/`--copper-deep` na areia e `--copper-soft` no grafite. Resultado: 0 violações nos dois temas, desktop e celular.

## O que foi corrigido para chegar a zero

- **Contraste da paleta.**
  - Texto secundário: `--muted` (#87908e) dá 3,2:1 sobre o papel e não serve para texto claro. Texto secundário usa `--muted-dark` (5,0:1) e, sobre areia, `--muted-ink`.
  - Ações: texto branco sobre `--copper` dá só 3,8:1. Os botões usam `--copper-dark` (5,6:1).
  - Erros: o texto usa `--red-dark` (5,4:1).
- **Landing.** Antes desta etapa, 29 textos pequenos já estavam abaixo de 4,5:1 (rótulos em cobre, notas em cinza, links sobre o fundo areia). Agora usam os tokens AA.
- **Nomes acessíveis.**
  - O logo tinha `aria-label="Início"`, sem o texto visível ("VICUS"): o rótulo foi retirado, e o nome passou a ser o próprio texto.
  - "Minha conta" e "Visão geral" ficavam sem nome no celular (texto com `display: none`). Agora esse texto só some da tela (`.sr-only-sm`).
  - No login e no cadastro em desktop havia um link de logo vazio na tabulação. Agora ele fica escondido por inteiro.

## Cor nunca é o único canal

- **Escala do mapa.** A escala vai de sage escuro (combina mais) a rosado claro (combina menos), com luminosidade sempre decrescente: OKLab L 0,50 / 0,61 / 0,72 / 0,81 / 0,91. Mesmo sem distinguir as cores, a ordem se lê pelo claro e escuro.
- **Número em cada área.** Cada área tem o número da posição. O tooltip e o ranking também mostram posição e nota.
- **Captura.** O Recife com a escala nova está em `docs/visual/fase3-desktop-recife.webp`.

O que a verificação automática não cobre: leitor de tela real (NVDA, VoiceOver) e navegação só por teclado do começo ao fim. Ficam como próximos passos.
