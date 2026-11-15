# Landing: fluidez medida

Medição de 2026-11-14. "Antes" = `VICUS-Recife-Edicao-Urbana.html` (arquivo único original). "Depois" = `index.html`.

## Método

- `npm run serve` (servidor estático com gzip) e `npm run perf` (`perf/measure.mjs`), com o Microsoft Edge instalado via playwright-core, **com janela** (sem headless).
- Tela do computador de medição: **144 Hz** (um quadro = 6,9 ms). Ainda não testamos numa tela de 60 Hz nem num celular de verdade (ver "O que falta").
- Rolagem de usuário simulada: roda do mouse com 120 px a cada 40 ms do início ao fim da história e **de volta ao topo** (scroll reverso incluído).
- Três cenários:
  - desktop 1440×900;
  - o mesmo com **CPU 4× mais lenta** (CDP `Emulation.setCPUThrottlingRate`);
  - celular emulado (390×844, DPR 3, toque) com CPU 4×.
- Métricas, todas colhidas na página por um script injetado antes do código dela:
  - **Intervalo entre quadros:** diferença entre timestamps de rAF; inclui GPU e compositor.
  - **Trabalho da thread principal por quadro:** do início do rAF até o fim da tarefa de renderização (rAF + estilo + layout + pintura). Mede-se com uma mensagem postada no rAF, que só roda depois dessa tarefa.
  - **JS por quadro:** duração dos callbacks de rAF.
  - **Tarefas longas** (`longtask`), **LCP** e **CLS**.
  - **Quadros acima de 50 ms**, com a posição do scroll (`over_50ms_at`).
- **Linha de base do ambiente:** `perf/baseline.html`, uma página vazia com a mesma rolagem. Deu 7,0 ms constantes (144 fps), sem nenhum quadro lento. Tudo acima disso é custo da página.

## Resultados

| Cenário | Métrica | Antes | Depois | Meta |
|---|---|---|---|---|
| Desktop | Thread principal por quadro, p95 / máx. | 3,6 / 5,5 ms | **1,5 / 2,5 ms** | p95 ≤ 12 ms ✅ |
| Desktop | JS por quadro, p95 / máx. | 2,3 / 3,6 ms | **0,4 / 0,8 ms** | ≤ 4 ms ✅ |
| Desktop | Intervalo entre quadros, p50 / p95 / máx. | 7,0 / 27,7 / 90,2 ms | **7,0 / 20,8 / 41,7 ms** | p95 ≤ 12 ms ❌ (ver abaixo) |
| Desktop | Quadros > 50 ms | 1 | **0** | 0 ✅ |
| Desktop | fps médio na rolagem | 79 | **95** | — |
| Desktop CPU 4× | Thread principal por quadro, p95 / máx. | 20,4 / 30,8 ms | **6,4 / 10,1 ms** | — |
| Desktop CPU 4× | JS por quadro, p95 / máx. | 13,3 / 24,1 ms | **2,0 / 3,9 ms** | ≤ 4 ms ✅ |
| Desktop CPU 4× | fps médio na rolagem | 48,5 | **83,5** | ≥ 55 ✅ |
| Desktop CPU 4× | Quadros > 50 ms | 2 | **0** | 0 ✅ |
| Celular CPU 4× | Thread principal por quadro, p95 / máx. | 19,2 / 32,5 ms | **6,6 / 12,5 ms** | — |
| Celular CPU 4× | JS por quadro, p95 / máx. | 13,1 / 25,7 ms | **2,0 / 4,9 ms** | ≤ 4 ms: p95 ✅, máx. ❌ (um quadro) |
| Celular CPU 4× | fps médio na rolagem | 56,5 | **100,6** | ≥ 55 ✅ |
| Celular CPU 4× | Quadros > 50 ms | 2 | **0** | 0 ✅ |
| Todos | Tarefas longas durante a animação | 0 | **0** | 0 ✅ |
| Todos | LCP | 188–380 ms | **160–400 ms** | < 2,5 s ✅ (localhost, sem limitar a rede) |
| Todos | CLS | 0,0009 | **0,0006** | ≈ 0 ✅ |

Resultados brutos: `perf/results/*.json` (fora do Git; gere de novo com os comandos do README).

