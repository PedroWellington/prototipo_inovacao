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
9. **Não guardar nem exibir dados de sócios ou MEI.** Na tabela de estabelecimentos fica só: hash do CNPJ, CNAE, situação, bairro (texto), CEP, município e `location_id` (hash de CNPJ de outro cadastro do mesmo endereço; nunca o endereço nem hash dele). Do CNES, só código, tipo de unidade, município e bairro.
10. **Nenhum atributo pessoal ou protegido entra em cálculo.** Faturamento e sede não entram no ranking.
11. **Aviso legal fora do mapa:** o texto "caráter informativo; não é aconselhamento jurídico nem financeiro" fica na página de Termos (seção "Avisos legais", com o botão "Como calculamos"), linkada no rodapé da Visão geral e em "Dados e fontes". Nada de aviso jurídico sobre o mapa nem em rodapé fixo do explorador.
12. **Sem Google nesta etapa.** O mapa-base é OSM, com atribuição visível.
13. **Sem segredos no Git** (o repositório é público). `.env` e `data/raw/` ficam no `.gitignore`.

## Estrutura

```
backend/   FastAPI + SQLAlchemy Core (SQL explícito) + Alembic
  app/auth     sessão (cookie httpOnly + hash SHA-256 no banco), CSRF, argon2id, limite de tentativas
  app/api      catalog, geo (malhas do IBGE com cache), profile (+ logo), cities (status/geojson/rank), credits, account (LGPD)
  app/credits.py  única autoridade de saldo e liberação (regras em credit_settings); app/logos.py valida e recodifica imagens
  app/billing     ponto único do pagamento (planos, interesse em credit_purchase_interest, gancho checkout); PAYMENTS_ENABLED=false
  app/scoring  rank.py (bairros) e rank_cities.py (cidades): o mesmo motor em SQL
  app/etl      seed_catalog, ibge_boundaries (bairros ou áreas por setor), cnpj, locate, counts, census, cnes, load_city/load_uf/load_br, report
  app/seed     CSVs também definem a fonte de cada tipo (business_types.source: cnpj|cnes) e tipo -> TP_UNIDADE do CNES
  scripts/     medição (perf_rank) e auditoria de dados (audit_establishments, compare_cnes); só desenvolvimento
  app/seed     CSVs editáveis: segmentos, tipos, tipo→CNAE, sugestões por ramo
frontend/  Vite + JS puro (ES modules), roteador por hash, MapLibre só no explorador
  public/theme.js        tema claro/escuro (landing e app): bloqueante no <head>, preferência em localStorage, [data-theme-toggle]
  src/views/billing.js   "Comprar mais créditos" (ponto único do pagamento no frontend)
  src/styles/tokens.css  nomes por função (cor, fonte, espaço) mapeados para a paleta de shared/
  src/map/camera.js      câmera contínua (zoom logarítmico + deslocamento atrelado); src/rankList.js: ranking com FLIP
  src/map/mapView.js     mapa: fontes criadas uma vez, feature-state para cor e hover
docs/      DATA, SCORING, PERFORMANCE, EXTENSIONS, DEPLOY (Vercel + Neon), MARCA, PROGRESSO
api/       index.py: a API como função Python da Vercel; vercel.json e scripts/build-vercel.mjs montam o site (docs/DEPLOY.md)
shared/    design-tokens.css: paleta única (app e landing); troque o visual do site inteiro por aqui
design/    referência do protótipo (dashboard-cinematico/, fora do Git) e check-leak.sh
landing/   landing estática (HTML/CSS/JS puro, Canvas 2D); limites do IBGE pré-gerados em landing/data (ver landing/README.md)
data/raw/  downloads do IBGE e da Receita (não versionado)
```

## Comandos (PowerShell, na raiz)

