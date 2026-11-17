# VICUS — Implementação da transição mapa → maquete holográfica (1+3)

Atue como engenheiro front-end especialista em motion design para interfaces geoespaciais. Tenho um pacote de **360 frames consecutivos** da animação VICUS, numerados `vicus-transicao-000` a `vicus-transicao-359`, mais um vídeo de 60 FPS e um visualizador HTML. **Use o pacote como referência de timing, câmera e identidade visual. Não recrie cada frame por IA generativa**: isso fará a geometria e a loja mudarem entre quadros.

## Resultado esperado

O visitante começa vendo o mapa cartográfico de Recife de cima, com a interface da VICUS. Ao selecionar o bairro, a câmera aproxima a região de forma contínua, inclina gradativamente o mapa e o território recua em perspectiva. A transição final revela a **mesma maquete VICUS** (fachada grafite, toldos cobre, cobertura plana, iluminação interna, floreiras), suspensa com anel e feixe holográfico em cobre/âmbar, **sem pin de localização**, **sem círculo de wipe**, **sem screenshot crescendo repentinamente**.

## Distribuição temporal de referência

- 000–059: mapa de cima e contexto atual.
- 060–149: zoom suave e retirada progressiva dos painéis.
- 150–239: inclinação e descida de câmera, aproximando o bairro selecionado.
- 240–299: maquete se materializa discretamente, sem trocar de modelo.
- 300–359: holograma estabiliza, maquete permanece totalmente visível.

As faixas servem para timing visual. **No sistema real, o estado de seleção deve determinar a localização e não um município fixo codificado na animação**.

## Diretrizes de implementação

1. Não modifique a lógica territorial, as geometrias oficiais, rankings, cálculos, filtros ou fontes da plataforma.
2. Prefira animar a câmera de verdade no mapa (MapLibre GL/Mapbox GL, Cesium ou engine já existente), usando progressões contínuas de center/zoom/pitch/bearing. Os frames são um protótipo visual; **um vídeo ou spritesheet não oferece mapa interativo**.
3. Para um MVP, use os `frames-webp` como fallback de sequenciamento por scroll, renderizados num único elemento e indexados pela progressão de `scroll`. Faça pré-carregamento de imagens próximas ao frame atual e evite decodificar todos os 360 PNGs simultaneamente.
4. Use `requestAnimationFrame` e interpolação para a câmera. Prefira `transform`/`opacity` para painéis e textos; mantenha consistência entre desktop e mobile.
5. Mantenha a maquete ancorada ao bairro, com o anel holográfico associado ao ponto de análise. Não insira nenhuma seta, marcador de mapa ou símbolo de pin sob a loja.
6. A loja deve ser a mesma em todos os frames: não gere um novo desenho a cada ângulo ou mudança de câmera. Ao concluir a transição, poderá começar a rotação 360° original num módulo separado.
7. Evite flashes, neon intenso, máscaras circulares, zoom brusco, bounce e efeitos de apresentação antiga. A marca é premium e usa grafite `#181512`, cobre `#EBA774`, areia `#F3EDE7` e painéis `#352D27`.
8. Respeite `prefers-reduced-motion`, use imagens ou estado final quando o movimento estiver reduzido e mantenha navegação por teclado.
9. Preserve a atribuição obrigatória dos dados cartográficos, incluindo OpenStreetMap quando utilizado.
10. Não invente dados de bairro, métrica de lucratividade, previsão de sucesso ou a classificação 'melhor bairro'.

## Arquivos

- `index.html`: demonstração de vídeo fluido e controle individual de frames.
- `frames-webp/vicus-transicao-000.webp` ... `359.webp`: quadros compactos para desenvolvimento.
- `VICUS-Mapa-para-Holograma-360-60fps.mp4`: sequência completa, 6 s a 60 FPS.
- `12-etapas-preview.jpg`: 12 quadros-chave, para inspecionar a progressão.
- Os 360 PNGs sem perda estão em um ZIP separado.

## Limitação importante

A demonstração foi composta com a **captura do mapa existente da VICUS** e uma única renderização da maquete, usando transformações de perspectiva. É uma prova de direção visual em 2.5D, **não** um percurso 3D georreferenciado nem uma câmera física movendo-se por ruas reais. Para a versão de produção realmente tridimensional, replique o movimento com o mapa real e um modelo GLB/GLTF da loja.
