# Relatório em PDF, roteiro de visita e modo apresentação

Tudo é gerado no servidor, na hora, com os critérios e pesos da tela atual. O ranking é o mesmo motor do explorador
(`app/scoring/rank.py`): mesmos critérios e mesma base geram o mesmo ranking e o mesmo **código dos parâmetros**.

| O quê | Onde |
|---|---|
| Dados dos bairros (só fonte própria) | `backend/app/report/data.py` |
| Google (tempo e distância de carro) | `backend/app/report/google_routes.py`; regras em [GOOGLE-MAPS.md](GOOGLE-MAPS.md) |
| PDF do relatório | `backend/app/report/pdf.py` |
| PDF do roteiro e dos slides | `backend/app/report/extras.py` |
| Endpoints, limites e semáforo | `backend/app/api/report.py` |
| Botões e download | `frontend/src/report.js`, explorador (painel "Relatório") e Minhas análises |
| Telas | `frontend/src/views/roteiro.js` (`#/roteiro?city=`), `frontend/src/views/apresentacao.js` (`#/apresentacao?city=`) |
| Testes | `backend/tests/test_report.py` (nenhum chama o Google) |
| Amostra (desenvolvimento) | `python scripts/sample_report.py --email <conta> --ibge 2611606 --kind report --png` |
| Capturas de cada página (Recife) | [visual/relatorio/](visual/relatorio/) |

## Endpoints

- `POST /api/cities/{ibge}/report` com `{criteria, kind: report|route|slides, neighborhoods?}` → PDF
  (`VICUS-relatorio-<cidade>-<AAAA-MM-DD>.pdf`, `Cache-Control: no-store`).
- `POST /api/cities/{ibge}/report/data` → os dados do relatório em JSON, para o modo apresentação (sem Google).
- `POST /api/cities/{ibge}/route` com 3 bairros → ordem sugerida, trechos e checklist (com Google, se ligado e na cota).

Todos exigem sessão, CSRF e a cidade liberada na conta (`credits.require_city`). Cidade não liberada: 402 e o
frontend pede para abrir a cidade primeiro (o fluxo de crédito que já existe).

## Regras

- **Créditos:** `credit_settings.report_cost` (padrão **0**: cidade liberada não paga relatório). Para cobrar, mude o
  valor no banco; a cobrança passa por `credits._spend` (motivo `report`).
- **Limites:** `REPORT_DAILY_LIMIT` (padrão 10 por conta por dia; conta relatório, roteiro e slides em PDF e cada
  roteiro montado, que usa o Google), 20 pedidos por minuto por IP, e no máximo `REPORT_MAX_CONCURRENT` (2)
  gerações ao mesmo tempo por processo. Falhou: o pedido volta para a cota do dia.
- **Falta de dado:** a linha do dado diz `Não foi possível encontrar dados de [item] desta área.`; nada é estimado.
- **Cor nunca sozinha:** número da posição em todo mapa e valor numérico ao lado de toda barra.
- **Privacidade:** PDF em memória (sem arquivo temporário), sem cópia no servidor, sem log do conteúdo; só o dono
  da conta gera o seu. As marcações e anotações do roteiro ficam só no aparelho (localStorage).
- **Google ("só na tela", 2026-11-18):** tempo de carro só no Roteiro de visita dentro do app; nenhum PDF chama o
  Google; nada no MapLibre; nada gravado. Desligado sem `GOOGLE_MAPS_API_KEY`. Ver [GOOGLE-MAPS.md](GOOGLE-MAPS.md).
- **Base desatualizada:** antes de gerar, o servidor confere se a base tem população dos bairros e concorrência
  (`base_ready` em `app/api/report.py`). Se não tiver, responde 503 com uma mensagem clara e não gera PDF incompleto.
  `PDF_ENABLED=false` responde 503 "O relatório ainda não está disponível neste servidor".

## Relatório e slides são produtos diferentes

- **Relatório (PDF, A4):** documento técnico para ler e conferir. Capa, resumo, critérios e sede, **tabelas
  comparativas** (contagens e densidade por critério; população, renda, concorrência e cobertura lado a lado), uma página
  por bairro, método, fontes e aviso legal.
- **Slides (tela e PDF 16:9, 297 × 167 mm):** narrativa curta para sócio, banco ou investidor: (a) capa com cidade e
  ramo, (b) o que buscamos (até 4 critérios em linguagem simples), (c) visão geral no mapa, (d) um slide por bairro com
  a nota como número herói, 3 apoios e uma frase de leitura, (e) os 5 lado a lado, (f) como lemos os dados, (g) próximos
  passos (botão para o Roteiro de visita), (h) fontes, datas, cobertura e aviso legal. Os textos da narrativa
  (`wants`, `readings`) saem do servidor (`app/report/extras.py`, `story`), iguais na tela e no PDF. Movimento só com
  `cascade`, `countNumber`/`countUp` e `growBar` (`src/motion.js`).

## Novos dados

- **População dos bairros** (Censo 2022, v0001): `neighborhoods.population` e `population_method`
  (`ibge_bairro` = publicada para o bairro; `setores` = soma exata dos setores da área, só se todos tiverem valor).
  Carga isolada: `python -m app.etl.census --population` (também roda dentro do `load_br`). Em Recife, Jaboatão e
  São Paulo a soma dos bairros bate com a população do município.
- **Concorrência:** `segments.competitor_type_key` (coluna `competitor_type` em `seed/segments.csv`). "Outro" não tem
  tipo: o relatório diz que não há dado de concorrência.
- **Posição e contribuição de cada critério:** calculadas no SQL do ranking (ver [SCORING.md](SCORING.md)).

## Por que fpdf2 e não WeasyPrint

A produção é uma função Python da Vercel ([DEPLOY.md](DEPLOY.md)), que não tem as bibliotecas de sistema (Pango,
HarfBuzz) que o WeasyPrint carrega. O fpdf2 é Python puro (depende só de fontTools e Pillow), roda igual no Docker e na
Vercel, embute e reduz a fonte (Inter, OFL, em `app/report/fonts/`) e desenha SVG vetorial. Custo: o layout é escrito
em código (coordenadas em mm) em vez de HTML/CSS. O PDF tem título, idioma `pt-BR`, texto extraível e texto
alternativo nos mapas, mas não é um PDF totalmente estruturado (tagged): o fpdf2 não gera a árvore de estrutura completa.

## Fontes do PDF na Vercel

`vercel.json` inclui `backend/app/report/fonts/**` na função (`includeFiles`): sem isso a função não acha os `.ttf`.
