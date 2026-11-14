# VICUS: convenções do projeto

O nome do produto fica só em `PRODUCT_NAME` (`.env`); o código nunca o escreve literalmente (frontend: `src/brand.js`; backend: `app/config.py`). O PDF em `docs/` usa o nome antigo (LOCUS).

O VICUS ajuda o dono de um negócio a comparar bairros pelos critérios dele: o que quer perto e o que não quer perto.

- **Fonte da verdade das regras:** [docs/LOCUS-logica-do-produto.pdf](docs/LOCUS-logica-do-produto.pdf).
- **Detalhes técnicos:** [docs/DATA.md](docs/DATA.md), [docs/SCORING.md](docs/SCORING.md), [docs/PERFORMANCE.md](docs/PERFORMANCE.md) e [docs/EXTENSIONS.md](docs/EXTENSIONS.md).

## Princípios inegociáveis (valem para código, textos e dados)

1. **O cliente decide sempre.** Nada de recomendar nem prometer lucro, faturamento ou sucesso.
2. **Textos proibidos na interface:** "melhor bairro", "garantido", "100% preciso", "ideal para você" ou qualquer promessa. Use "bairros que mais combinam com os critérios que você definiu".
3. **Todo dado mostrado tem fonte e data de referência.**
4. **Nunca estimar dado para preencher vazio.** A mensagem exata é `Não foi possível encontrar dados de [item] desta área.`
5. **Nada de depoimentos, logos, números de usuários ou estatísticas inventados.**
6. **Cor nunca é o único canal.** Mapa, tooltip e lista sempre mostram o número da posição.
7. **Ranking reproduzível.** Empate desfeito pelo nome do bairro.
8. **Notas vêm sempre do banco (SQL).** O frontend não calcula nota.
9. **Não guardar nem exibir dados de sócios ou MEI.** Na tabela de estabelecimentos fica só: hash do CNPJ, CNAE, situação, bairro (texto), CEP e município.
10. **Nenhum atributo pessoal ou protegido entra em cálculo.** Faturamento e sede não entram no ranking.
11. **Aviso fixo no rodapé do explorador:** caráter informativo; não é aconselhamento jurídico nem financeiro.
12. **Sem Google nesta etapa.** O mapa-base é OSM, com atribuição visível.
13. **Sem segredos no Git** (o repositório é público). `.env` e `data/raw/` ficam no `.gitignore`.

## Estrutura

```
backend/   FastAPI + SQLAlchemy Core (SQL explícito) + Alembic
  app/auth     sessão (cookie httpOnly + hash SHA-256 no banco), CSRF, argon2id, limite de tentativas
  app/api      catalog, geo (malhas do IBGE com cache), profile, cities (status/geojson/rank), account (LGPD)
  app/scoring  rank.py: o SQL único do ranking
  app/etl      seed_catalog, ibge_boundaries (bairros ou áreas por setor), cnpj, locate, counts, load_city/load_uf, report
  app/seed     CSVs editáveis: segmentos, tipos, tipo→CNAE, sugestões por ramo
frontend/  Vite + JS puro (ES modules), roteador por hash, MapLibre só no explorador
  src/styles/tokens.css  todas as cores, fontes e espaçamentos (troque o visual por aqui)
  src/map/mapView.js     mapa: fontes criadas uma vez, feature-state para cor e hover
docs/      DATA, SCORING, PERFORMANCE, EXTENSIONS
data/raw/  downloads do IBGE e da Receita (não versionado)
```

## Comandos (PowerShell, na raiz)

```powershell
docker compose up -d --build                                                  # sobe db, backend e frontend (http://localhost:8080)
docker compose run --rm backend python -m app.etl.load_uf --uf PE             # carga do estado inteiro (uma leitura do CNPJ)
docker compose run --rm backend python -m app.etl.load_city --ibge 2611606    # carga de um município
docker compose run --rm backend python -m app.etl.report --uf PE              # tabela de cobertura por cidade
docker compose run --rm backend python -m app.etl.seed_catalog                # recarrega o catálogo depois de editar os CSVs
docker compose run --rm backend pytest                                        # testes do backend (banco locus_test)
cd frontend; npx vitest run                                                   # testes do frontend
docker compose run --rm backend alembic revision -m "descricao"               # nova migration (escreva o SQL à mão)
docker compose --profile dev up frontend-dev                                  # Vite com HMR em http://localhost:5173
```

## Convenções

- **Idioma:** identificadores em inglês; textos de interface em português do Brasil; comentários curtos em português.
- **Banco:** toda mudança de esquema passa por migration Alembic. O SQL é escrito à mão: PostGIS e views materializadas ficam mais claros assim.
- **Tipos de negócio e CNAEs:** são dados (CSV), não código. Nunca escreva `if segmento == ...` no motor.
- **Nada específico de cidade:** toda cidade com `city_data_status` fica disponível no explorador; nunca escreva código para uma cidade em particular.
- **Dados brutos:** os .zip do CNPJ e as malhas ficam em `data/raw/` e nunca são apagados pelo ETL.
- **Mapa:**
  - recolorir = `setFeatureState`;
  - números = `setData` na fonte de pontos;
  - nunca recriar camadas ou fontes.
- **Atalhos com limite conhecido:** marque com `# shortcut: <limite>, <quando trocar>`.

## Fora do escopo desta etapa (só gancho documentado em EXTENSIONS.md)

- Landing page.
- Planos, cotas e pagamento.
- Agente de IA.
- Relatório em PDF.
- Google Places.
- Comparar cidades.
- Contas de equipe.
- Verificação de e-mail, redefinição de senha e login com Google.
- Aluguel.
- Estados além dos carregados (cada UF nova exige `load_uf`).
- Refino por CNEFE/CEP.

**Fora para sempre:** previsão de lucro, de faturamento ou de chance de sucesso.