```powershell
docker compose up -d --build                                                  # sobe db, backend e frontend: landing em http://localhost:8080/, app em /app/
docker compose run --rm backend python -m app.etl.load_br                     # Brasil inteiro, retomável (uma leitura do CNPJ)
docker compose run --rm backend python -m app.etl.load_uf --uf PE             # carga do estado inteiro (uma leitura do CNPJ)
docker compose run --rm backend python -m app.etl.load_city --ibge 2611606    # carga de um município
docker compose run --rm backend python -m app.etl.report --uf PE              # tabela de cobertura por cidade
docker compose run --rm -T backend python -m app.etl.report --all > docs/COBERTURA.md   # cobertura de todas as cidades
docker compose run --rm backend python scripts/audit_establishments.py --ibge 2611606 --bairro Iputinga --type hospital  # auditoria (dev)
docker compose run --rm backend python -m app.etl.seed_catalog                # recarrega o catálogo depois de editar os CSVs
docker compose run --rm backend pytest                                        # testes do backend (banco locus_test)
cd frontend; npx vitest run                                                   # testes do frontend
cd frontend; node perf/journey.mjs                                            # ponta a ponta (landing, app, explorador, celular)
cd frontend; node perf/a11y.mjs                                               # axe-core WCAG AA nas telas principais
sh design/check-leak.sh                                                       # nada do protótipo no produto (antes de cada commit visual)
docker compose run --rm backend alembic revision -m "descricao"               # nova migration (escreva o SQL à mão)
docker compose run --rm backend python -m app.credits grant --email X --amount 5  # concede créditos (sem pagamento)
docker compose --profile dev up frontend-dev                                  # Vite com HMR em http://localhost:5173
cd landing; npm install; npm run serve                                        # landing em http://localhost:4173 (nunca por file://)
cd landing; npm run build-geo                                                 # regenera landing/data (IBGE + bairros do banco)
```

## Convenções

- **Idioma:** identificadores em inglês; textos de interface em português do Brasil; comentários curtos em português.
- **Banco:** toda mudança de esquema passa por migration Alembic. O SQL é escrito à mão: PostGIS e views materializadas ficam mais claros assim.
- **Tipos de negócio, CNAEs e fonte (CNPJ/CNES):** são dados (CSV), não código. "Estabelecimento" = local distinto (CEP + logradouro + número; ver docs/DATA.md). Nunca escreva `if segmento == ...` no motor.
- **Tema:** cores só por tokens de função (`tokens.css`); o escuro redefine os tokens em `:root[data-theme='dark']`. Na landing, o escuro remapeia a paleta das seções `.pg`.
- **Textos proibidos na interface (além do item 2):** "protótipo" em qualquer tela; flags internas (`PROTOTYPE`, `DEMO_MODE`) nunca viram texto.
- **Nada específico de cidade:** toda cidade com `city_data_status` fica disponível no explorador; nunca escreva código para uma cidade em particular.
- **Dados brutos:** os .zip do CNPJ e as malhas ficam em `data/raw/` e nunca são apagados pelo ETL.
- **Mapa:**
  - recolorir = `setFeatureState`;
  - números = `setData` na fonte de pontos;
  - nunca recriar camadas ou fontes.
- **Créditos:** a cobrança é decidida só no servidor (`app/credits.py`); o frontend só confirma e mostra. Regras em `credit_settings`, nunca no código.
- **Uploads:** nunca SVG; validar o conteúdo real, recodificar e guardar em `data/uploads/` (fora do Git).
- **Frontend:** componentes da conta em `src/components/`, estilo em `styles/components.css` só com tokens (o visual final ainda vai mudar).
- **Atalhos com limite conhecido:** marque com `# shortcut: <limite>, <quando trocar>`.

## Versionamento (responsabilidade do agente, sem precisar pedir)

- **Commit a cada etapa coerente** (uma funcionalidade, uma correção, uma migration), mensagem clara em português, e **push para `origin main`** logo em seguida. Sem `origin`: `git remote add origin https://github.com/PedroWellington/prototipo_inovacao.git`.
- **Antes do primeiro push e sempre que o `.gitignore` mudar:** conferir que não vai segredo nem peso (`.env`, chaves, `data/raw/`, `data/uploads/`, dumps do banco, imagens de usuários, qualquer arquivo > 50 MB). Achou algo: parar e avisar. O repositório é público.
- **Push falhou** (credencial, rede): informar o erro exato e seguir com commits locais.
- **Fim de cada resposta:** uma linha com o último commit e se o push foi feito.
- **Atualizar `docs/PROGRESSO.md` ao fim de cada fase e antes de qualquer pausa; commit e push logo em seguida.**

## Fora do escopo desta etapa (só gancho documentado em EXTENSIONS.md)

- Planos, cotas e pagamento.
- Agente de IA.
- Relatório em PDF.
- Google Places.
- Contas de equipe.
- Verificação de e-mail, redefinição de senha e login com Google.
- Aluguel.
- Refino por CNEFE/CEP.

**Fora para sempre:** previsão de lucro, de faturamento ou de chance de sucesso.
