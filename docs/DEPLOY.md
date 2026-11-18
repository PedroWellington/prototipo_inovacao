# Deploy do protótipo: Vercel (site + API) e Neon (dois bancos)

Arquitetura escolhida para o protótipo (decisão de 2026-11-15), toda no plano grátis:

```
Navegador ──► Vercel (um domínio só)
               ├─ /            landing estática           (saída de scripts/build-vercel.mjs)
               ├─ /app/        app Vite estático
               └─ /api/*       função Python (api/index.py = FastAPI de backend/app)
                                 ├─ DATABASE_URL       ──► Neon "vicus-contas" (usuários, sessões, créditos)
                                 └─ DATA_DATABASE_URL  ──► Neon "vicus-dados"  (Brasil inteiro, 253 MB, só leitura)
```

Mesma origem para site e API: cookie `httpOnly` + CSRF continuam valendo, sem CORS. O banco completo do ETL (2,8 GB)
fica no seu computador; só os dois bancos pequenos vão para o Neon (`docs/DATA.md`, seção final).

## Limites conhecidos deste arranjo (e o que fazer se estourarem)

| Limite | Valor | Se estourar |
|---|---|---|
| Neon grátis | 1 GB por projeto, 100 CU-hora/mês por projeto, computador dorme após 5 min parado (primeira resposta leva 1 a 3 s) | plano Launch do Neon (US$ 19) ou servidor próprio (Fase 0 do deploy, em `docs/PROGRESSO.md`) |
| Função Python da Vercel (Hobby) | 250 MB por função, 60 s por chamada (`maxDuration` em `vercel.json`), memória 1 GB, arranque a frio de 1 a 2 s | tiles e ranking já têm cache (`Cache-Control`, cache em memória); se a latência dos tiles passar de 300 ms no p95, trocar por tiles estáticos (PMTiles) |
| Vercel Hobby | 100 GB de banda/mês, uso não comercial | plano Pro |
| Uploads | o disco da função não persiste: `UPLOADS_ENABLED=false` desliga a logo da empresa (o app mostra as iniciais) | guardar a imagem no banco das contas (coluna `bytea`) |
| Limite de tentativas de login | em memória, por instância da função (zera a cada arranque) | tabela no banco das contas ou Upstash Redis (grátis) |
| Mapa-base | `tile.openstreetmap.org` direto (política de uso do OSM não cobre produção) | escolher provedor (MapTiler, Stadia ou PMTiles próprio) antes de divulgar o endereço |

Nada disso exige mudar código para o protótipo funcionar; são as próximas decisões.

## Passo a passo (você faz uma vez)

### 1. Neon: dois projetos na região São Paulo

1. Entre em `https://console.neon.tech` e clique em **New Project**.
2. **Project name:** `vicus-dados`. **Postgres version:** 16. **Region:** **AWS South America (São Paulo)**. Clique em **Create project**.
3. Na tela do projeto, clique em **Connect** (botão no topo). Em **Connection string**, marque **Pooled connection** e copie a URL (começa com `postgresql://` e tem `-pooler` no host). Guarde como **DADOS_POOLED**. Desmarque **Pooled connection** e copie de novo: guarde como **DADOS_DIRETA** (sem `-pooler`; é a que carrega os dados).
4. Repita os passos 1 a 3 com o nome `vicus-contas`: guarde **CONTAS_POOLED** e **CONTAS_DIRETA**.
5. Em cada projeto, **Settings -> Storage**: **History retention** em **1 hour** (o histórico conta no 1 GB).

Não cole essas URLs no chat nem no Git. Elas vão só para o painel da Vercel e para o PowerShell do passo 2.

### 2. Carregar os bancos a partir do seu computador (PowerShell, na raiz do repositório)

Os containers locais precisam estar de pé (`docker compose up -d`). Troque `<CONTAS_DIRETA>` e `<DADOS_DIRETA>` pelas URLs
do passo 1 (entre aspas; acrescente `?sslmode=require` no fim se a URL copiada não tiver).

```powershell
# 2.1 Esquema das contas (migrations) no Neon
docker compose exec -e DATABASE_URL="postgresql+psycopg://<CONTAS_DIRETA sem o postgresql:// inicial>" backend alembic upgrade head

# 2.2 Tabelas de referência nas contas (municípios, estados, segmentos, tipos, status das cidades). Só insere o que falta.
docker compose exec backend python scripts/build_prod_db.py contas "<CONTAS_DIRETA>"

# 2.3 Banco de leitura inteiro (253 MB; leva de 5 a 20 minutos conforme a sua internet). Recria tudo.
docker compose exec backend python scripts/build_prod_db.py dados "<DADOS_DIRETA>"
```