**Intervalo p95 de 20,8 ms.** Numa tela de 144 Hz, 20,8 ms são 3 vsyncs. Ou seja, em 5% dos quadros o GPU/compositor não entregou dentro de 6,9 ms. O tempo da thread principal está bem abaixo da meta, e a CPU 4× não muda a mediana, então o custo está na rasterização e na composição.
- Testamos desligar, um de cada vez: blur do fundo (`backdrop-filter`), capítulos, camadas da loja, fundos estáticos e o próprio canvas. Nenhum explica sozinho; cada um soma um pouco.
- Numa tela de 60 Hz (16,7 ms por quadro) esse custo cabe no orçamento. Mas isso é dedução, ainda não medição.

## Depois da integração com o app (nginx: landing em `/`, app em `/app/`)

Mesmo método e mesmo dia (2026-11-14), depois de reiniciar a máquina.
- **Antes:** código commitado antes da integração (`881e53c`), no servidor estático `npm run serve`.
- **Depois:** código integrado no nginx do `docker compose`, com estes acréscimos: menu com item ativo, seção de planos, fonte Inter local e consulta de sessão quando o navegador fica ocioso.
- **Linha de base do ambiente** (`perf/baseline.html`): 6,9 ms constantes e nenhum quadro acima de 50 ms. O ambiente estava limpo.

| Cenário | Métrica | Antes | Depois |
|---|---|---|---|
| Desktop | Thread principal por quadro, p95 / máx. | 1,5 / 2,6 ms | 1,6 / 2,4 ms |
| Desktop | JS por quadro, p95 / máx. | 0,5 / 0,9 ms | 0,5 / 0,9 ms |
| Desktop | Intervalo entre quadros, p95 / máx. | 20,8 / 41,7 ms | 20,9 / 41,8 ms |
| Desktop | Quadros > 50 ms | 0 | **0** |
| Desktop CPU 4× | Thread principal por quadro, p95 / máx. | 7,3 / 11,0 ms | 7,0 / 9,9 ms |
| Desktop CPU 4× | fps médio / quadros > 50 ms | 81,2 / 0 | 83,2 / **0** |
| Celular CPU 4× | Thread principal por quadro, p95 / máx. | 8,2 / 13,8 ms | 7,6 / 11,6 ms |
| Celular CPU 4× | JS por quadro, p95 / máx. | 2,3 / 5,8 ms | 2,2 / 4,0 ms |
| Celular CPU 4× | Quadros > 50 ms (3 rodadas de cada) | 0, 4, 5 | 1, 4, 3 |
| Todos | Tarefas longas | 0 | 0 |
| Todos | LCP | 160–476 ms | 236–456 ms |
| Todos | CLS | 0,0004 | 0,0005 |

- **O nginx não mudou a fluidez.** Os arquivos chegam com gzip e `Cache-Control: no-cache`, revalidados por ETag, com resposta 304 quando não mudaram. Imagens e fonte ficam 1 dia em cache, e os arquivos do app com hash ficam 1 ano. O LCP continua abaixo de 0,5 s em localhost.
- **Uma regressão foi achada e corrigida durante a medição.** A correção do texto borrado tinha tirado o `will-change` dos capítulos. Sem ele, o navegador criava e desfazia a camada de cada capítulo a cada troca. Isso gerou de 2 a 3 quadros acima de 50 ms no desktop, exatamente nas fronteiras dos capítulos (p ≈ 0,14, 0,28 e 0,42). Com `will-change: opacity, transform` de volta, o desktop voltou a 0, e a nitidez do texto não mudou (ver `TEXTO-NITIDO.md`).
- **O celular emulado varia de uma rodada para outra:** de 0 a 5 quadros acima de 50 ms tanto no código antigo quanto no novo. É ruído da GPU emulada, não diferença de código. A medição num aparelho real continua pendente ("O que falta").

## Depois da paleta única (2026-11-15)

Agora as cores da landing (CSS, logo e polígonos do canvas) vêm de `shared/design-tokens.css`. A composição e a animação são as mesmas. Medição no nginx (`BASE=http://localhost:8080`), duas rodadas:

| Cenário | Thread principal p95 / máx. | JS p95 / máx. | Quadro p95 / máx. | fps médio | Quadros > 50 ms | LCP / CLS |
|---|---|---|---|---|---|---|
| Desktop | 1,7–1,8 / 2,9–3,6 ms | 0,5–0,6 / 0,9–1,2 ms | 20,9 / 48,5–48,6 ms | 91–95 | 0 / 0 | 512–540 ms / 0,0005 |
| Desktop CPU 4× | 6,6 / 10,3–10,7 ms | 1,9 / 3,4–4,4 ms | 20,9 / 34,8–41,7 ms | 85–87 | 0 / 0 | 264–268 ms / 0,0005 |
| Celular CPU 4× | 7,2–7,5 / 10,4–11,6 ms | 1,9 / 3,1–4,3 ms | 27,8 / 41,8–62,5 ms | 78 | 1 / 0 | 248–252 ms / 0 |

