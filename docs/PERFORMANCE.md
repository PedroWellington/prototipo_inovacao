# Fluidez: metas e números medidos

## Metas

O documento do produto não fixa números. As metas abaixo seguem referências públicas: Core Web Vitals do Google para LCP, CLS e INP, e 60 fps para animação. A meta de 150 ms do ranking de cidades foi pedida para esta etapa.

| O quê | Meta |
|---|---|
| LCP da tela de login | ≤ 2,5 s |
| CLS (login e explorador) | ≤ 0,1 |
| Ranking de bairros no servidor (`POST /api/cities/{ibge}/rank`) | p95 ≤ 200 ms |
| Ranking de cidades no servidor (`POST /api/cities/rank`) | p95 ≤ 150 ms |
| Mexer no peso até o mapa recolorido | ≤ 500 ms, já contando os 250 ms de debounce |
| Tooltip ao passar o mouse | sem nenhuma chamada de rede |
| Arrastar e dar zoom no mapa (bairros e ~5.570 municípios) | média ≥ 60 fps |
| Recolher/abrir o painel lateral | ≥ 60 fps, sem quadro acima de 33 ms |
| Salto de layout (CLS) em login, início e explorador | zero |
| Transições de interface | 150 a 200 ms (`--dur-fast` 150 ms, `--dur` 180 ms) |
| Geometria na segunda visita | sai do cache do navegador |

## Como medir

```powershell
docker compose up -d
cd frontend; npm run perf                                       # abre o Edge; com HEADLESS=1 roda sem janela (aí o LCP sai 0)
docker compose run --rm backend python scripts/perf_rank.py     # rankings com 125 combinações de pesos e tamanho da geometria
```

Os dois scripts criam um usuário descartável e o apagam no fim, e medem o build de produção servido pelo nginx. Os bairros usam Recife (2611606) e as cidades usam o Brasil inteiro. O resultado de `npm run perf` fica em `frontend/perf/results/`, que não vai para o Git.

## Números medidos

Medição de 14/11/2026, com o Brasil inteiro carregado: 5.570 cidades, 53.905 bairros/áreas, 2,74 milhões de cadastros de CNPJ (2,28 milhões de locais) e 8.564 unidades do CNES. Máquina: Ryzen 5 5600, 16 GB de RAM, Radeon RX 7600, Edge.

### Bairros (Recife)

| O quê | Medido |
|---|---|
| LCP do login | 248 ms |
| CLS do login / do explorador | 0,0009 / 0,0001 |
| JS transferido no login | 7 KB (o MapLibre só carrega no explorador) |
| Do explorador aberto ("Sim") até o primeiro mapa colorido | 804 ms |
| Ranking no servidor, 1ª vez de cada combinação | p50 22 ms, p95 31 ms, máx. 117 ms |
| Ranking no servidor, repetição | p50 15 ms, p95 20 ms |
| Ranking visto pelo navegador | p50 22 ms, p95 23 ms |
| Recolorir o mapa depois da resposta | p50 6 ms, p95 8 ms |
| Do slider ao mapa recolorido (com debounce) | p50 283 ms, p95 286 ms |
| Tooltip | p50 1,3 ms, p95 2,0 ms; nenhuma chamada de rede |
| Arrastar e dar zoom | média de 141 fps; 1 de 525 quadros passou de 33 ms (o pior teve 83 ms) |
| Geometria de Recife | 89 KB sem compressão, 19 KB com gzip; na segunda visita vem do cache; revalidação devolve 304 em 5 ms |
| Trocar de tela (explorador → conta → explorador) | 37 ms / 253 ms (a volta inclui a pergunta inicial e abrir a cidade) |
| Trocar de nível (cidade → estado) | 72 ms |

### Cidades (Brasil inteiro)

| O quê | Medido | Meta |
|---|---|---|
| Servidor, mínimo de 20 mil hab. (1.710 cidades), 1ª vez de cada combinação | p50 81 ms, **p95 105 ms**, máx. 113 ms; 352 KB (≈ 80 KB com gzip) | ✅ |
| Servidor, mínimo de 20 mil hab., repetição (cache) | p50 16 ms, p95 18 ms | ✅ |
| Servidor, sem mínimo (5.570 cidades), 1ª vez | p50 203 ms, **p95 234 ms** | ❌ acima de 150 ms |
| Servidor, sem mínimo, repetição (cache) | p50 17 ms, p95 20 ms | ✅ |
| Navegador: escolher "Brasil" até o mapa colorido | 102 ms | |
| Navegador: recolorir depois da resposta | 1.710 cidades: p50 14 ms, p95 17 ms; 5.570: p50 36 ms, p95 48 ms | |
| Navegador: slider até o mapa recolorido (com debounce de 250 ms) | 1.710: p50 302 ms, p95 316 ms; 5.570: p50 340 ms, p95 357 ms | ✅ ≤ 500 ms |
| Arrastar e dar zoom sobre o Brasil | média de 141,6 fps; 0 de 583 quadros acima de 33 ms (o pior teve 28 ms) | ✅ |
| Tiles vetoriais dos municípios (com gzip) | zoom 3: 189 KB; 4: 116 KB; 5: 35 KB; 6: 42 KB; 8: 4 KB; 10: < 1 KB. Gerados em 10–50 ms e guardados em memória | |

A rede vista pelo navegador no ranking de cidades (p50 ~24 ms) mede, em boa parte, respostas do cache, porque o teste repete pesos. O número sem cache é o do servidor, na tabela acima.

