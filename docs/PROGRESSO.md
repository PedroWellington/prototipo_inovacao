# Progresso (retomada à prova de interrupção)

Atualizar ao fim de cada fase e antes de qualquer pausa; commit e push logo em seguida.
Os prompts de cada etapa ficam em `design/prompts/` (fora deste repositório até hoje: ver "Pendências").

## Quadro por fase

| Etapa | Fase | Estado | Evidência |
|---|---|---|---|
| Redesign completo | 1. Paleta única (`shared/design-tokens.css`) | ✅ | `87e7a50`; `docs/visual/fase1-*` |
| Redesign completo | 2. Visão geral com dados reais | ✅ | `fab9d46`; `docs/visual/fase2-*` |
| Redesign completo | 3. Explorador em três colunas, ranking FLIP, câmera contínua | ✅ | `0f9ae09`; `docs/visual/fase3-*`; `docs/PERFORMANCE.md` |
| Redesign completo | 4. Landing na paleta única, contraste AA | ✅ | `3d3ad38`, `16605c6`; `docs/ACESSIBILIDADE.md` |
| Holograma e inclinação | Quadros WebP, camada isolada, máquina de estados, medição | ✅ | `9d77f88` a `643c96f`; `docs/HOLOGRAMA.md`; `docs/PERFORMANCE.md` (falta medir em celular real) |
| Modo escuro, logo e menu | Menu (Visão geral · Minhas análises · Dados e fontes · Explorador) | ✅ | `dd916cb`; `journey.mjs` |
| Modo escuro, logo e menu | Logo, favicon, manifesto, og:image | ✅ | `217a1bd`; `docs/MARCA.md`; `docs/visual/logo-*` |
| Modo escuro, logo e menu | Modo escuro | ❌ | só ganchos: `hologram.theme()` e conjunto por tema no manifesto do holograma; fundo previsto `#181512` (apple-touch-icon e `manifest.webmanifest`) |

| Holograma trocado (2026-11-15) | Novos 360 PNG 720×720 -> WebP 486×396, 4,9 MB, versão `ff24815a9b42` | ✅ | `docs/visual/holograma2-*`; dist sem quadro antigo |
| Deploy | Fase 0: auditoria (nginx, variáveis, banco, segredos, público) | ✅ | esta seção; relatório na conversa de 2026-11-15 |
| Deploy (protótipo) | Banco do Brasil inteiro em dois bancos pequenos para o Neon grátis (`vicus-dados` 253 MB, `vicus-contas` 24 MB), dois pools no backend, 20 consultas idênticas | ✅ | `docs/DATA.md` (fim); `scripts/build_prod_db.py`, `scripts/compare_rank.py` |
| Deploy (protótipo) | Fase 1: frontend na Vercel (`vercel.json`) | ❌ | o prompt de deploy de protótipo (Vercel Hobby, DEMO_MODE, banner) não está em `design/prompts/` |
| Deploy | Fase 2: backend e banco em servidor próprio (Compose de produção, Caddy, backups, restore) | ❌ | |
| Deploy | Fase 3: domínio, HTTPS, e-mail transacional, páginas legais (rascunho) | ❌ | |
| Deploy | Fase 4: login com Google (preparado e desligado por flag) | ❌ | |
| Deploy | Fase 5: verificação em produção | ❌ | |
| Deploy | Fase 6: operação (`docs/DEPLOY.md`, CI, monitoramento) | ❌ | |

## Mudança de rumo (2026-11-15): protótipo no Neon grátis, sem servidor próprio

Decisão do Pedro: nada de recorte por cidade; Brasil inteiro em `vicus-dados` (≤ 800 MB) e contas em `vicus-contas`, no plano grátis do Neon (1 GB por projeto, 100 CU-hora/mês por projeto). Resultado: 253 MB e 24 MB; detalhes e comandos em `docs/DATA.md`. As opções de servidor da Fase 0 abaixo ficam como registro.

## Fase 0 do deploy: o que foi medido (2026-11-15)

