# Progresso (retomada à prova de interrupção)

Atualizar ao fim de cada fase e antes de qualquer pausa; commit e push logo em seguida.
Os prompts de cada etapa ficam em `design/prompts/` (fora deste repositório até hoje: ver "Pendências").

## Quadro por fase

| Etapa | Fase | Estado | Evidência |
|---|---|---|---|
| Redesign premium (prompt de 2026-11-16) | 0. Exame da arquitetura + extras 13.1 (barra de progresso da landing) e 13.2 (domínio) | ✅ | `bfff907`; relatório na conversa |
| Redesign premium | 1. Bugs (painel sem corte, tooltip compacto) e holograma trocável | ✅ já feito antes (`643c96f`, `654da32`); `perf/overflow.mjs` passa em 8 larguras × 3 zooms depois do ajuste da barra superior em telas estreitas | `docs/HOLOGRAMA.md`; `build-holograma.py --autoteste` |
| Redesign premium | 2. Tokens claro/escuro (paleta pedida), mapa no escuro por `setPaintProperty`, botão de tema no login e onboarding, MARCA (aviso INPI) | ✅ | `4c76a9b`; o raster do OSM fica escurecido por pintura (mesmos tiles) |
| Redesign premium | 3. Menu Visão geral · Análises · Comparar · Dados e fontes · Explorar, rotas próprias, explorador vivo | ✅ | `0e32533`; `journey.mjs` (28 passos) |
| Redesign premium | 4. Visão geral com esqueleto, cascata e números que contam (`src/motion.js`, `components/page.js`) | ✅ | `9b4310e` |
| Redesign premium | 5. Explorador ligado às páginas novas (detalhe completo, Editar critérios, critérios salvos recalculam) | ✅ | `2c55000` |
| Redesign premium | 6. Detalhe do bairro, Editor de critérios, Minhas análises, Dados e fontes | ✅ | `6505af8`; `docs/visual/redesign/` |
| Redesign premium | 7. Comparar cidades (tela própria, só cidades abertas, sem nota entre cidades) | ✅ | `e2a65ef` |
| Redesign premium | 8. Tema em círculo nas telas novas, sem recriar o mapa; 6 capturas de movimento | ✅ | `1826db6`; `perf/record.mjs`; `docs/visual/movimento-*.webm` |
| Redesign premium | 9. Verificação: axe 0 violações em 68 telas, journey 28/28, vitest 34/34, capturas; fluidez com CPU 4× | ✅ fechada em 2026-11-17: opções 1 e 2 aplicadas e o pico real do tema (mapa vivo em segundo plano) corrigido; sobra um quadro de pintura na troca de página, registrado | `docs/PERFORMANCE.md`, "Fase 9 fechada"; `perf/fluidez.mjs` |
| Sem cara de IA (2026-11-16) | A1–A5 em todas as telas (acento chapado, número herói, uma métrica dominante, sombra só no que flutua, cabeçalho que informa + forma do número) | ✅ | `65ed2e3`, `bf038e8`; `docs/visual/sem-cara-de-ia/` (antes/depois, dois temas) |
| Zoom do bairro | Zoom fixo `HOLO_ZOOM = 14.5` (em `map/hologram.js`) no ponto na superfície; holograma sempre do mesmo tamanho | ✅ | `4162b6f` |
| Tutorial de primeira vez (2026-11-17) | 5 passos, uma vez por conta (`users.tutorial_concluido_em`, migração 0011), Pular/Próximo/Esc, foco preso, barra inferior no celular, "Ver tutorial novamente" em Minha conta | ✅ | `84d6b66`; `journey.mjs` (30/30) |
| Assistente de IA (2026-11-17) | Botão flutuante e painel (sobrevive à troca de aba), `/api/assistente` com contexto real montado no servidor, regras conferidas na resposta, limites por conta e IP, `AI_ASSISTANT_ENABLED=false` por padrão | ✅ código; ⬜ chave do Groq na Vercel | `32901d3`; `docs/ASSISTENTE-IA.md`; `tests/test_assistant.py` |
| Capturas leves | `docs/visual` de 23,5 MB para 9,2 MB (WebP e gravações reencodadas), nada apagado | ✅ | `f86932e` |
| Hero 360 (branch `hero-360`, experimental, 2026-11-17) | Hero inteiro com o mapa real (MapLibre, tiles do OSM, malhas do IBGE) numa câmera só, do Brasil ao bairro, até o mesmo holograma do explorador; meta de fluidez em 60 Hz | ✅ na branch, aguardando decisão de merge; ⬜ **provedor de tiles (obrigatório antes de publicar)** | `docs/HERO-360.md`; `perf/hero-360*.mjs`; `docs/visual/hero-360/` |
| Landing e rolagem (PARTE A, 2026-11-16) | A1 a A12: progresso da esquerda para a direita, sem barra de rolagem, sem "Protótipo", tema na landing, textos novos, painel de produto (Conheça, Como funciona, Dados e fontes, Planos pagos, FAQ, rodapé legal), aviso legal fora do mapa, Comprar mais créditos, zoom ao bairro com holograma proporcional, menu Explorar | ✅ | `7704d8d`, `b2244de`, `917bdaa` e o commit seguinte; `docs/visual/parte-a/`; `docs/PERFORMANCE.md` (2026-11-16) |
| Relatório em PDF + Google Maps (2026-11-17) | 1. Termos do Google lidos, SKU (Compute Route Matrix Essentials, 10.000 elementos/mês), conta da cota e passo a passo do Console | ✅ | `41345d6`; `docs/GOOGLE-MAPS.md` |
| Relatório em PDF + Google Maps | 2. Dados dos 5 bairros (fonte própria), população dos bairros do Censo 2022, concorrência por ramo, posição e contribuição por critério no SQL, código dos parâmetros | ✅ | `e56b084` |
| Relatório em PDF + Google Maps | 3. Routes API em lote, contador mensal com trava em 80%, limites por conta e IP, degradação suave, testes com falso | ✅ código; ⬜ **chave desligada até o Pedro decidir o conflito dos termos (GOOGLE-MAPS.md, seção 4)** | `8b7ad0b`; `tests/test_report.py` |
| Relatório em PDF + Google Maps | 4. PDF (fpdf2, Inter embutida, mapas SVG próprios), roteiro e slides em PDF | ✅ | `3666bed`; `docs/RELATORIO.md`; `docs/visual/relatorio/` |
| Relatório em PDF + Google Maps | 5. Botão no explorador e em Minhas análises, progresso, download, nova aba, erros | ✅ | `13d9fa0` |
| Relatório em PDF + Google Maps | 6. Roteiro de visita e modo apresentação (dois temas, setas, toque, tela cheia) | ✅ | `07e9117`; axe 0 violações nas 4 telas novas × 4 perfis |
| Relatório em PDF + Google Maps | 7. Verificação: p95 0,58 s sem Google, nenhuma tarefa longa no navegador, ≤ 2 MB (pior caso 322 KB), capturas de cada página | ✅ | `docs/PERFORMANCE.md` (relatório) |
| Ajustes do relatório (2026-11-18) | 1. "Relatório desligado." = `PDF_ENABLED=false` na Vercel; base desatualizada vira mensagem clara (503) sem PDF incompleto; carga com URL escondida | ✅ código; ⬜ **Pedro: `PDF_ENABLED=true` + Redeploy e os passos de `docs/DEPLOY.md`, "Ligar o relatório em produção"** | `docs/DEPLOY.md` |
| Ajustes do relatório | 2. Google "só na tela": tempo de carro só no Roteiro dentro do app; nenhum PDF chama o Google; seção do Google nos Termos só com a chave ligada | ✅ | `docs/GOOGLE-MAPS.md` (decisão de 2026-11-18); `test_google_only_on_screen_never_in_pdfs` |
| Ajustes do relatório | 3. Relatório técnico (página de tabelas comparativas) e slides narrativos (12 telas, 16:9, número herói, Cascade/CountUp/GrowBar) | ✅ | `docs/RELATORIO.md`; `docs/visual/relatorio/` |
| Ajustes do relatório | 4. Botão "Assistente de IA" (pílula no desktop, ícone com aria-label/title no celular; título e aviso no painel) | ✅ | axe: 104 telas, 0 violações, com o assistente visível |
| Redesign completo | 1. Paleta única (`shared/design-tokens.css`) | ✅ | `87e7a50`; `docs/visual/fase1-*` |
| Redesign completo | 2. Visão geral com dados reais | ✅ | `fab9d46`; `docs/visual/fase2-*` |
| Redesign completo | 3. Explorador em três colunas, ranking FLIP, câmera contínua | ✅ | `0f9ae09`; `docs/visual/fase3-*`; `docs/PERFORMANCE.md` |
| Redesign completo | 4. Landing na paleta única, contraste AA | ✅ | `3d3ad38`, `16605c6`; `docs/ACESSIBILIDADE.md` |
| Holograma e inclinação | Quadros WebP, camada isolada, máquina de estados, medição | ✅ | `9d77f88` a `643c96f`; `docs/HOLOGRAMA.md`; `docs/PERFORMANCE.md` (falta medir em celular real) |
| Modo escuro, logo e menu | Menu (Visão geral · Minhas análises · Dados e fontes · Explorador) | ✅ | `dd916cb`; `journey.mjs` |
| Modo escuro, logo e menu | Logo, favicon, manifesto, og:image | ✅ | `217a1bd`; `docs/MARCA.md`; `docs/visual/logo-*` |
| Modo escuro, logo e menu | Modo escuro | ❌ | só ganchos: `hologram.theme()` e conjunto por tema no manifesto do holograma; fundo previsto `#181512` (apple-touch-icon e `manifest.webmanifest`) |