**Ponto aberto:** o caso extremo, Brasil inteiro e sem população mínima, fica em p95 234 ms na primeira vez de cada combinação. Ele cai para 20 ms quando repetido. O padrão (mínimo de 20 mil) e qualquer região ou estado ficam dentro da meta. Se for preciso, o próximo passo é pré-calcular por município e tipo o valor normalizado e o percentil por alcance.

### Início, painel lateral e créditos (rodada final desta etapa)

| O quê | Medido | Meta |
|---|---|---|
| Login: LCP / CLS | 228 ms / 0 | ✅ |
| Tela inicial (`#/home`): LCP / CLS | 116 ms / 0 | ✅ |
| Explorador: CLS | 0 | ✅ |
| Recolher e abrir o painel 6 vezes | média de 144 fps; 0 de 258 quadros acima de 33 ms (o pior teve 7 ms); CLS 0 | ✅ |
| Mapa de bairros ao arrastar e dar zoom | média de 141 fps | ✅ |
| Mapa do Brasil (municípios) ao arrastar e dar zoom | média de 142 fps; 0 quadros acima de 33 ms | ✅ |
| Slider até bairros recoloridos (com debounce) | p95 284 ms | ✅ |
| Slider até cidades recoloridas, 1.710 / 5.570 | p95 310 ms / 353 ms | ✅ |
| Servidor: ranking de bairros (1ª vez, com checagem de liberação) | p50 31 ms, p95 36 ms | ✅ |
| Servidor: ranking de cidades, mínimo de 20 mil (1ª vez) | p95 106 ms | ✅ |
| Servidor: ranking de cidades sem mínimo (1ª vez) | p95 243 ms | ❌ (ponto aberto, abaixo) |

Achados desta rodada:
- **Salto de layout de 0,003 na tela inicial.** A animação de entrada das telas usava `translateY(4px)`. Em telas da altura da janela, isso criava uma barra de rolagem por 180 ms; quando ela sumia, o conteúdo recentrava 7,5 px. Agora a entrada é só opacidade.
- **Reservar a barra na raiz não serve.** Tanto `scrollbar-gutter: stable` quanto `overflow-y: scroll` no `html` fazem o Edge deixar de emitir FCP e LCP. Não foram usados.
- **A primeira tela não tem fade.** Começar com opacidade 0 também suprimia o FCP e atrasava o conteúdo. O fade (180 ms) fica só nas trocas de tela.
- **O painel não redimensiona o mapa.** Painel e mapa ocupam a mesma área. O painel recolhe por `transform` (compositor), a legenda acompanha por `transform`, e o mapa só desloca a câmera meia largura (`panBy`, 180 ms). O enquadramento desconta o painel aberto (`setInset`).
- **A tela inicial é desenhada uma vez só.** Perfil, usuário e créditos chegam em paralelo, e o avatar tem tamanho fixo.

## O que sustenta esses números

- **Geometria simplificada só para o mapa.**
  - Bairros: `geom_simplified` usa `ST_SimplifyPreserveTopology` com tolerância de 0,0001 grau (cerca de 11 m), em `app/etl/ibge_boundaries.py`. A área continua sendo calculada sobre a geometria original. O GeoJSON sai com 5 casas decimais (cerca de 1 m).
  - Municípios: três versões em Web Mercator, com tolerâncias de 1.500 m, 250 m e 30 m (`app/etl/census.py`). Cada uma é usada numa faixa de zoom: até 5, de 6 a 8 e de 9 em diante.
- **Tiles vetoriais (`ST_AsMVT`)** em `GET /api/geo/tiles/municipalities/{z}/{x}/{y}.pbf`.
  - Cada tile leva só id, nome, UF e população.
  - Ficam num cache LRU em memória (4.096 tiles) e vão com `max-age` de 7 dias. A URL leva `?v=` com a versão da malha.
  - O mapa cria a fonte vetorial uma vez. A cor vem por `setFeatureState` (com `sourceLayer`), e os números por `setData` numa fonte de pontos.
- **Ranking de cidades enxuto** (`app/scoring/rank_cities.py`).
  - As linhas saem do SQL já em JSON (`json_agg` de arrays). A resposta é colunar: nomes das colunas uma vez, e textos de renda, nota e fonte uma vez.
  - As contagens são filtradas pelos tipos pedidos antes da junção.
  - A resposta é comprimida **uma vez** (gzip nível 5) e guardada no cache já comprimida. O `GZipMiddleware` (nível 9) não recomprime.
  - Antes dessas mudanças: p50 585 ms e 2,7 MB para 1.710 cidades; 1,2 s e 8,8 MB para 5.570.
- **Cache HTTP.** A geometria de bairros é pedida com `?v=<loaded_at>` e vai com `max-age` de um dia e ETag. Catálogo e malhas também usam ETag.
- **Contagens prontas.** As views materializadas `neighborhood_type_counts`, `municipality_type_counts` e `neighborhood_coverage` são atualizadas pelo ETL. Os rankings são SQL únicos sobre elas.
- **Debounce.** O ranking espera 250 ms depois do último ajuste (peso ou população mínima), e o salvamento dos critérios espera 800 ms.
- **Tooltip local.** O tooltip usa a resposta do ranking que o navegador já tem.

Os marcadores `app:recolor`, `app:city-recolor` e `app:tooltip` (`performance.measure` em `src/views/explorer.js`) são o que `npm run perf` lê.
