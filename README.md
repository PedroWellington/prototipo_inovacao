# VICUS

> O produto se chamava LOCUS; o PDF em `docs/` ainda usa o nome antigo, mas é o mesmo produto. O nome fica só em `PRODUCT_NAME`, no `.env`.

VICUS é uma plataforma web em que o dono de um negócio, de qualquer segmento, compara bairros antes de abrir uma nova unidade.

- Ele define o que quer **perto** e o que **não** quer perto do negócio, e o peso de cada critério.
- O VICUS mostra os **bairros que mais combinam com os critérios que você definiu**, num mapa colorido e numerado.
- Os dados são abertos (IBGE e Receita Federal), sempre com fonte e data.
- A plataforma não recomenda bairro e não promete resultado. A decisão é sempre de quem usa.

## Requisitos

- Windows 10/11 com **PowerShell**.
- **Docker Desktop**, aberto antes de rodar os comandos.
- **Git**.
- **Node.js** (opcional). Só é usado para os testes do frontend e para o script de medição de fluidez.

Nada de Python, GDAL ou Postgres precisa ser instalado no Windows: tudo roda nos containers.

## Do zero até o mapa de Pernambuco

No PowerShell, na pasta do repositório:

```powershell
# 1. Configuração (ajuste a senha; troque as portas se 5433/8000/8080 estiverem ocupadas)
Copy-Item .env.example .env

# 2. Sobe banco (Postgres + PostGIS), backend (FastAPI) e frontend (nginx com o build de produção).
#    As migrations rodam sozinhas quando o backend sobe.
docker compose up -d --build

# 3. Carga de Pernambuco inteiro (185 municípios): catálogo do IBGE, bairros/áreas, CNPJ, localização e contagens.
#    Baixa ~5,4 GB da Receita na primeira vez (fica em data\raw, fora do Git, e nunca é apagado) e leva de
#    15 a 60 min, conforme a sua internet. Rodar de novo não duplica nada e reaproveita os arquivos.
docker compose run --rm backend python -m app.etl.load_uf --uf PE

# Só um município (código IBGE), se preferir:
docker compose run --rm backend python -m app.etl.load_city --ibge 2611606
```

Ao final, a carga imprime a tabela por cidade (% de estabelecimentos localizados). Detalhe de uma cidade, com os 20 textos de bairro não casados:
`docker compose run --rm backend python -m app.etl.report --ibge 2611606`.

Toda cidade com dados carregados fica clicável no explorador automaticamente. Cidades sem bairros oficiais no IBGE usam **áreas por setor censitário**, e a tela avisa isso.

Abra **http://localhost:8080**, crie uma conta e responda as perguntas iniciais. No mapa, escolha **Nordeste → Pernambuco** e uma cidade (por exemplo, Recife).

### Se o download da Receita falhar

1. Baixe manualmente, da pasta do mês mais recente em https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9, os arquivos `Municipios.zip` e `Estabelecimentos0.zip` … `Estabelecimentos9.zip`.
2. Coloque-os em `data\raw\cnpj\AAAA-MM\`.
3. Rode:

```powershell
docker compose run --rm backend python -m app.etl.load_uf --uf PE --local-path /data/raw/cnpj/AAAA-MM
```

### Etapas separadas

```powershell
docker compose run --rm backend python -m app.etl.load_uf --uf PE --steps boundaries
docker compose run --rm backend python -m app.etl.load_uf --uf PE --steps cnpj,locate,counts
docker compose run --rm backend python -m app.etl.seed_catalog   # depois de editar backend/app/seed/*.csv
```

## Endereços

| O quê | Onde |
|---|---|
| Aplicação | http://localhost:8080 |
| Documentação da API | http://localhost:8000/api/docs |
| Banco (cliente SQL) | `localhost:5433`, usuário e senha do `.env` |
| Frontend com HMR (desenvolvimento) | `docker compose --profile dev up frontend-dev`, depois http://localhost:5173 |

## Testes

```powershell
docker compose run --rm backend pytest           # backend: auth, perfil, ETL, ranking (banco locus_test)
cd frontend; npm install; npx vitest run          # frontend: funções puras e roteamento
cd frontend; npm run perf                         # fluidez: abre o Edge e mede (usa Recife; precisa estar carregado)
docker compose run --rm backend python scripts/perf_rank.py   # tempo do ranking (p50/p95) e tamanho da geometria
```

## Começar de novo do zero

```powershell
docker compose down -v      # apaga o banco (os downloads em data\raw ficam)
docker compose up -d --build
docker compose run --rm backend python -m app.etl.load_uf --uf PE --local-path /data/raw/cnpj/2026-10
```

## Documentação

- [docs/LOCUS-logica-do-produto.pdf](docs/LOCUS-logica-do-produto.pdf): regras do produto (fonte da verdade).
- [docs/DATA.md](docs/DATA.md): fontes, layouts, datas, limitações e taxa de localização medida.
- [docs/SCORING.md](docs/SCORING.md): fórmula do ranking, com exemplo numérico.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): metas de fluidez e números medidos.
- [docs/EXTENSIONS.md](docs/EXTENSIONS.md): Google Places, tiles de produção, CNEFE, pagamentos e demais extensões.
- [CLAUDE.md](CLAUDE.md): princípios, estrutura e convenções.

## Desvios da stack sugerida

- **GeoAlchemy2 não é usado.** As geometrias ficam em SQL PostGIS explícito (migrations e consultas), e o código não precisa de tipos geométricos no ORM. Usamos SQLAlchemy 2 no modo Core.
- **O frontend roda no nginx com o build de produção**, e não no servidor de desenvolvimento do Vite. Assim o que você usa é o mesmo que é medido em `PERFORMANCE.md`. Para desenvolver com HMR, use o serviço `frontend-dev`.