| Holograma trocado (2026-11-15) | Novos 360 PNG 720×720 -> WebP 486×396, 4,9 MB, versão `ff24815a9b42` | ✅ | `docs/visual/holograma2-*`; dist sem quadro antigo |
| Holograma trocado de novo (2026-11-15, 20:57) | 360 PNG 900×900 em `design/holograma-360/.../frames-png`: a mesma loja, mas com o cone de projeção desenhado na imagem (o app já desenha o cone em CSS) e 18,7 MB em WebP (limite 6 MB; 8,1 MB mesmo a 520 px, q70 e alfa 50) | ⬜ descartado: Pedro vai exportar de novo sem cone nem brilho (720×720, fundo transparente); reprocessar quando avisar | o `ff24815a9b42` continua no app e no deploy; a pasta `design/holograma-360/` já está no `.gitignore` |
| Deploy | Fase 0: auditoria (nginx, variáveis, banco, segredos, público) | ✅ | esta seção; relatório na conversa de 2026-11-15 |
| Deploy (protótipo) | Banco do Brasil inteiro em dois bancos pequenos para o Neon grátis (`vicus-dados` 253 MB, `vicus-contas` 24 MB), dois pools no backend, 20 consultas idênticas | ✅ | `docs/DATA.md` (fim); `scripts/build_prod_db.py`, `scripts/compare_rank.py` |
| Deploy (protótipo) | Fase 1/2: site e API na Vercel (`vercel.json`, `api/index.py`, `scripts/build-vercel.mjs`), flags do protótipo (`/api/config`, selo "Protótipo", DEMO_MODE, uploads/Google/PDF desligados), cabeçalhos de segurança (Vercel e nginx), `docs/DEPLOY.md` passo a passo | ✅ (configurado e testado localmente; falta você criar os projetos) | `docs/DEPLOY.md`; journey/a11y com CSP no nginx |
| Deploy | Fase 3: domínio, HTTPS, e-mail transacional, páginas legais (rascunho) | ❌ | |
| Deploy | Fase 4: login com Google (OIDC + PKCE, ID token validado no servidor; cadastro normal continua) | ✅ código; ⬜ chaves na Vercel | `backend/app/auth/google.py`, `tests/test_google_login.py`; liga com `GOOGLE_LOGIN_ENABLED` + `GOOGLE_CLIENT_ID`/`SECRET` + `PUBLIC_BASE_URL` |
| Deploy | Fase 5: verificação em produção | 🔄 | no ar em `https://vicus-inovacao.vercel.app` (2026-11-16); corrigidos: `.vercelignore` apagava `landing/data`, pooler do Neon rejeitava `options` na conexão (`7d6bb3f`); falta cadastro/login/explorador de ponta a ponta com números |
| Deploy | Fase 6: operação (`docs/DEPLOY.md`, CI, monitoramento) | ❌ | |
| Créditos (2026-11-19) | Boas-vindas (5 por conta nova, uma vez) e fim do "Plano Gratuito" | ✅ | `1ff3361`; migração 0014; `tests/test_credits.py`, `test_google_login.py` |
| Créditos (2026-11-19) | Comprar créditos com pagamento SIMULADO (`PAYMENTS_MODE=demo`): pedido no servidor, checkout em nova aba, crédito idempotente, saldo ao vivo; interface de provedor para pagamento real | ✅ código; ⬜ migração 0015 e variável na Vercel | `ec99761`; `tests/test_billing.py`; `frontend/perf/compra.mjs`; capturas em `docs/visual/compra/` |

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
| Quatro ajustes (2026-11-19) | 1. Assistente resiliente: até 2 repetições em 5xx/tempo esgotado (0,7 s e 1,5 s), depois uma vez o `AI_FALLBACK_MODEL` (`gemini-3.5-flash-lite`), tudo em `AI_TOTAL_SECONDS=45` (abaixo dos 60 s da função); `AI_TIMEOUT_SECONDS` baixou para 10 | ✅ | `767d59a`; `tests/test_assistant.py` |
| Quatro ajustes (2026-11-19) | 2. Mapinhas (Comparar, bairro, slides, PDF do bairro) com preenchimento abaixo do cartão, limites ≥ 3:1 e contorno da cidade mais forte (tokens `--mini-*`) | ✅ | `docs/visual/comparar/` (antes e depois, dois temas, desktop e celular) |
| Quatro ajustes (2026-11-19) | 3. Comparar: seção "Lado a lado" (8 indicadores, diferença em número e razão, "maior" em texto, fonte em cada linha, "calculado a partir de" nos derivados, "sem dado suficiente") | ✅ | `src/compareRows.js` + teste; `perf/comparar.mjs`; axe 0 |
| Quatro ajustes (2026-11-19) | 4. Renda só com o valor ("Renda mediana: R$ 1.500/mês") e a fonte, em tela, PDF, slides, assistente, landing e docs; frases que interpretavam a renda removidas; regra no prompt; testes de guarda | ✅ | `src/noIncomeSpin.test.js`, `tests/test_assistant.py`; `docs/visual/comparar/pdf-bairro-renda.webp` |
| Assistente: provedor reserva e campo (2026-11-19) | A. Principal (OpenRouter) com `AI_MODEL` + 1 nova tentativa em 5xx/tempo, `AI_FALLBACK_MODEL`, depois o provedor reserva (Gemini: `AI_FALLBACK_API_KEY`, `AI_FALLBACK_BASE_URL`, `AI_FALLBACK_PROVIDER_MODEL`); 429 e 4xx pulam ao reserva; `rede-timeout`/`rede-conexao` com a classe no log; uma pergunta conta 1 no limite | ✅ código; ⬜ variáveis na Vercel | `0a4d4ed`; `tests/test_assistant.py` |
| Assistente: provedor reserva e campo (2026-11-19) | B. Caixa de pergunta com borda sempre visível na cor do foco (≥ 3:1), foco mais forte (borda + anel), placeholder "Digite sua pergunta aqui" (≥ 4,5:1), rótulo acessível com o assunto | ✅ | `perf/assistente-campo.mjs` (axe 0, dois temas, desktop e celular); `docs/visual/assistente-campo/` |
| Tema escuro azul (branch `teste/tema-escuro-azul`, 2026-11-19, teste) | Egyptian Blue, Stone Blue e Scarlet como tokens; derivados calculados; vidro, pílulas e botão vermelho só no escuro; claro sem mudança | ✅ na branch, sem merge | `docs/DESIGN-SYSTEM.md`; `docs/visual/tema-escuro-azul/`; axe 0 |
| Tema escuro azul, 2ª rodada (branch, 2026-11-19) | Fundo `#02101e` (Egyptian Blue + 50% de preto), cartões em Egyptian Blue; mapas com moldura preta, contorno da cidade preto e limites internos claros (≥ 3:1) | ✅ na branch, sem merge | `docs/DESIGN-SYSTEM.md`; `docs/visual/tema-escuro-azul/r2-*`; axe 0 |
| Vídeo por tema (2026-11-19) | `landing/video/escuro.html` (+ `escuro.js`, script à parte por causa da CSP) no tema escuro, `index.html` no claro; mesma `narracao.mp3` e mesmos CUES; `?embed=1`/`?auto=1`/`?cena=N`, rótulo "Voz" escondido, movimento reduzido sem tremores nem "whip"; capa `poster-escuro.jpg` (cena 8); aviso "Animação ilustrativa" | ✅ | `frontend/perf/video.mjs` (as 11 cenas dos dois vídeos com MP3, botão de som); axe 0 |
| Landing, mapa inicial e renda (2026-11-20) | 1. Vídeo como seção própria ("VÍDEO · 36 S", "Como a VICUS / funciona.", duração de `VIDEO_SECONDS`); 2. "Dentro do bairro, / cada rua conta."; 3. "Dados e fontes" só com "Dados com fonte sustentam a análise.", depois das perguntas frequentes (numeração 01 a 07); 4. Brasil numa cor só na abertura, Nordeste acende em 0,6 s no trecho que leva a ele (canvas e mapa real), contraste ≥ 3,25:1 medido nos dois temas; 5. "Renda mediana da cidade" / "do bairro" com a comparação "(bairro ÷ cidade − 1) × 100" e "calculado a partir de" em tela, PDF, slides e assistente; 6. CountUp só em inteiros ≥ 10; 7. frases antigas trocadas | ✅ | `151d208`, `97b6848`, `4343cc7`, `1284b8c`; `docs/visual/landing/`; axe 0 (landing inteira, dois temas, desktop e celular); `docs/DESIGN-SYSTEM.md` (contrastes do mapa); `docs/SCORING.md` (renda) |

