# Hero com o mapa real (branch `hero-360`, experimental)

**Estado (2026-11-17):** funcionando com CPU normal; **com CPU 4× mais lenta não bate a meta de p95 ≤ 12 ms** (ver "Custo" abaixo). Parado à espera de decisão; nada disso está na `main`.

## O que é

Nos capítulos 5 a 8 do hero (progresso 0,57 a 0,95), o mesmo motor do explorador assume o palco: MapLibre com os tiles do OpenStreetMap e o estilo do mapa (`frontend/src/map/mapView.js`), os bairros reais do IBGE (os mesmos arquivos que a landing já baixa, `landing/data/recife-2.json`) e o mesmo holograma (`frontend/src/map/hologram.js`, mesmo manifesto `frontend/public/holograma/manifest.json`, mesma arte de `design/holograma-360/`). Os capítulos 1 a 4 (Brasil, regiões, estados, cidade) continuam com o mapa em canvas de antes; o texto, os botões, o cabeçalho, a linha de progresso e as demais seções não mudaram.

- **Câmera** (`frontend/src/hero/main.js`): `q` = progresso da cena (0 a 1). Zoom da cidade inteira até 13,7 (celular 13,3); centro andando até Boa Viagem (o ponto ilustrativo que a landing já usava, não uma recomendação) com compensação pelo zoom, para o ponto não escorregar na tela; pitch 0 → 58° (celular 48°) de `q` 0,2 a 1; bearing 0 → −18° de 0,3 a 1; holograma `rise` 0 → 1 de 0,68 a 0,95 (a entrada do próprio explorador: opacidade e transform). Tudo com `jumpTo`, chamado no `requestAnimationFrame` da landing, que já suaviza o progresso por aproximação exponencial (τ = 90 ms). Subir a página desfaz na ordem inversa.
- **Holograma:** gira pelo tempo (período do manifesto, 12 s). No celular baixa 1 a cada 3 quadros (120 de 360; opção `stride` do componente, que desenha o mais próximo disponível).
- **Bairros:** cores decorativas, as mesmas da landing ("só para distinguir vizinhos; não é nota"); Boa Viagem em cobre. Sem números de posição: a landing não mostra classificação pública. Mostrar um ranking real com critérios de exemplo é uma decisão em aberto.
- **Pré-carga:** o módulo do mapa (`/app/hero/hero.js`, 12 KB comprimidos, mais o chunk do MapLibre que o explorador já usa) só é pedido depois que a landing carregou, no ocioso. Antes de a cena aparecer, a câmera passa invisível por 7 pontos do caminho para os tiles entrarem no cache (800 tiles), e os quadros do holograma são baixados. A camada só fica visível quando está pronta; até lá, o mapa em canvas continua.
- **Reserva:** aparelho fraco (≤ 2 GB ou ≤ 2 núcleos), economia de dados/2G, sem WebGL, falha ou tempo esgotado (25 s): imagem estática do enquadramento final (`landing/assets/hero-final.webp`, 47 KB, captura da própria cena por `frontend/perf/hero-360-imagem.mjs`, com a atribuição do OSM). Sem JavaScript: a mesma imagem (`noscript`). Movimento reduzido: o mapa real parado no enquadramento final, holograma no quadro fixo do manifesto, abaixo dos textos.
- **Mudança no motor do explorador:** `baseStyle(el)` e `themePaints(el)` leem tokens e tema de um elemento (padrão `<html>`, o explorador não mudou); o hero passa o próprio palco (`data-theme="dark"`, tokens em `frontend/src/hero/hero.css`).

## Custo (por que não bate com CPU 4×)

Medido com `frontend/perf/hero-360.mjs` (janela visível, roda do mouse, trecho só do mapa) e um perfil de CPU (CDP Profiler) da rolagem com CPU 4×: 67% do tempo é trabalho nativo de desenho (WebGL e composição), 29% é JavaScript do MapLibre, 3% da landing, 1% do holograma, ~0% do módulo do hero. Dentro do MapLibre, o custo é por tile na tela (cálculo de matrizes, cobertura de tiles, chamadas de desenho), e a inclinação enche o horizonte de tiles.

- Já aplicado: tiles raster pintados como 512 px (~4× menos tiles por quadro): desktop 4× de 87 para 103 fps e trabalho p95 de 13,8 para ~11 ms.
- Inclinação menor ajuda pouco: com 50° em vez de 58°, o trabalho p95 cai de 10,6 para 9,9 ms e o p95 do quadro continua em 14 ms.
- O que sobra: com CPU 4×, 8,6 a 11,8 ms de trabalho por quadro. Numa tela de 60 Hz (16,7 ms por quadro) isso cabe; nesta tela de 144 Hz (6,9 ms por quadro), qualquer quadro acima de ~7 ms perde uma batida, e o p95 fica em 14 a 21 ms.
