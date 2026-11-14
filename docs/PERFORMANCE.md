# Fluidez: metas e números medidos

## Metas

O documento do produto não fixa números. As metas abaixo seguem referências públicas: Core Web Vitals do Google para LCP, CLS e INP, e 60 fps para animação.

| O quê | Meta |
|---|---|
| LCP da tela de login | ≤ 2,5 s |
| CLS (login e explorador) | ≤ 0,1 |
| Ranking no servidor (`POST /api/cities/{ibge}/rank`) | p95 ≤ 200 ms |
| Mexer no peso até o mapa recolorido | ≤ 500 ms, já contando os 250 ms de debounce |
| Tooltip ao passar o mouse | sem nenhuma chamada de rede |
| Arrastar e dar zoom no mapa | média ≥ 60 fps |
| Geometria na segunda visita | sai do cache do navegador |

## Como medir

```powershell
docker compose up -d
cd frontend; npm run perf                                       # abre o Edge; com HEADLESS=1 roda sem janela (aí o LCP sai 0)
docker compose run --rm backend python scripts/perf_rank.py     # ranking com 125 combinações de pesos e tamanho da geometria
```

Os dois scripts usam Recife (2611606), criam um usuário descartável e o apagam no fim. Eles medem o build de produção servido pelo nginx. O resultado de `npm run perf` fica em `frontend/perf/results/`, que não vai para o Git.

## Números medidos

Medição de 14/11/2026, com PE carregado (dados de 2026-10, 185 cidades). Máquina: Ryzen 5 5600, 16 GB de RAM, Radeon RX 7600, Edge.

| O quê | Medido |
|---|---|
| LCP do login | 232 ms |
| CLS do login / do explorador | 0,0009 / 0 |
| JS transferido no login | 7 KB (o MapLibre só carrega no explorador) |
| Do explorador aberto até o primeiro mapa colorido | 1.365 ms |
| Ranking no servidor, 1ª vez de cada combinação | p50 19 ms, p95 24 ms, máx. 74 ms |
| Ranking no servidor, repetição | p50 11 ms, p95 14 ms |
| Ranking visto pelo navegador | p50 18 ms, p95 20 ms |
| Recolorir o mapa depois da resposta | p50 6 ms, p95 8 ms |
| Do slider ao mapa recolorido (com debounce) | p50 278 ms, p95 283 ms |
| Tooltip | p50 1,4 ms, p95 2,1 ms; nenhuma chamada de rede |
| Arrastar e dar zoom | média de 141 fps; 1 de 515 quadros passou de 33 ms (o pior teve 55 ms) |
| Geometria de Recife | 89 KB sem compressão, 19 KB com gzip; na segunda visita vem do cache; revalidação devolve 304 em 7 ms |
| Trocar de tela (explorador → conta → explorador) | 35 ms / 79 ms |
| Trocar de nível (cidade → estado) | 268 ms |

## O que sustenta esses números

- **Geometria simplificada só para o mapa.** `geom_simplified` usa `ST_SimplifyPreserveTopology` com tolerância de 0,0001 grau (cerca de 11 m), em `app/etl/ibge_boundaries.py`. A área continua sendo calculada sobre a geometria original. O GeoJSON sai com 5 casas decimais (cerca de 1 m).
- **Cache HTTP.** A geometria é pedida com `?v=<loaded_at>` e vai com `max-age` de um dia e ETag. A URL muda quando a cidade é recarregada. Catálogo e malhas também usam ETag.
- **Contagens prontas.** As views materializadas `neighborhood_type_counts` e `neighborhood_coverage` são atualizadas pelo ETL. O ranking é um único SQL sobre elas (`app/scoring/rank.py`).
- **Mapa sem recriar nada.** Para recolorir, o mapa usa `setFeatureState`. Os números de posição usam `setData` na fonte de pontos. As fontes e camadas são criadas uma única vez (`src/map/mapView.js`).
- **Debounce.** O ranking espera 250 ms depois do último ajuste de peso, e o salvamento dos critérios espera 800 ms.
- **Tooltip local.** O tooltip usa a resposta do ranking que o navegador já tem.

Os marcadores `app:recolor` e `app:tooltip` (`performance.measure` em `src/views/explorer.js`) são o que `npm run perf` lê.