## Agora

Landing, mapa inicial e renda (2026-11-20): vídeo com título de seção, frases novas, "Dados e fontes" depois das perguntas
frequentes, Brasil numa cor só ao abrir e Nordeste em destaque só na rolagem, renda do bairro comparada com a da cidade e
CountUp só em inteiros. Na Vercel não há variável nova: o próximo deploy da `main` publica tudo. As frases antigas sobram só em
arquivos fora do Git (`landing/VICUS-Recife-Edicao-Urbana.html`, a referência do protótipo original, e logs em `.playwright-mcp/`).
De quebra, o axe passou a rolar até o fim da landing e achou contraste baixo antigo no tema claro (etiquetas do FAQ, de "Dados e
fontes" e do bloco final); corrigido.

Antes:

Vídeo por tema e tema escuro azul (2026-11-19): branch `teste/tema-escuro-azul` mesclada na `main` a pedido do Pedro.
O tema escuro azul e o vídeo novo passam a valer em produção no próximo deploy da Vercel.

Antes:

Assistente (2026-11-19, segunda rodada): provedor reserva e caixa de pergunta. **Na Vercel:** `AI_FALLBACK_API_KEY` (chave do
Google AI Studio) e, se quiser outro modelo/URL do reserva, `AI_FALLBACK_PROVIDER_MODEL`/`AI_FALLBACK_BASE_URL`. Novo deploy depois.

Antes:

Quatro ajustes (2026-11-19): assistente com repetição e modelo de reserva, mapinhas mais escuros, "Lado a lado" no Comparar e renda
só com o valor em todo o site. **Na Vercel:** se `AI_TIMEOUT_SECONDS` existir lá com 20, trocar para 10 (ou apagar); `AI_FALLBACK_MODEL`
é opcional (o padrão já é `gemini-3.5-flash-lite` quando `AI_BASE_URL` é do Google). Novo deploy depois.

Antes:

Créditos (2026-11-19): boas-vindas, compra simulada e vídeo da landing ajustados e commitados; axe 0 violações nas 108 telas do
`perf/a11y.mjs` e na compra (`perf/compra.mjs`, dois temas, desktop e celular). **Próximo passo é seu:** migrações 0014 e 0015 no
vicus-contas e `PAYMENTS_MODE=demo` na Vercel (`docs/DEPLOY.md`, "Ligar a compra de créditos simulada"). Pagamento real: decidir o provedor.

Antes:

Redesign premium (prompt recuperado da conversa de 2026-11-16, 16:36): Fases 2 a 8 commitadas; Fase 9 parada na meta de fluidez com CPU 4× (ver `docs/PERFORMANCE.md`, "Redesign, Fase 9"). Próximo: Pedro escolhe o ajuste (círculo só em aparelho rápido, montar a página em dois quadros, ou meta de 16,7 ms) e a Fase 9 fecha.

Antes:

PARTE A (landing e rolagem) concluída e commitada em 2026-11-16. Próximo: PARTE B (relatório em PDF + Google Maps), só depois da confirmação do Pedro. Do redesign premium faltam o mapa-base no escuro (Fase 2) e as Fases 4 a 9, cujo prompt não está no repositório.

Antes: protótipo publicado em `https://vicus-inovacao.vercel.app` (Vercel Hobby + Neon). Pendente: Fase 5 completa (cadastro, ranking e explorador em produção, com tempos) e Fase 3.

Antes: deploy do protótipo configurado e commitado (`node scripts/build-vercel.mjs` gera `.vercel-out`, 9,9 MB, com os 360 quadros `ff24815a9b42`). **Próximo passo é seu:** criar os dois projetos no Neon e o projeto na Vercel seguindo `docs/DEPLOY.md` (passos 1 a 3). Depois: Fase 5 (verificação em produção com números) e Fase 3 (domínio, e-mail, páginas legais).

## Decisões tomadas

- PARTE A (2026-11-16): o herói da landing continua escuro nos dois temas (é escuro por design); as seções de página trocam a paleta clara pela grafite no tema escuro. "Comparar" no menu abre o ranking de cidades (não existe tela própria). Os planos da landing e de "Comprar mais créditos" são os do PDF (seção 8), com preços marcados como previstos; não há pacote avulso de créditos definido. O aviso legal sai do explorador e fica nos Termos ("Avisos legais"); regra 11 do CLAUDE.md atualizada.
- Cabeçalho da landing (2026-11-16): só marca + selo + "Entrar" (ou "Ir para a plataforma" logado); as seções continuam por rolagem.
- Login com Google exige e-mail verificado pelo Google também para conta nova (evita que um e-mail não confirmado bloqueie o cadastro por senha do dono real).

- Logo no produto = ícone PNG (2x/3x) + nome em texto na cor do tema; os PNGs originais ficam em `design/brand/` (versionados desde `654da32`, 5,8 MB).
- `manifest.webmanifest` servido como `application/manifest+json` por um `location` próprio no nginx.
- Build do Compose no Docker Desktop 29 (Compose v5) falha com "failed to execute bake" neste Windows; as imagens foram construídas com `docker build` direto e `docker compose up -d --no-build`.

## Decisões que dependem do Pedro

- **Google Maps:** decidido "só na tela" em 2026-11-18 (`docs/GOOGLE-MAPS.md`). Falta só, quando quiser, criar a chave restrita e preencher `GOOGLE_MAPS_API_KEY`.
- **Cobrar o relatório?** `credit_settings.report_cost` está em 0 (cidade liberada não paga relatório).
- **Preço do crédito:** `credit_settings.credit_unit_price_cents` está em 1780 (R$ 17,80, base: plano Essencial), marcado na tela como "valor de demonstração, a definir". Trocar com UPDATE, sem deploy.
- **Pagamento real:** Pix, Mercado Pago ou Stripe (gancho em `docs/EXTENSIONS.md`); exige CNPJ ou MEI e conta no provedor.

- **Provedor de tiles (obrigatório antes de publicar o hero 360 e o explorador em produção).** Os tiles públicos do OSM não servem para produção, e o hero com o mapa real aumenta o volume (14 pontos pré-carregados por visita, do zoom 3 ao 14). Opções levantadas em 2026-11-17 (preços de sites de terceiros; confirmar no site de cada provedor): Stadia Maps (camada grátis de ~200 mil créditos/mês, pago a partir de ~US$ 20/mês), MapTiler (grátis só para uso não comercial; pago a partir de ~US$ 25–30/mês), Mapbox (franquia grátis mensal e depois ~US$ 0,50–1 por mil carregamentos), ou PMTiles próprio (Protomaps) num bucket sem taxa de saída como o Cloudflare R2 (centavos a poucos dólares por mês de armazenamento e requisições, mais o trabalho de gerar e atualizar o arquivo). Ordem de grandeza para o protótipo: de US$ 0 a ~US$ 30/mês; cresce com o número de visitas.

- Ligar o assistente: `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL` (Gemini) e `AI_ASSISTANT_ENABLED=true` na Vercel (passo a passo em `docs/ASSISTENTE-IA.md`).

- Criar os projetos Neon (`vicus-dados`, `vicus-contas`, São Paulo) e o projeto Vercel; carregar os bancos (`docs/DEPLOY.md`).
- Mapa-base em produção: o servidor público do OSM não cobre produção; escolher MapTiler, Stadia ou PMTiles próprio antes de divulgar.
- Colocar o prompt de deploy de protótipo (texto completo) em `design/prompts/`.
- Licença do repositório (padrão: "todos os direitos reservados").
- Manter públicos `docs/LOCUS-logica-do-produto.pdf` e `design/brand/`.
- Vercel: uso comercial exige o plano Pro (US$ 20/mês por pessoa); o Hobby é só para uso pessoal.
- Provedor de tiles do mapa-base (Fase 2).

## Pendências

- Mapa-base no tema escuro (os tiles do OSM continuam claros; depende do provedor de tiles a escolher).
- Holograma: conjunto de quadros para o tema escuro (o manifesto já aceita `sets.escuro`).
- Prompt do redesign premium (Fases 4 a 9) e o da PARTE A/B em `design/prompts/`.
- Créditos de boas-vindas: decidido em 2026-11-19, 5 por conta nova (`credit_settings.signup_credits`, migração 0014), uma única vez (índice único no extrato). Não há plano gratuito: o cartão "Plano" saiu da Visão geral, de Análises e da conta.
- Holograma: quando Pedro trocar os quadros (720×720, sem cone nem brilho), rodar `python -I scripts/build-holograma.py design/holograma-360/VICUS-Holograma-360-Frames-PNG/frames-png`, conferir ≤ 6 MB e versão nova no manifesto, commitar e conferir no link publicado.

- Colocar os prompts (`.md`) em `design/prompts/` e versionar: sem eles, os checklists de aceite não estão no repositório.
- Modo escuro (ver quadro). Decidir: preferência do sistema, botão, ou os dois; mapa-base OSM no escuro; conjunto escuro do holograma.
- Medir a transição do holograma em celular de verdade (`docs/PERFORMANCE.md`).

## Último commit

Ver `git log -1`; este arquivo é atualizado no mesmo commit de cada fase.
