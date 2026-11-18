# Google Maps Platform: o que usamos, o que os termos permitem e como travar a cota

Leitura feita em **2026-11-17**. Releia antes de ligar a chave em produção: os termos mudam com frequência.

| Documento | Versão lida |
|---|---|
| [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms) (seção 3.2.3) | página atual em 2026-11-17 |
| [Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) (seção 19, Routes API) | última modificação em 28/10/2026 |
| [Policies and attributions for Routes API](https://developers.google.com/maps/documentation/routes/policies) | página atual em 2026-11-17 |
| [Routes API: Usage and Billing](https://developers.google.com/maps/documentation/routes/usage-and-billing) | atualizada em 2026-11-09 |
| [Tabela de preços](https://developers.google.com/maps/billing-and-pricing/pricing) | atualizada em 2026-11-11 |

Nosso endereço de faturamento é no Brasil, então valem os termos globais, não os da EEA.

## 1. O que usamos

Só a **Routes API, método `computeRouteMatrix`**, com `travelMode = DRIVE` e `routingPreference = TRAFFIC_UNAWARE`
(sem trânsito em tempo real). Pedimos só os campos `originIndex,destinationIndex,status,condition,distanceMeters,duration`
(cabeçalho `X-Goog-FieldMask`).

- **Origens:** um ponto dentro de cada bairro (`ST_PointOnSurface` da geometria do IBGE, nunca o centroide simples).
  **Destino:** o ponto da sede (o bairro da sede, se o texto do cadastro casar com um bairro da cidade; senão o ponto
  da cidade, e o relatório diz isso). São coordenadas nossas, de dados abertos; nada da empresa vai para o Google.
- **Não usamos:** Places (avaliações, notas, fotos, lista de estabelecimentos), Geocoding, mapas ou tiles do Google.
  Concorrência e contagens vêm da nossa base (CNPJ e CNES).

## 2. SKU, cota gratuita e conta

| Item | Valor (tabela de 2026-11-11) |
|---|---|
| SKU | **Routes: Compute Route Matrix Essentials** (ID `9392-1087-2045`) |
| O que entra no Essentials | só recursos básicos; `TRAFFIC_AWARE` ou `TRAFFIC_AWARE_OPTIMAL` mudam para o Pro (cota grátis de 5.000) |
| Critério de cobrança | **por elemento**: origens × destinos de cada pedido |
| Cota gratuita | **10.000 elementos por mês**, por SKU, por conta de faturamento (exige conta de faturamento ativa) |
| Depois da cota | US$ 5,00 por mil elementos (faixa até 100 mil) |
| Limites técnicos | 3.000 elementos por minuto; até 625 elementos por pedido |

A cota que você estimou (cerca de 5.000) é a do SKU **Pro**; o Essentials, que é o nosso, tem 10.000.

**Conta por relatório:** 5 bairros × 1 sede = **5 elementos**. **Roteiro de visita:** 4 origens (sede e os 3 bairros) ×
3 destinos (os 3 bairros) = **12 elementos** (o Google cobra também a célula bairro→ele mesmo).

| | Elementos |
|---|---|
| Cota gratuita do mês | 10.000 |
| Nossa trava (80 %, `GOOGLE_ROUTES_CAP_SHARE=0.8`) | 8.000 |
| Relatórios que cabem na trava (só relatórios) | 1.600 por mês |
| Roteiros que cabem na trava (só roteiros) | 666 por mês |

Se a mesma conta de faturamento usar este SKU em outro projeto, a cota de 10.000 é dividida entre eles: baixe
`GOOGLE_ROUTES_MONTHLY_FREE` na mesma proporção.

## 3. O que os termos dizem (trechos e como seguimos)

| Termo | O que diz | Como seguimos |
|---|---|---|
| Service Specific Terms 19.1 | O conteúdo da Routes API pode ser usado **sem** um Google Map. | Tempos e distâncias aparecem como texto e tabela. |
| Service Specific Terms 19.2 | O conteúdo da Routes API **não pode ser usado em conjunto com um mapa que não seja do Google**. | Nada do Google entra no mapa MapLibre nem nos mapas SVG do PDF. No PDF, os tempos de carro ficam numa página própria, **sem mapa** ("Deslocamento até a sede"). Ver o conflito B abaixo. |
| Service Specific Terms 19.3 | Latitude e longitude da Routes API podem ficar em cache por até 30 dias. | Não guardamos nada da resposta (nem coordenadas: não pedimos esse campo). |
| Service Specific Terms, termos gerais, item 3 | `place_id` pode ser guardado. | Não usamos `place_id`. |
| ToS 3.2.3(a) | Não exportar, extrair nem "raspar" conteúdo do Google para uso fora dos Serviços; não pré-buscar, indexar, guardar, recompartilhar nem hospedar de novo. | Chamada só na hora do pedido; nada de pré-busca. Ver o conflito A abaixo. |
| ToS 3.2.3(b) | Não fazer cache, salvo as exceções das Service Specific Terms. | **Nada do Google é gravado no banco nem em disco.** A tabela `google_routes_usage` guarda só a contagem de elementos do mês. O PDF é gerado em memória e entregue; não fica cópia no servidor. |
| ToS 3.2.3(c) | Não criar conteúdo derivado do conteúdo do Google. | A ordem de visita do roteiro é escolhida na hora, para mostrar; não é guardada. |
| ToS 3.2.2(b) e Policies | Mostrar a atribuição; fora de um Google Map, a atribuição é obrigatória, preferencialmente o **logo do Google Maps**; com pouco espaço, o texto **"Google Maps"**. Separar visualmente o conteúdo do Google do resto. | Bloco do Google com borda própria e o texto "Fonte: Google Maps" em cada valor do Google. **Pendente:** trocar o texto pelo logo oficial (arquivo do kit de marca do Google, não incluído no repositório). |
| Policies | O app precisa de Termos de Uso e Política de Privacidade públicos que citem os Termos e a Política de Privacidade do Google. | **Pendente para você:** acrescentar na página de Termos (já existe em `#/termos`) os links `https://maps.google.com/help/terms_maps/` e `https://policies.google.com/privacy` antes de ligar a chave. |

## Decisão: "só na tela" (Pedro, 2026-11-18)

- Tempo e distância de carro do Google aparecem **só no Roteiro de visita, dentro do app** (tela `#/roteiro`, resposta de
  `POST /api/cities/{ibge}/route`, sem mapa na tela).
- **Nenhum PDF chama o Google:** relatório, roteiro em PDF e slides usam só a distância em linha reta, calculada por nós
  (PostGIS). O PDF diz "Tempo de carro: só no Roteiro de visita, dentro do app". Teste: `test_google_only_on_screen_never_in_pdfs`.
- Nada do Google no mapa MapLibre e nada gravado no banco (só a contagem de elementos em `google_routes_usage`).
- `GOOGLE_MAPS_API_KEY` continua vazia por padrão. A página de Termos já tem a seção "Google Maps" (links para os Termos
  adicionais do Google Maps e a Política de Privacidade do Google); ela só aparece quando a chave está ligada
  (`google_maps: true` em `GET /api/config`).
- Conta da cota: só o roteiro consome (12 elementos por roteiro): com a trava de 8.000, cabem 666 roteiros por mês.

## 4. Conflitos com o desenho original (resolvidos pela decisão acima)

**A. PDF baixado e compartilhado (ToS 3.2.3(a)).** O relatório e o roteiro em PDF ficam com a pessoa por tempo
indeterminado e podem ser repassados a sócio, banco ou investidor. Os termos proíbem "guardar, recompartilhar ou hospedar
de novo" conteúdo do Google "fora dos Serviços", e a documentação do Google diz para consultar advogado em caso de dúvida.
Não achei regra explícita para documento impresso ou PDF gerado pelo app. O app que mostra o dado na tela está coberto
(19.1); o arquivo que sai do app é a zona cinzenta.

**B. Mesmo documento que mapas próprios (19.2).** O PDF tem mapas SVG nossos (não do Google). Para não "usar em
conjunto", o tempo de carro fica numa página sem mapa, mas é o mesmo arquivo. Também é zona cinzenta.

**Como está agora:** a camada do Google está implementada, testada com um falso e **desligada** enquanto
`GOOGLE_MAPS_API_KEY` estiver vazia (o padrão). Sem a chave, o relatório usa só a distância em linha reta e diz
"tempo de deslocamento indisponível neste relatório". Opções para decidir:

1. **Só na tela (mais seguro):** tempos do Google só no roteiro dentro do app (sem mapa), e nunca no PDF.
2. **PDF como está:** ligar a chave aceitando a zona cinzenta, de preferência depois de ouvir um advogado ou o time de
   vendas do Google Maps Platform (que pode dar licença específica).
3. **Sem Google:** manter só a distância em linha reta (nenhum custo, nenhum risco).

## 5. Como o servidor se protege (código)

- Chave só no servidor: `GOOGLE_MAPS_API_KEY` (variável de ambiente; nunca no frontend nem no Git).
- Contador mensal `google_routes_usage` (mês de cobrança do Google, no fuso do Pacífico): os elementos são **reservados
  antes** da chamada numa só instrução SQL que só soma se couber abaixo da trava; se a chamada falhar, a reserva não é
  devolvida (pode ter sido cobrada).
- Trava em 80 % da cota gratuita: acima disso o relatório sai sem o bloco do Google.
- Limite por conta: `REPORT_DAILY_LIMIT` (padrão 10 relatórios por dia, tabela `report_usage`). Limite por IP: 20 pedidos
  por minuto no endpoint (em memória, por processo).
- Degradação suave: sem chave, sem cota, erro, resposta inválida ou tempo esgotado (`GOOGLE_ROUTES_TIMEOUT_SECONDS`,
  padrão 4 s) → relatório sem o tempo de carro, nunca falha inteiro.
- Logs: só o tipo do erro e o código HTTP, nunca a URL, a chave, o corpo nem coordenadas.
- Testes (`backend/tests/test_report.py`) usam um falso; nenhum teste chama o Google.

## 6. Passo a passo no Google Cloud Console (você faz uma vez)

**Criar a chave restrita**
1. `https://console.cloud.google.com/` → escolha (ou crie) o projeto → **APIs e serviços → Biblioteca** → procure
   **Routes API** → **Ativar**. Não ative mais nenhuma API do Maps.
2. **APIs e serviços → Credenciais → Criar credenciais → Chave de API**.
3. Na chave: **Restrições de aplicativos → Endereços IP** e coloque o IP de saída do servidor. Na Vercel o IP de saída
   não é fixo: nesse caso deixe "Nenhuma" e dependa das travas abaixo (ou use um servidor com IP fixo).
4. **Restrições de API → Restringir chave → Routes API**. Salvar.
5. Coloque a chave em `GOOGLE_MAPS_API_KEY` (painel da Vercel ou `.env`), nunca no Git.

**Cota máxima do lado do Google (trava dura)**
1. **Google Maps Platform → Cotas** (ou **IAM e administrador → Cotas**) → selecione **Routes API**.
2. Na linha **Compute Route Matrix elements per minute** deixe o padrão. Na linha de **elementos por dia**
   (se aparecer como "per day") ponha **260** (8.000 ÷ 31 dias). Se só houver "por minuto", ponha **20** elementos por
   minuto, que já impede um pico acidental.
3. **Editar** → novo valor → **Enviar**. Quando a cota acaba, o Google recusa (HTTP 429) e o nosso relatório sai sem o
   tempo de carro.

**Alerta de orçamento**
1. **Faturamento → Orçamentos e alertas → Criar orçamento**.
2. Escopo: o projeto da chave; serviços: **Routes API**. Valor: **US$ 1**. Alertas em 50 %, 90 % e 100 % (gasto real),
   por e-mail para você.
3. Orçamento só avisa, não desliga. Quem desliga de verdade é a cota diária acima; e o nosso contador para em 80 %.

**Conferir o uso**
- **Google Maps Platform → Métricas** (filtre Routes API) ou **Faturamento → Relatórios** (SKU "Compute Route Matrix
  Essentials"). O número deve bater com `SELECT * FROM google_routes_usage`.
