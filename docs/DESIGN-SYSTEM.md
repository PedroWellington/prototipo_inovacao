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
| `--egyptian-blue` | `#03203d` | superfície dos cartões e realce (desde a 2ª rodada não é mais o fundo da página) |
| `--stone-blue` | `#639cc5` | destaque: foco, seleção, mapa, ícones ativos, palavra em destaque nos títulos grandes |
| `--scarlet` | `#e32f33` | ação principal e alertas; **nunca** texto pequeno sobre o fundo |

## Derivados (só destas três, de branco e de preto)

| Token | Valor | Fórmula | Uso |
|---|---|---|---|
| `--blue-night` | `#02101e` | egyptian 50% + preto | **fundo da página** |
| `--blue-deep` | `#010c16` | egyptian 36% + preto | topo do app |
| `--blue-surface` | `#103150` | egyptian 86% + stone | hover (`--color-surface-2`) |
| `--blue-surface-2` | `#163958` | egyptian 80% + stone | painéis internos (`--color-surface-3`) |
| `--blue-surface-3` | `#1e4363` | egyptian 72% + stone | reserva |
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
| `--score-none` … `--score-5` | `#0b2a48` → `#5e94bb` | egyptian → stone (o último com 5% de preto) | escala do mapa; para antes do Stone Blue puro para o limite claro ter ≥ 3:1 em todos os tons; o número da posição vai sempre junto |
| `--mini-fill` | `#3d6a8f` | egyptian 40% + stone | preenchimento dos mapinhas |
| `--map-frame`, `--map-edge`, `--mini-edge` | `#000000` | preto | moldura dos mapas e contorno externo da cidade |
| `--map-line`, `--mini-line` | `--snow` | — | limites internos dos bairros (sempre claros) |

## Contrastes medidos (WCAG 2.1, valores finais da 2ª rodada)

Fundo da página `--blue-night` `#02101e`; superfície dos cartões Egyptian Blue `#03203d`.

| Primeiro plano | Fundo | Razão | Uso |
|---|---|---|---|
| Branco | fundo | 19,17:1 | texto |
| Branco | superfície | 16,43:1 | texto |
| `--snow` | superfície | 15,55:1 | texto principal |
| `--stone-lighter` | superfície | 10,50:1 | texto secundário |
| `--stone-lighter` | `--blue-surface-2` (painel interno) | 7,62:1 | texto secundário |
| `--stone-light` | superfície | 7,64:1 | links e destaque |
| `--stone-light` | fundo | 8,91:1 | links e destaque |
| `--blue-night` | `--stone-light` | 8,91:1 | texto sobre item ativo (pílula do menu, chip marcado) |
| Stone Blue | fundo | 6,47:1 | palavra em destaque (texto grande) |
| Stone Blue | superfície | 5,55:1 | anel de foco e gráficos (≥ 3:1) |
| Scarlet | fundo | 4,31:1 | só ponto, ícone ou borda; nunca texto pequeno |
| Scarlet | superfície | 3,69:1 | idem |
| Branco | Scarlet `#e32f33` | 4,45:1 | **não usado**: abaixo de 4,5:1 |
| Branco | `--scarlet-btn` `#c8292d` | 5,51:1 | texto do botão primário |
| Branco | `--scarlet-btn-hover` `#b62629` | 6,37:1 | texto do botão primário (hover) |
| `--scarlet-light` | superfície | 6,97:1 | texto de erro |
| `--blue-line-strong` | superfície | 4,04:1 | borda de campo (≥ 3:1) |
| Egyptian Blue (cartão) | fundo | 1,17:1 | o cartão se separa do fundo pela borda fina clara e pelo vidro, não pela cor |
| `--snow` (limite interno) | `--score-5` `#5e94bb`, o tom mais claro | 3,09:1 | limites do explorador (≥ 3:1 em todos os tons) |
| `--snow` (limite interno) | `--score-none` `#0b2a48`, o mais escuro | 13,81:1 | limites do explorador |
| `--snow` (limite interno) | `--mini-fill` `#3d6a8f` | 5,44:1 | limites dos mapinhas |
| Preto (contorno) | `--mini-fill` | 3,66:1 | contorno da cidade nos mapinhas (≥ 3:1) |
| Preto (contorno) | `--score-4` `#5083aa` | 5,17:1 | contorno no explorador, tons claros |
| Preto (contorno) | `--score-1` `#183b5b` | 1,82:1 | contorno no explorador junto de bairros de nota baixa: **abaixo de 3:1** (ver nota) |

Nota do contorno no explorador: a escala vai do escuro ao claro, então nenhum contorno preto tem 3:1 contra os tons
mais escuros. Nesses trechos a forma da cidade continua clara pelos limites internos (`--snow`, ≥ 3:1 em todos os
tons) e pelo número de cada área; o contorno preto é reforço, não o único sinal.