Para a URL do passo 2.1, o formato é `postgresql+psycopg://usuario:senha@host/banco?sslmode=require` (a URL do Neon
com `+psycopg` logo depois de `postgresql`).

Conferir: `docker compose exec -e DATA_DATABASE_URL="<DADOS_DIRETA com +psycopg>" backend python scripts/compare_rank.py`
deve terminar com `TUDO IGUAL`.

### 3. Vercel: importar o repositório

1. Entre em `https://vercel.com`, **Add New... -> Project**, escolha o repositório `prototipo_inovacao` e clique em **Import**.
2. **Framework Preset:** `Other`. **Root Directory:** deixe `./`. Build Command, Output Directory e Install Command já
   vêm de `vercel.json` (aparecem como "Override" preenchidos: `node scripts/build-vercel.mjs` e `.vercel-out`).
3. Abra **Environment Variables** e adicione, uma por uma (Environment: Production, Preview e Development marcados):

   | Name | Value |
   |---|---|
   | `PRODUCT_NAME` | `VICUS` |
   | `ENV` | `production` |
   | `DATABASE_URL` | **CONTAS_POOLED**, com `postgresql+psycopg://` no lugar de `postgresql://` e `?sslmode=require` no fim |
   | `DATA_DATABASE_URL` | **DADOS_POOLED**, no mesmo formato |
   | `SESSION_TTL_HOURS` | `168` |
   | `PROTOTYPE` | `true` |
   | `DEMO_MODE` | `true` |
   | `UPLOADS_ENABLED` | `false` |
   | `GOOGLE_LOGIN_ENABLED` | `false` |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL` | só quando ligar o login com Google: ID e segredo do OAuth Client (Google Cloud Console) e `https://vicus-inovacao.vercel.app`; no Google: origem JavaScript `https://vicus-inovacao.vercel.app`, redirect URI `https://vicus-inovacao.vercel.app/api/auth/google/callback` |
   | `PDF_ENABLED` | `true` (relatório, roteiro e slides; fpdf2 roda na função, ver `docs/RELATORIO.md`) |
   | `GOOGLE_MAPS_API_KEY` | vazio por enquanto (tempo de carro desligado; ler `docs/GOOGLE-MAPS.md`, seção 4, antes de ligar) |

4. Clique em **Deploy**. O primeiro build leva de 2 a 4 minutos. No fim aparece o endereço `https://<projeto>.vercel.app` (o protótipo está em `https://vicus-inovacao.vercel.app`).
5. Confira: `https://<projeto>.vercel.app/` (landing), `/app/` (login), `/api/health` (`{"status":"ok"}`)
   e `/api/config` (as flags acima).

Região da função: `vercel.json` pede `gru1` (São Paulo). Se o painel mostrar outra região em **Settings -> Functions**,
escolha **São Paulo (gru1)** ali e faça **Redeploy**.

### 4. Depois

- **Domínio próprio, e-mail e páginas legais:** Fase 3 (`docs/PROGRESSO.md`).
- **Atualizar os dados** (novo mês do CNPJ): rodar o ETL local (`python -m app.etl.load_br`) e repetir só o passo 2.3.
- **Mudar o código:** `git push` na `main` publica sozinho na Vercel. **Voltar atrás:** Vercel -> **Deployments** -> deploy
  anterior -> **... -> Promote to Production**. O banco não muda com deploy; migrations novas são o passo 2.1 de novo.

## O que cada arquivo faz

- `vercel.json`: build, saída estática, função Python (runtime oficial detectado pelo `api/index.py`, Python 3.12 padrão; só `maxDuration` 60 s, pois `runtime` é só para runtimes da comunidade e `memory` não entra com Fluid compute; região `gru1`), reescritas (`/api/*` ->
  função; `/app/*` -> `index.html` do app), cache (assets com hash, marca e quadros do holograma por 1 ano; HTML sem cache)
  e cabeçalhos de segurança (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options).
- `api/index.py`: expõe o `app` FastAPI de `backend/app` para a Vercel. `requirements.txt` da raiz: só o que a API usa.
- `scripts/build-vercel.mjs`: `vite build` + landing + paleta em `.vercel-out` (o mesmo que o Dockerfile do frontend monta).
- `.vercelignore`: nada de dados, design, docs, testes ou ETL sobe para a função.
- `frontend/nginx.conf` + `nginx-security.inc`: a versão Docker serve os mesmos cabeçalhos (paridade; é onde a CSP é testada
  localmente com `node perf/journey.mjs` e `node perf/a11y.mjs`).

Variáveis de ambiente: só os nomes acima. Valores ficam no painel da Vercel e no `.env` local, nunca no Git.
