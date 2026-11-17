# Hero com o mapa real (branch `hero-360`, experimental)

**Estado (2026-11-17):** pronto para avaliação na branch; nada disso está na `main`. **Pendência obrigatória antes de publicar:** provedor de tiles (ver o fim).

## O que é

O hero inteiro é uma linha do tempo só, de 0 a 1, ligada à rolagem: do Brasil ao bairro e ao holograma, com o mesmo motor do explorador.

- **Mapa:** MapLibre com os tiles do OpenStreetMap e o estilo do explorador (`frontend/src/map/mapView.js`); malhas do IBGE que a landing já baixa (`landing/data/brasil-1.json`, `pe-2.json`, `recife-2.json`) como camadas: estados, Nordeste, Pernambuco, municípios, Recife, bairros.
- **Holograma:** o mesmo componente (`frontend/src/map/hologram.js`), o mesmo manifesto (`frontend/public/holograma/manifest.json`) e a mesma arte (`design/holograma-360/`). Gira pelo tempo (período de 12 s do manifesto); entra no fim por opacidade e transform, acompanhando a inclinação. No celular baixa 1 a cada 3 quadros (120).
- **Bairros:** cores decorativas, as mesmas da landing ("só para distinguir vizinhos; não é nota"); Boa Viagem em cobre, como ponto ilustrativo (não é recomendação). Sem números de posição: a landing não mostra classificação pública.
- **Textos:** os capítulos, botões, cabeçalho, linha de progresso e demais seções não mudaram. Os textos acompanham a linha do tempo por opacidade; não comandam a câmera.
- **Publicação:** o módulo do mapa sai do build do app como `/app/hero/hero.js` (12 KB comprimidos, CSS embutido) e usa o chunk do MapLibre que o explorador já usa. A landing só o pede depois de carregar, no ocioso.

## A câmera: por que havia "reset" entre capítulos e como ficou

Causa do reset (versão anterior desta branch):

1. **Duas câmeras.** Até o capítulo 4, o mapa em canvas seguia a linha do tempo `KF`; no capítulo 5 o MapLibre entrava com enquadramento próprio (`cameraForBounds` dos bairros), 2,3× mais perto. Era o salto "Recife pequeno → grande".
2. **Troca de geometria na hora errada.** No canvas, a camada mãe sumia enquanto a filha ainda era pequena (o Nordeste enchendo a tela sumia e Pernambuco surgia pequeno). A câmera não recomeçava, mas parecia.
3. **Centro com uma proporção por trecho.** Posição contínua, mas a velocidade quebrava nos keyframes (o centro "freava", ex.: p = 0,15).

Como ficou (`landing/js/landing.js`):

- **Uma linha do tempo** (`KF`, keyframes Brasil, Nordeste, Pernambuco, Recife, bairros, bairro inclinado): zoom em escala log com interpolação monotônica (pchip): **só cresce ao descer**; centro numa curva só, suave na linha inteira (pchip em −1/zoom); pitch, bearing e posição do ponto na tela também em curvas suaves. O fim de um capítulo é exatamente o começo do seguinte porque não há trechos: os capítulos são só faixas da mesma curva.
- **O MapLibre não tem câmera própria.** `mapView(p)` converte a câmera da linha do tempo para o MapLibre (Web Mercator nos dois: mesmos pixels por metro, mesmo centro, mesmo ponto na tela) e o módulo do hero só aplica com `jumpTo`, dentro do `requestAnimationFrame` da landing, que suaviza o progresso por aproximação exponencial (τ = 90 ms). Antes de o mapa real ficar pronto, o canvas desenha com a mesma câmera; a passagem é um fade de 450 ms, sem mudança de escala.
- **Troca de geometria só por opacidade** (`alphas(p)`, uma agenda única usada pelo canvas e pelo MapLibre): a camada mãe fica como contexto até a filha ocupar a tela. Camada com opacidade zero vira `visibility: none` (o MapLibre não a recorta nem desenha).
- **Verificado** por `frontend/perf/hero-360-continuidade.mjs`: zoom monotônico em 2.000 amostras; nenhum degrau entre amostras vizinhas em zoom, centro, pitch, bearing ou posição; nas fronteiras de capítulo, atravessar a fronteira muda o mesmo que um trecho igual ao lado (razão 1,01); o zoom do mapa real é igual ao da linha do tempo (erro 0). Subir a página percorre a mesma curva ao contrário.

