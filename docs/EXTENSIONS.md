# Pontos de extensão (fora do escopo do MVP)

Cada item abaixo diz onde encaixar a extensão sem mexer no motor de ranking.

## Google Places (detalhe nos 5 primeiros e no bairro aberto)

- **Onde encaixar:** um novo endpoint, `GET /api/cities/{ibge}/neighborhoods/{id}/details`, chamado pelo frontend só quando o usuário abre um bairro ou olha os 5 primeiros. Ele **nunca** é chamado dentro de `rank()` ([`backend/app/scoring/rank.py`](../backend/app/scoring/rank.py)).
- **Regras do PDF (seção 5):**
  - Places API (New) com *field mask* mínima.
  - Limite de chamadas por sessão e por dia.
  - Contador de uso no modo de desenvolvimento.
  - Nada de montar banco com dados do Google.
  - Respeitar as regras de cache e armazenamento dos termos.
- **Antes de implementar:** confirmar cotas e preços na página oficial do Google Maps Platform. Não use valores de memória.
- **Credencial:** `GOOGLE_MAPS_API_KEY` no `.env`. Nunca no Git.

## Provedor de tiles do mapa-base (obrigatório antes de produção)

- **Hoje:** o mapa usa os tiles públicos do OpenStreetMap (`tile.openstreetmap.org`), que só servem para desenvolvimento. A política de uso desse servidor não permite tráfego de produção.
- **Onde trocar:** `baseStyle()` em [`frontend/src/map/mapView.js`](../frontend/src/map/mapView.js). Basta trocar a fonte raster, ou o estilo inteiro, por um provedor com política adequada: MapTiler, Stadia, Protomaps auto-hospedado etc.
- **Atribuição:** manter "© OpenStreetMap contributors" visível em qualquer provedor baseado em OSM.

## Localização dos estabelecimentos por CNEFE/CEP (refino)

- **Hoje:** usa a opção B do PDF, o texto do campo "bairro" do CNPJ ([`backend/app/etl/locate.py`](../backend/app/etl/locate.py)).
- **Refino (opção A):** casar logradouro + número + CEP do CNPJ com o CNEFE 2022 do IBGE, para obter coordenadas, e atribuir por ponto-em-polígono (`ST_Contains` em `neighborhoods.geom`).
- **Onde encaixar:** um novo passo `cnefe` em `load_city`, antes de `locate`. Só os estabelecimentos ainda com `match_method = 'none'` seriam tentados, e o novo método seria gravado como `match_method = 'cnefe'`. Isso exige ampliar o CHECK da coluna numa migration.
- **Ponto de partida:** a lista dos textos não casados está em `city_data_status.unmatched_top` e em [DATA.md](DATA.md).

## Pagamentos, planos e cotas

- **Hoje:** `PAYMENTS_MODE=off` (só registra interesse) ou `demo` (pedido real em `orders`, pagamento SIMULADO por um botão).
  `credit_ledger` guarda boas-vindas, concessões, compras (`reason = 'purchase'`, com `order_id`) e gastos; `credit_settings`
  guarda regras, preço por crédito e limites.
- **Para cobrar de verdade (Pix, Mercado Pago ou Stripe):** em `backend/app/billing/__init__.py`, um `Provider` novo cujo
  `start()` devolve a URL do checkout do provedor, registrado em `PROVIDERS` com o nome do modo novo; e uma rota
  `POST /api/billing/webhook/<provedor>` que confere a assinatura do provedor e chama `mark_paid()` (idempotente; o índice
  `credit_ledger_order_once` impede creditar o mesmo pedido duas vezes). A tela, os pedidos, os limites e o extrato não mudam.

### Plano original (PDF)

- **Fora do MVP.** O PDF (seção 8) prevê os planos Essencial, Profissional e Rede, cobrança mensal por gateway (Mercado Pago ou Stripe) com webhooks e cotas lidas de uma tabela de configuração.
- **Onde encaixar:**
  - tabelas `plans`, `subscriptions` e `usage_counters`;
  - uma dependência FastAPI `require_quota("cities")`, aplicada em `/api/cities/{ibge}/rank`.
- **Exige:** CNPJ ou MEI e conta no gateway.

## Verificação de e-mail, redefinição de senha, login com Google

- **Hoje:** `users.email_verified` já existe e vale `false`.
- **Verificação e redefinição:** tabela `email_tokens(user_id, purpose, token_hash, expires_at)`, mais um provedor de e-mail transacional (credencial no `.env`).
- **Login com Google:** implementado em `backend/app/auth/google.py` (OIDC, authorization code + PKCE, `state` + `nonce`, ID token validado no servidor). Liga com `GOOGLE_LOGIN_ENABLED` + `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL`. Conta existente é vinculada só com e-mail verificado pelo Google.

## Limite de tentativas de login distribuído

- **Hoje:** em memória, por processo ([`backend/app/auth/rate_limit.py`](../backend/app/auth/rate_limit.py)). Zera ao reiniciar e não vale com vários workers.
- **Antes de produção:** trocar por Redis ou por uma tabela.

## Relatório em PDF e Google Routes (feito em 2026-11-17)

- Implementado: [RELATORIO.md](RELATORIO.md) e [GOOGLE-MAPS.md](GOOGLE-MAPS.md). Places continua fora (abaixo).

## Agente de IA, comparar cidades, contas de equipe, aluguel

- **Agente de IA (PDF, seção 7):** deve **chamar `rank()`**. Ele traduz o pedido em critérios e pesos e explica o resultado com os números da resposta. Nunca calcula nem inventa números.
- **Comparar cidades:** feito como ranking de cidades ("Você já tem uma cidade em mente?" → Não). Ver [SCORING.md](SCORING.md).
- **Aluguel:** só com fonte licenciada, como faixa de preço anunciado, com fonte e data. Sem raspagem.
- **Fora para sempre:** previsão de lucro, de faturamento ou de chance de sucesso.

## Renda (Censo 2022)

- **Implementada.** Ver [DATA.md](DATA.md) e [SCORING.md](SCORING.md).
- **Próximos passos possíveis:** renda como critério também no ranking de bairros (hoje só aparece no detalhe); outras variáveis do Censo (domicílios, faixa etária) com as mesmas regras de fonte, data e "indisponível".

## CNES para outros tipos de saúde

- **Hoje:** o CNES é a fonte principal de **hospital**, com o CNPJ como complemento. Ver [DATA.md](DATA.md), seção "CNES".
- **Para estender** a clínica, laboratório e fisioterapia:
  1. conferir um mapeamento tipo de unidade (`TP_UNIDADE`) → tipo do catálogo, já que "clínica/centro de especialidade" inclui odontologia e "SADT" mistura laboratório e imagem;
  2. pôr esse mapeamento em `business_type_cnes.csv`;
  3. trocar `source` para `cnes` em `business_types.csv` e rodar `seed_catalog` e `load_br --steps cnes --force`.
  - Nenhum código muda.
- **Cuidados:** o CNES inclui consultórios de pessoa física (tipo 22). Nunca guardar nome de profissional; só código, tipo e lugar.
