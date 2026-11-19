# Design system: tema escuro "azul" (teste)

Branch `teste/tema-escuro-azul`. Só o tema escuro muda; o claro é o mesmo da `main` (capturas em
`docs/visual/tema-escuro-azul/claro-*`, comparadas pixel a pixel).

## Onde fica

| Arquivo | O que tem |
|---|---|
| `shared/design-tokens.css` | As três cores-base, os tons derivados (hex calculados, fórmula ao lado) e os papéis do escuro (`--bg`, `--surface`, `--accent`…). Vale para o app e para a landing. |
| `frontend/src/styles/tokens.css` | Tokens por função no escuro (`--color-*`, `--score-*`, `--mini-*`) e o token novo `--color-primary` (no claro aponta para o mesmo cobre de antes). |
| `frontend/src/styles/theme-dark.css` | A linguagem visual do escuro: vidro, pílulas, brilho do botão primário, palavra em destaque. Tudo sob `:root[data-theme='dark']`. |
| `landing/css/landing.css` | Remapeamento escuro da landing (herói e seções), no fim do bloco "Tema escuro". |

Os derivados são hex literais, não `color-mix()`, porque o mapa (MapLibre) e o canvas da landing leem os tokens com
`getComputedStyle` e só entendem cores prontas. A fórmula equivalente está no comentário de cada um.

## Cores-base

| Token | Valor | Papel |
|---|---|---|
| `--egyptian-blue` | `#03203d` | fundo principal |
| `--stone-blue` | `#639cc5` | destaque: foco, seleção, mapa, ícones ativos, palavra em destaque nos títulos grandes |
| `--scarlet` | `#e32f33` | ação principal e alertas; **nunca** texto pequeno sobre o fundo |

## Derivados (só destas três, de branco e de preto)

| Token | Valor | Fórmula | Uso |
|---|---|---|---|
| `--blue-deep` | `#021930` | egyptian 78% + preto | topo do app, fundo dos mapinhas |
| `--blue-surface` | `#103150` | egyptian 86% + stone | cartões (no vidro, a 72% de opacidade) |
| `--blue-surface-2` | `#163958` | egyptian 80% + stone | hover |
| `--blue-surface-3` | `#1e4363` | egyptian 72% + stone | painéis internos |
| `--blue-line` | `#244a6b` | egyptian 66% + stone | bordas finas |
| `--blue-line-strong` | `#5083aa` | egyptian 20% + stone | borda de campos e botões secundários |
| `--blue-soft` | `#1c4060` | egyptian 74% + stone | fundo de destaque suave |
| `--stone-light` | `#8cb6d4` | stone 74% + branco | texto em destaque e links |
| `--stone-lighter` | `#b9d2e5` | stone 45% + branco | texto secundário |
| `--snow` | `#f6f9fc` | branco 94% + stone | texto principal |
| `--scarlet-btn` | `#c8292d` | scarlet 88% + preto | preenchimento do botão primário |
| `--scarlet-btn-hover` | `#b62629` | scarlet 80% + preto | hover do botão primário |
| `--scarlet-light` | `#f08d8f` | scarlet 55% + branco | texto de erro |
| `--scarlet-deep` | `#3b0c0d` | scarlet 26% + preto | fundo de alerta |
| `--score-none` … `--score-5` | `#0d2c4b` → `#b1cee2` | egyptian → stone → branco | escala do mapa (o número da posição vai sempre junto) |

## Contrastes medidos (WCAG 2.1)

| Primeiro plano | Fundo | Razão | Uso |
|---|---|---|---|
| Branco | Egyptian Blue (fundo) | 16,43:1 | texto |
| Stone Blue | Egyptian Blue (fundo) | 5,55:1 | destaque, foco, palavra em destaque (texto grande) |
| Stone Blue | superfície `#103150` | 4,50:1 | anel de foco e gráficos (≥ 3:1) |
| Scarlet | Egyptian Blue (fundo) | 3,69:1 | só ponto, ícone ou borda; nunca texto pequeno |
| Branco | Scarlet `#e32f33` | 4,45:1 | **não usado**: abaixo de 4,5:1 |
| Branco | `--scarlet-btn` `#c8292d` | 5,51:1 | texto do botão primário |
| Branco | `--scarlet-btn-hover` `#b62629` | 6,37:1 | texto do botão primário (hover) |
| `--snow` | superfície | 12,60:1 | texto principal |
| `--stone-lighter` | superfície | 8,50:1 | texto secundário |
| `--stone-lighter` | `--blue-surface-3` | 6,58:1 | texto secundário em painel interno |
| `--stone-light` | superfície | 6,19:1 | links e destaque |
| `--stone-light` | Egyptian Blue (fundo) | 7,64:1 | links e destaque |
| Egyptian Blue | `--stone-light` | 7,64:1 | texto sobre item ativo (pílula do menu, chip marcado) |
| `--scarlet-light` | superfície | 5,65:1 | texto de erro |
| `--blue-line-strong` | superfície | 3,28:1 | borda de campo (≥ 3:1) |
| `--stone-lighter` | `--blue-deep` | 11,33:1 | limites internos do mapinha |
| `--snow` | superfície | 12,60:1 | contorno da cidade no mapinha |

Decisão do botão: o Scarlet puro dá 4,45:1 com branco, então o **preenchimento** do botão usa `--scarlet-btn`
(o mesmo vermelho com 12% de preto), 5,51:1. O Scarlet puro fica no brilho do botão e em pontos e etiquetas que
sempre têm texto ou ícone junto (nenhuma informação só por cor).

## Linguagem visual (só no escuro)

- Fundo Egyptian Blue com um brilho suave de Stone Blue no topo.
- Cartões de vidro: `--color-glass` (superfície a 72%), desfoque de 14 px e borda fina `--color-glass-line`; cantos de 24 px.
- Botões, campos, chips e itens do menu em pílula; botão primário vermelho com brilho (`--color-glow`).
- Títulos: a parte que já vinha marcada (`<em>` na landing, `<span>` no app) fica em Stone Blue.
- Etiquetas pequenas em maiúsculas com espaçamento (as que já existiam), em `--stone-light`.
- Os painéis laterais do explorador ficam opacos: vidro por cima do mapa vivo custaria pintura a cada quadro.

## Verificação (2026-11-19)

- Tema claro: capturas antes e depois comparadas pixel a pixel (`frontend/perf/tema-azul.mjs`). 10 de 16 idênticas;
  nas outras, menos de 0,25% dos pixels mudam, só em conteúdo que se move sozinho (horário "Atualizado em", barra de
  progresso da rolagem, animação do herói e tiles do mapa).
- axe (WCAG 2.0/2.1 A e AA): 0 violações em `perf/a11y.mjs` (108 telas, dois temas, desktop e celular),
  `perf/comparar.mjs` (Comparar com duas cidades e o "Lado a lado") e `perf/assistente-campo.mjs`.
- Ficou de fora: o vídeo da landing (`landing/video/`) tem as cores desenhadas na própria ilustração e continua na
  paleta quente; o holograma do explorador é uma sequência de imagens e só o brilho em volta segue `--color-holo`.