## Desempenho

Referência **60 Hz** (decisão de 2026-11-17): ≥ 55 fps e trabalho por quadro p95 ≤ 16,7 ms, também com CPU 4×. Cumpre em todos os perfis (desktop 4×: 93 fps, 14,9 ms; celular 4×: 100 fps, 12,0 ms). **Em telas de 144 Hz alguns quadros ficam acima de 7 ms** e perdem uma batida: 37 a 41% com CPU 4×, menos de 1% com CPU normal. Tabelas e o que foi otimizado: `docs/PERFORMANCE.md` ("Hero com o mapa real").

- Tiles raster pintados como 512 px só no hero (~4× menos tiles por quadro). O mapa-base, escurecido sob as camadas, fica um pouco menos nítido (os rótulos do OSM aparecem maiores); trocar de volta para 256 px é uma linha em `frontend/src/hero/main.js`, ao custo de ~15% de fps com CPU 4×.
- Pré-carga: antes de assumir, a câmera passa invisível por 14 pontos do caminho (tiles no cache de 1.200 tiles) e os quadros do holograma são baixados.

## Reservas

| Caso | O que aparece |
|---|---|
| `prefers-reduced-motion` | Sem câmera animada: o mapa real parado no enquadramento final, holograma visível e estável, abaixo dos textos (o hero vira a versão simples, sem o container alto). |
| Conexão ruim (economia de dados ou 2G) | Imagem estática do enquadramento final (`landing/assets/hero-final.webp`, 50 KB, captura da própria cena com a atribuição do OSM); o mapa e os tiles não são baixados. |
| Falha ao carregar o mapa (módulo, WebGL, tempo esgotado de 30 s) | O mapa em canvas segue o caminho; no fim, a mesma imagem estática. Nunca fica preto. |
| Sem JavaScript | A imagem estática (`noscript`). |
| Aparelho com poucos núcleos | Recebe o mapa real (decisão de 2026-11-17: não excluir aparelhos de 4 núcleos). |

Testado por `frontend/perf/hero-360-casos.mjs` (11 verificações: movimento reduzido, conexão ruim, falha, sem JS, redimensionar, teclado e leitor de tela). A cena é `aria-hidden`; o link da atribuição e o canvas saem da ordem de tabulação. axe: 0 violações na landing, também no meio do mergulho e no fim (`frontend/perf/a11y.mjs`).

## Como ver e regenerar

- Local: na branch, construir a imagem do frontend e abrir <http://localhost:8080/>. Reserva: `?hero=estatico`.
- Gravações: `docs/visual/hero-360/rolagem-desktop.webm` e `rolagem-celular.webm` (`frontend/perf/hero-360-gravar.mjs`, depois VP8 a 250 kbit/s com o ffmpeg do Playwright).
- Imagem estática: `node frontend/perf/hero-360-imagem.mjs <saida.png>` e converter para WebP (comando no topo do script). Refazer sempre que a câmera do fim mudar.
- Medições: `node frontend/perf/hero-360.mjs`, `node frontend/perf/hero-360-continuidade.mjs`, `node frontend/perf/hero-360-casos.mjs`.

## Pendência obrigatória: provedor de tiles

Os tiles públicos do OpenStreetMap (`tile.openstreetmap.org`) **não servem para produção** (a política de uso deles proíbe uso pesado), e esta cena aumenta bastante o volume: cada visita pré-carrega tiles de 14 pontos do caminho e percorre do zoom 3 ao 14. **Antes de ir ao ar de verdade é preciso contratar um provedor** e trocar a URL dos tiles em `frontend/src/map/mapView.js` (vale para o explorador também). Opções e custos estão no relatório de 2026-11-17 e em `docs/PROGRESSO.md`.
