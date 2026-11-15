# Landing da VICUS

Página estática: HTML, CSS e JS puro (ES modules), sem framework. Os limites do mapa vêm do IBGE e ficam em `data/`, gerados por script. Em tempo de execução, nada depende de rede externa.

```
index.html            página
css/landing.css       visual (paleta grafite, ardósia, areia e cobre)
js/landing.js         câmera, mapa (Canvas 2D), textos e loja
js/config.js          APP_URL: endereço do app (rotas #/register e #/login)
js/fallback-geo.js    geometria ESQUEMÁTICA, só usada se um arquivo de data/ falhar (a tela avisa)
assets/               imagem da loja (WebP e JPG; 960, 1280 e 1672 px) e ícone
data/                 limites geográficos (TopoJSON em Web Mercator, 2 ou 3 níveis de detalhe) + FONTES.md
scripts/              build-geo.mjs (gera data/), compare_bairros.py (IBGE x Prefeitura), serve.mjs
perf/                 measure.mjs (fluidez), shots.mjs (capturas), baseline.html (ruído do ambiente)
docs/                 PERFORMANCE.md (números antes e depois), COMPARACAO-BAIRROS.md
```

## Rodar localmente

Precisa de Node 20 ou mais novo. Abra pelo servidor, **nunca por `file://`**: o navegador bloqueia a leitura de `data/` e a página mostraria a versão ilustrativa.

```powershell
cd landing
npm install
npm run serve          # http://localhost:4173  (PORT=xxxx para trocar)
```

Antes de publicar, troque `APP_URL` em `js/config.js` pelo endereço definitivo do app.

## Regenerar os dados geográficos

Usa a Malha Municipal 2022 do IBGE já baixada pelo ETL do produto (`data/raw/ibge/BR_Municipios_2022.zip`). Os bairros do Recife vêm do **banco do produto** (tabela `neighborhoods`, Censo 2022), por isso o Docker precisa estar no ar.

```powershell
docker compose up -d db          # na raiz do repositório
cd landing
npm run build-geo                # escreve data/*.json, data/manifest.json e data/FONTES.md
```

- O script avisa se algum grupo passar do orçamento comprimido: Brasil ≤ 150 KB, PE ≤ 150 KB, Recife ≤ 120 KB.
- As tolerâncias de cada nível ficam em `LAYERS`, no início de `scripts/build-geo.mjs`.

Para conferir os bairros contra os "Limites dos bairros" da Prefeitura do Recife (ODbL, 2023):

```powershell
# na raiz do repositório; o arquivo fica em data/raw/, fora do Git
curl.exe -L -o data/raw/recife/limites-dos-bairros-2023.geojson "https://dados.recife.pe.gov.br/dataset/ce23d3f4-7474-44d3-b310-19f3afcebf4a/resource/d5f956ce-7e1f-4c74-839b-06cb490c3721/download/limites-dos-bairros-2023.geojson"
docker compose run --rm -v ./landing:/landing backend python /landing/scripts/compare_bairros.py
```

## Medir a fluidez

Com o servidor no ar (`npm run serve`) e o Microsoft Edge instalado:

```powershell
npm run perf                                                     # index.html -> perf/results/depois.json
$env:PAGE='/perf/baseline.html'; $env:LABEL='baseline'; npm run perf   # ruído do ambiente
node perf/shots.mjs / "$env:TEMP/landing" desktop             # capturas em pontos fixos do scroll
```

- `ONLY=desktop` roda um cenário só.
- `EXTRA_CSS='seletor{...}'` desliga um efeito para medir quanto ele custa.
- Método e resultados: [docs/PERFORMANCE.md](docs/PERFORMANCE.md).

## Regras que valem aqui também

- Sem promessa de lucro, sem "melhor bairro", sem depoimentos, logos, números de usuários ou preços.
- Todo dado tem fonte. O que é exemplo leva "exemplo ilustrativo".
- A prévia mostra contornos, nunca um ranking.
- A loja da animação é uma ilustração, não um endereço real.
- Se um arquivo geográfico faltar:
  - a camada usa a geometria esquemática;
  - a tela diz "Prévia ilustrativa";
  - o console mostra `[VICUS geo]`.
- O nome "VICUS" aparece escrito no HTML. É a exceção à regra do `PRODUCT_NAME`: a página é estática e precisa do texto para buscadores e para quem navega sem JS.