- **Banco filtrado:** 2.774 MB em disco; dump `pg_dump -Fc -Z 6`: **619 MB**. Maiores tabelas: `establishments` 1.714 MB (2,46 M linhas), `neighborhoods` 760 MB (53,9 mil), `municipalities` 156 MB, `census_income` 50 MB, `census_tracts` 44 MB. As 5.570 cidades estão carregadas.
- **nginx hoje** (`frontend/nginx.conf`): `/app` -> 301 `/app/`; `/app/assets/` cache 1 ano imutável; `*.webmanifest` tipo próprio; `/app/` -> `try_files $uri /app/index.html` (fallback do SPA) com `no-cache`; `/api/` -> proxy para o backend (corpo até 3 MB, cabeçalhos X-Forwarded-*); `/assets/` da landing cache 1 dia; `*.md` como markdown; `/` -> `try_files $uri $uri/ =404` com `no-cache`; gzip nível 6 para css/js/json/geojson/svg/md. O holograma vai por `?v=<hash>` (`frontend/public/holograma/manifest.json`), então pode ter cache longo.
- **Variáveis.** Backend: `DATABASE_URL`, `PRODUCT_NAME` (obrigatórias), `ENV` (`production` liga o cookie `Secure`), `DATA_DIR`, `SESSION_TTL_HOURS`, `TEST_DATABASE_URL` (testes). Frontend (build): só `PRODUCT_NAME`; nenhum `VITE_*` em produção (`VITE_API_TARGET`/`VITE_POLL` são do Vite em desenvolvimento). Landing: `APP_URL` e `SESSION_URL` fixos em `landing/js/config.js` (mesma origem).
- **Segredos:** `.env` nunca entrou no Git; a varredura do histórico por padrões de chave (AWS, Google, GitHub, Slack, chaves privadas, URLs com senha) não achou nada. Sem `gitleaks` instalado.
- **Público no repositório (decidir):** `docs/LOCUS-logica-do-produto.pdf` (regras do produto), `design/brand/*.png` (painel de marca, 5,8 MB), `docs/COBERTURA.md`. Sem `LICENSE`. Nada de dado bruto, dump ou prompt.
- **Segurança já existente:** cookie `httpOnly` + `SameSite=Lax` (+ `Secure` em produção), CSRF, argon2id, limite de tentativas no login; sem CSP/HSTS, sem CORS (mesma origem), pool de 10 conexões, sem `statement_timeout`.
- **Mapa-base:** `tile.openstreetmap.org` direto no MapLibre (`frontend/src/map/mapView.js`); precisa trocar antes de produção.

## Agora

Fase 0 entregue. **Parado à espera de decisões** (abaixo). Depois: modo escuro (prompt em `design/prompts/`) ou Fase 1 do deploy, conforme a ordem que for definida.

## Decisões tomadas

- Logo no produto = ícone PNG (2x/3x) + nome em texto na cor do tema; os PNGs originais ficam em `design/brand/` (versionados desde `654da32`, 5,8 MB).
- `manifest.webmanifest` servido como `application/manifest+json` por um `location` próprio no nginx.
- Build do Compose no Docker Desktop 29 (Compose v5) falha com "failed to execute bake" neste Windows; as imagens foram construídas com `docker build` direto e `docker compose up -d --no-build`.

## Decisões que dependem do Pedro

- Onde roda a API FastAPI do protótipo (o Neon é só o banco): precisa de um host para o container ou de adaptação para funções da Vercel.
- Colocar o prompt de deploy de protótipo (Vercel Hobby, DEMO_MODE, banner de protótipo) em `design/prompts/`.
- Licença do repositório (padrão: "todos os direitos reservados").
- Manter públicos `docs/LOCUS-logica-do-produto.pdf` e `design/brand/`.
- Vercel: uso comercial exige o plano Pro (US$ 20/mês por pessoa); o Hobby é só para uso pessoal.
- Provedor de tiles do mapa-base (Fase 2).

## Pendências

- Colocar os prompts (`.md`) em `design/prompts/` e versionar: sem eles, os checklists de aceite não estão no repositório.
- Modo escuro (ver quadro). Decidir: preferência do sistema, botão, ou os dois; mapa-base OSM no escuro; conjunto escuro do holograma.
- `og:image` com URL absoluta quando houver domínio.
- Medir a transição do holograma em celular de verdade (`docs/PERFORMANCE.md`).

## Último commit

Ver `git log -1`; este arquivo é atualizado no mesmo commit de cada fase.