Os números são os mesmos da integração (acima): ler as cores dos tokens uma vez, no início, não custa nada por quadro. Tarefas longas: 0.

## O que mudou e quanto pesou

1. **Geometria pré-processada** (`scripts/build-geo.mjs`): Web Mercator e LOD por zoom já vêm prontos. O navegador decodifica cada arquivo **uma vez** em `Path2D`. A câmera é só `ctx.setTransform`: **nenhum vértice é reprojetado por quadro**. Isso tirou ~85% do JS por quadro (p95 de 13 para 2 ms com CPU 4×).
2. **Sem `shadowBlur` por polígono.**
   - A sombra é uma cópia deslocada e translúcida da camada inteira.
   - O volume são duas cópias deslocadas, em vez de um quadrilátero por aresta.
   - **Medido:** o "brilho" com dois traços largos (10 e 4 px, cantos arredondados) causava **todos** os quadros acima de 50 ms, em p ≈ 0,28–0,33, onde o Nordeste e Pernambuco se cruzam. Trocado por um traço de 3 px, só no contorno do elemento em destaque: 12 → 0 quadros acima de 50 ms.
3. **LOD:** usa o nível mais leve cuja tolerância fica abaixo de 1,5 pixel físico (2 ou 3 níveis por camada). Também há culling por caixa envolvente, que pula o que está fora da tela ou é menor que um pixel.
4. **Scroll:**
   - Sem `getBoundingClientRect` no evento de scroll: posição e altura da história ficam em cache e são recalculadas só no `resize`.
   - Sem `scroll-behavior: smooth`, que somava uma segunda suavização à do JS.
   - Suavização exponencial `1 − e^(−dt/90 ms)`: a mesma sensação a 60, 120 ou 144 Hz.
5. **Loja:**
   - Antes, uma máscara radial era repintada a cada quadro.
   - Agora é um círculo com máscara **fixa**, só escalado por `transform`, com a imagem compensando a escala: compositor apenas.
   - A imagem saiu do HTML (base64 de 540 KB) para `assets/`, em WebP e JPG nos tamanhos 960, 1280 e 1672.
6. **DOM:** cada propriedade só é escrita quando o valor muda. As etiquetas do mapa mudaram de `left/top` para `transform`, e a barra de progresso de `width` para `scaleX`. O loop roda só enquanto a câmera se move e para fora da tela (`IntersectionObserver`).
7. **Qualidade adaptativa:** se o desenho passar de 8 ms em média por mais de 20 quadros, a densidade de pixels cai 0,25 por vez, até 1. O DPR máximo é 2 no desktop e 1,5 no celular.
8. **Carregamento por prioridade:** primeiro o nível leve de Brasil, PE e Recife; depois os finos, na mesma ordem, um arquivo por vez. Medido: nenhuma tarefa longa.

| Arquivo | Antes (gzip) | Depois (gzip) |
|---|---|---|
| HTML (antes com CSS, JS e imagem embutidos) | 436 KB | 4,6 KB |
| CSS + JS | (no HTML) | 18,5 KB (+ 6,5 KB de fallback, só se um arquivo falhar) |
| Dados geográficos | rede externa (CDN), bairros nunca carregavam | 265 KB no total; o primeiro desenho real precisa de só 39 KB |
| Imagem da loja | 540 KB (base64, sempre) | 124–289 KB conforme a tela, baixada com prioridade baixa |

## Por que não migramos para WebGL

As metas da thread principal, de JS, de fps com CPU 4× e de "nenhum quadro acima de 50 ms" foram atingidas com Canvas 2D. A única meta em aberto é o intervalo p95 numa tela de 144 Hz. Ela não foi isolada num ponto que o WebGL resolveria sozinho, porque parte do custo está nas camadas de DOM (textos, loja, fundos).

Se os testes num celular de verdade mostrarem quadros perdidos, o próximo passo é migrar o mapa para MapLibre GL (estilo vazio, `jumpTo` por quadro e `fill-extrusion`), como previsto no pedido.

## O que falta

- Medir numa tela de 60 Hz e num celular de verdade (Android de entrada e iPhone). A emulação não reproduz o GPU do aparelho.
- LCP com a rede limitada (4G lento), de preferência já no servidor definitivo.