### Mapa do Brasil na abertura da landing (2026-11-20, os dois temas)

A página abre com o Brasil numa cor só (todos os estados com o mesmo preenchimento); o Nordeste só ganha destaque
quando a rolagem entra no trecho que leva a ele (p ≥ 0,09 da linha do tempo do hero), numa transição de 0,6 s, e
volta a uma cor só ao subir. Movimento reduzido: troca sem animação. Cores em `landing/js/landing.js` (`C.ufs`,
`C.ufBorder`, `C.nordeste`, `C.nordesteBorder`); no mapa real (`frontend/src/hero/main.js`) Brasil e Nordeste são
opacos e as divisas têm 1,5 px. Medido nos pixels de capturas a 1440 × 900 (valor mais baixo de cada caso, com o antisserrilhado das diagonais):

| Caso | Claro (canvas · mapa real) | Escuro (canvas · mapa real) |
|---|---|---|
| Divisa clara x estado (Brasil numa cor) | 3,80 · 3,42 | 3,56 · 3,25 |
| Nordeste em destaque x demais estados | 3,50 · 3,49 | 3,64 · 3,64 |
| Divisa escura do Nordeste x Nordeste | 5,63 · 6,34 | 6,71 · 7,69 |

Decisão do botão: o Scarlet puro dá 4,45:1 com branco, então o **preenchimento** do botão usa `--scarlet-btn`
(o mesmo vermelho com 12% de preto), 5,51:1. O Scarlet puro fica no brilho do botão e em pontos e etiquetas que
sempre têm texto ou ícone junto (nenhuma informação só por cor).

## Linguagem visual (só no escuro)

- Fundo `--blue-night` (Egyptian Blue com 50% de preto) com um brilho suave de Stone Blue no topo; cartões um degrau acima, em Egyptian Blue.
- Cartões de vidro: `--color-glass` (Egyptian Blue a 82%), desfoque de 14 px e borda fina `--color-glass-line` (24%); cantos de 24 px.
- Botões, campos, chips e itens do menu em pílula; botão primário vermelho com brilho (`--color-glow`).
- Títulos: a parte que já vinha marcada (`<em>` na landing, `<span>` no app) fica em Stone Blue.
- Etiquetas pequenas em maiúsculas com espaçamento (as que já existiam), em `--stone-light`.
- Os painéis laterais do explorador ficam opacos: vidro por cima do mapa vivo custaria pintura a cada quadro.
- **Mapas com moldura preta:** borda preta (`--map-frame`, 5 px no explorador, 4 px nos mapinhas e na prévia da landing)
  e sombra interna até o preto (56 px no explorador, 28 a 48 px nos demais). A moldura fica abaixo de controles,
  legenda, breadcrumb e painéis (z-index 1) e só escurece as beiradas. Contorno externo da cidade em preto, mais grosso
  que os limites internos (5 px por baixo dos bairros no explorador; 4,4 unidades nos mapinhas), limites internos em
  `--snow`. No mapinha do detalhe, o bairro em destaque fica em `--snow` com contorno preto.
- O PDF e os slides impressos não têm tema escuro (são sempre claros); os slides na tela usam o mesmo mapinha.

## Verificação (2026-11-19)

- Tema claro: capturas antes e depois comparadas pixel a pixel (`frontend/perf/tema-azul.mjs`). 10 de 16 idênticas;
  nas outras, menos de 0,25% dos pixels mudam, só em conteúdo que se move sozinho (horário "Atualizado em", barra de
  progresso da rolagem, animação do herói e tiles do mapa).
- axe (WCAG 2.0/2.1 A e AA): 0 violações em `perf/a11y.mjs` (108 telas, dois temas, desktop e celular),
  `perf/comparar.mjs` (Comparar com duas cidades e o "Lado a lado") e `perf/assistente-campo.mjs`.
- Ficou de fora: o vídeo da landing (`landing/video/`) tem as cores desenhadas na própria ilustração e continua na
  paleta quente; o holograma do explorador é uma sequência de imagens e só o brilho em volta segue `--color-holo`.

## Verificação da 2ª rodada (fundo mais escuro e moldura preta, 2026-11-19)

- Tema claro: 13 de 16 capturas idênticas pixel a pixel (incluindo o explorador, onde entrou a camada `hoods-edge`,
  transparente no claro); as outras 3 diferem só no horário "Atualizado em" e na barra de progresso da rolagem.
- axe: 0 violações em `perf/a11y.mjs` (108 telas), `perf/comparar.mjs` e `perf/assistente-campo.mjs`, dois temas,
  desktop e celular. Capturas `r2-*` em `docs/visual/tema-escuro-azul/`.
