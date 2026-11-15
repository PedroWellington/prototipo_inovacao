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

# 3. Carga do Brasil inteiro (5.570 municípios): Censo 2022, bairros/áreas das 27 UFs, CNPJ (uma leitura só),
#    localização, renda e contagens. Baixa ~5,4 GB da Receita e ~1,7 GB do IBGE na primeira vez (fica em data\raw,
#    fora do Git, e nunca é apagado). Retomável: se cair, rode de novo e ela continua da UF seguinte.
docker compose run --rm backend python -m app.etl.load_br

# Só um estado ou um município (código IBGE), se preferir:
docker compose run --rm backend python -m app.etl.load_uf --uf PE
docker compose run --rm backend python -m app.etl.load_city --ibge 2611606
```

Ao final, a carga imprime a cobertura por UF. Detalhe de uma cidade, com os 20 textos de bairro não casados:
`docker compose run --rm backend python -m app.etl.report --ibge 2611606`. Tabela de todas as cidades:
`docker compose run --rm -T backend python -m app.etl.report --all > docs/COBERTURA.md`.

Toda cidade com dados carregados fica clicável no explorador automaticamente. Cidades sem bairros na malha do IBGE usam **áreas por setor censitário**, e a tela avisa isso.

Abra **http://localhost:8080** (a landing; o app fica em **http://localhost:8080/app/**), crie uma conta e responda as perguntas iniciais. O explorador pergunta **"Você já tem uma cidade em mente?"**:
- **Sim:** região → estado → cidade → bairros (por exemplo, Nordeste → Pernambuco → Recife).
- **Não:** escolha o alcance (Brasil, uma região ou um estado) e veja as cidades que mais combinam com os seus critérios. Clique numa cidade para ver os bairros dela.

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
| Landing | http://localhost:8080/ |
| Aplicação | http://localhost:8080/app/ |
| Documentação da API | http://localhost:8000/api/docs |
| Banco (cliente SQL) | `localhost:5433`, usuário e senha do `.env` |
| Frontend com HMR (desenvolvimento) | `docker compose --profile dev up frontend-dev`, depois http://localhost:5173 (landing em `/`, app em `/app/`) |

## Testes

```powershell
docker compose run --rm backend pytest           # backend: auth, perfil, ETL, ranking (banco locus_test)
cd frontend; npm install; npx vitest run          # frontend: funções puras e roteamento
cd frontend; npm run perf                         # fluidez: abre o Edge e mede (usa Recife; precisa estar carregado)
cd frontend; node perf/explorer-fps.mjs          # câmera do explorador, 2D e Relevo, CPU normal e 4x
cd frontend; node perf/journey.mjs               # ponta a ponta: landing, cadastro, dashboard, explorador, celular
cd frontend; node perf/a11y.mjs                  # acessibilidade (axe-core, WCAG A e AA): docs/ACESSIBILIDADE.md
cd frontend; node perf/screens.mjs <pasta>       # capturas das telas principais (desktop e celular)
docker compose run --rm backend python scripts/perf_rank.py   # tempo do ranking (p50/p95) e tamanho da geometria
```

## Créditos (sem pagamento nesta etapa)

Todo cadastro novo ganha 1 crédito. 1 crédito = analisar 1 cidade por 30 dias; o ranking de cidades usa 1 crédito por
busca (um alcance: Brasil, uma região ou um estado). As regras ficam na tabela `credit_settings`. Para conceder créditos:

```powershell
docker compose run --rm backend python -m app.credits grant --email ana@exemplo.com --amount 5 --note "teste"
docker compose run --rm backend python -m app.credits balance --email ana@exemplo.com
```

As logos enviadas ficam em `data\uploads\logos` (fora do Git), já recodificadas em WebP.

## Auditoria dos dados (só desenvolvimento, não é exposto no site)

```powershell
# Estabelecimentos contados num bairro para um tipo: CNPJ básico, CNAE, endereço e método de localização
# (sem nome, sem sócio; MEI aparece como "omitido"). Relê os .zip do CNPJ; CSV em data\raw\audit.
docker compose run --rm backend python scripts/audit_establishments.py --ibge 2611606 --bairro Iputinga --type hospital
# Compara com o CNES (Ministério da Saúde), por coordenada
docker compose run --rm backend python scripts/compare_cnes.py --ibge 2611606 --bairro Iputinga
```

## Começar de novo do zero

```powershell
docker compose down -v      # apaga o banco (os downloads em data\raw ficam)
docker compose up -d --build
docker compose run --rm backend python -m app.etl.load_br --local-path /data/raw/cnpj/2026-10
```

## Documentação

- [docs/LOCUS-logica-do-produto.pdf](docs/LOCUS-logica-do-produto.pdf): regras do produto (fonte da verdade).
- [docs/DATA.md](docs/DATA.md): fontes, layouts, datas, limitações e taxa de localização medida.
- [docs/COBERTURA.md](docs/COBERTURA.md): taxa de localização de cada cidade carregada (gerado).
- [docs/SCORING.md](docs/SCORING.md): fórmula do ranking, com exemplo numérico.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): metas de fluidez e números medidos.
- [docs/MARCA.md](docs/MARCA.md): ícone, logo, favicon e manifesto; como regenerar.
- [docs/EXTENSIONS.md](docs/EXTENSIONS.md): Google Places, tiles de produção, CNEFE, pagamentos e demais extensões.
- [CLAUDE.md](CLAUDE.md): princípios, estrutura e convenções.

## Desvios da stack sugerida

- **GeoAlchemy2 não é usado.** As geometrias ficam em SQL PostGIS explícito (migrations e consultas), e o código não precisa de tipos geométricos no ORM. Usamos SQLAlchemy 2 no modo Core.
- **O frontend roda no nginx com o build de produção**, e não no servidor de desenvolvimento do Vite. Assim o que você usa é o mesmo que é medido em `PERFORMANCE.md`. Para desenvolver com HMR, use o serviço `frontend-dev`.
