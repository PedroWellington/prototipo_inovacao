# Dados do VICUS

Este documento registra de onde vem cada dado, como foi conferido, como entra no banco e o que ele **não** consegue dizer. Todas as conferências abaixo foram feitas em **14/11/2026**, nas páginas e arquivos oficiais.

Regra de ouro: as contagens vêm de dados abertos guardados no banco próprio. Nenhum serviço externo é consultado durante o ranking, e não há chamada ao Google.

## Fontes

| Dado | Fonte oficial | Formato | Referência |
|---|---|---|---|
| Regiões, estados e municípios | IBGE, API de localidades v1 (`servicodados.ibge.gov.br/api/v1/localidades/...`) | JSON | vigente |
| Geometria de região, estado e município (mapa) | IBGE, API de malhas v3 (`/api/v3/malhas/paises/BR?intrarregiao=regiao\|UF`, `/estados/{UF}?intrarregiao=municipio`, `formato=application/vnd.geo+json`, `qualidade=minima`) | GeoJSON | versão vigente na API |
| Limites de bairros | IBGE, Malha de Bairros do Censo Demográfico 2022, por UF: `geoftp.ibge.gov.br/.../censo_2022/bairros/gpkg/UF/PE/PE_bairros_CD2022.gpkg` | GeoPackage (EPSG:4674) | 2022 |
| Setores censitários (base das "áreas") | IBGE, Malha de Setores Censitários do Censo 2022, por UF: `.../censo_2022/setores/gpkg/UF/PE/PE_setores_CD2022.gpkg` | GeoPackage (EPSG:4674) | 2022 |
| Estabelecimentos | Receita Federal, dados abertos do CNPJ. Compartilhamento oficial: `arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9`, pasta **2026-10** (a mais recente em 14/11/2026). | `Estabelecimentos0.zip` … `9.zip` (~5,4 GB) e `Municipios.zip` | **2026-10** |
| Mapa-base | OpenStreetMap, com "© OpenStreetMap contributors" sempre visível | tiles raster | só desenvolvimento (ver EXTENSIONS.md) |

### Conferências feitas

- **Endereço do CNPJ.**
  - Os endereços antigos `dadosabertos.rfb.gov.br/CNPJ/` e `arquivos.receitafederal.gov.br/dados/cnpj/...` não respondem mais: um dá tempo esgotado e o outro, 404.
  - A publicação atual é um compartilhamento Nextcloud. O ETL lista as pastas de mês pelo WebDAV público (`public.php/webdav`, usuário = token do compartilhamento, senha vazia) e baixa os arquivos.
  - Depois do download, cada arquivo foi conferido contra o tamanho publicado no servidor: os 12 bateram.
- **Layout do CNPJ.** Conferido no PDF oficial de metadados (`gov.br/receitafederal/dados/cnpj-metadados.pdf`):
  - CSV sem cabeçalho, separador `;`, ISO-8859-1, 30 colunas em ESTABELECIMENTOS.
  - Posições usadas (base 0): 0–2 CNPJ (básico, ordem, DV), 5 situação cadastral, 11 CNAE principal, 17 bairro, 18 CEP, 19 UF, 20 município.
  - Situação **2 = ATIVA**. No arquivo ela vem como `"02"`; conferido numa amostra que trazia `01`, `02`, `03`, `04` e `08`.
- **Município no CNPJ.** O campo usa o código da Receita (tabela TOM), não o do IBGE: Recife = `2531` na tabela `Municipios` da própria base. Essa tabela **não tem UF**. Por isso o mapeamento para o código IBGE:
  1. considera só os códigos que aparecem em linhas com UF = PE;
  2. casa o nome normalizado dentro dos municípios do estado;
  3. quando a grafia difere, aceita o candidato mais parecido da UF (similaridade ≥ 0,5), registrado no log da carga e na seção "Resultado da carga".
- **CNAEs.** Cada código do catálogo foi conferido na API oficial de CNAE do IBGE (`/api/v2/cnae/subclasses/{código}`). Correções em relação ao rascunho:
  - farmácia ganhou 4771-7/03 (homeopáticos);
  - lanchonete = 5611-2/03, e padaria = 4721-1/02 + 1091-1/02;
  - escola = 8513-9/00 + 8520-1/00;
  - faculdade = 8531-7/00 + 8532-5/00 + 8533-3/00;
  - clínica = 8630-5/01, /02, /03 (sem odontologia);
  - hotel = 5510-8/01 e /02 (sem motéis).
  - Todos estão em [`backend/app/seed/business_type_cnae.csv`](../backend/app/seed/business_type_cnae.csv), com `verified = true`.
- **Loja de suplementos.** Não tem CNAE próprio. Foi aproximada por 4729-6/99 (comércio varejista de produtos alimentícios não especificados), com `precision = approx` e o aviso "Aproximado pelo CNAE; não distingue suplementos de outros produtos" na tela.
- **Bairros do Recife.** A malha traz 95 feições para o município 2611606; unidas por código, são **94 bairros**, o que bate com o PDF. A área somada é de 214,8 km².
- **Bairros em Pernambuco.** Só **41 dos 185 municípios** de PE têm bairros na malha do IBGE (660 bairros). Os outros 144 usam "áreas" (abaixo).

### Tipos fora da lista selecionável

Não há CNAE confiável para estes tipos, então eles ficam fora da lista nesta etapa:

| Tipo do rascunho | Motivo |
|---|---|
| Escritórios | Escritório não é atividade econômica: qualquer CNAE pode operar em escritório. |
| Condomínios residenciais | Condomínio não é estabelecimento com CNAE de atividade. Moradia seria tratada por população do Censo, fora do escopo. |
| Comércio de rua | Não é um tipo de atividade. |
| Oftalmologista | Fica dentro da atividade médica ambulatorial (clínica). Não há subclasse por especialidade. |
| Endocrinologista | Mesmo motivo do oftalmologista. |

## Como entra no banco

1. **Limites (`ibge_boundaries`).**
   - Municípios com bairros na malha usam os bairros oficiais (`kind = 'bairro'`).
   - Os demais recebem **áreas formadas por setores censitários** (`kind = 'area'`), por distrito:
     - cada aglomerado nomeado pelo IBGE (povoado, aldeia, comunidade quilombola, núcleo) vira uma área com o nome oficial;
     - os demais setores urbanos do distrito formam "‹distrito› – área urbana";
     - os demais setores rurais formam "‹distrito› – área rural";
     - massas d'água (situação 9) ficam de fora.
   - A tela avisa quando a cidade usa áreas.
   - Geometrias: SIRGAS 2000 → WGS 84. A área vem de `ST_Area(geography)`. Para o mapa há uma versão simplificada (tolerância de 0,0001° ≈ 11 m).
2. **CNPJ (`cnpj`).**
   - Uma única leitura dos 10 arquivos serve para o estado inteiro.
   - Cada `.zip` é lido em streaming, sem descompactar em disco. Só ficam as linhas com UF = PE e situação ativa.
   - Conta **estabelecimentos** (matriz e filial), não empresas.
   - Os `.zip` ficam em `data/raw/cnpj/2026-10/` (fora do Git) e **nunca são apagados**.
3. **Localização (`locate`).** O CNPJ não traz latitude e longitude. Por isso usa o texto do campo BAIRRO (opção B do PDF), sempre dentro do mesmo município e nesta ordem:
   1. **exato**: nome normalizado (minúsculo, sem acento, sem pontuação, espaços colapsados), só quando o nome não se repete na cidade;
   2. **alias**: só em cidades com áreas e sem ambiguidade. É uma inferência documentada:
      - "CENTRO" → área urbana do distrito-sede;
      - "ZONA RURAL" → área rural, só quando o município tem **uma única** área rural;
   3. **trigram** (`pg_trgm`): limiar **0,85**, e só quando há **um único** bairro ou área acima dele. Em dúvida, o estabelecimento fica "não localizado".
4. **Contagens (`counts`).**
   - A view materializada `neighborhood_type_counts` guarda a contagem por bairro/área e tipo, somando os CNAEs do tipo.
   - A view `neighborhood_coverage` guarda a cobertura por bairro/área.
   - A tabela `city_data_status` guarda uma linha por cidade carregada. **Toda cidade com linha nessa tabela fica clicável no explorador**, sem código específico de cidade.

### O que não é guardado

- Razão social, nome fantasia, telefone, e-mail e qualquer dado de sócio ou MEI **não são lidos para o banco**.
- O identificador do estabelecimento é o SHA-256 do CNPJ (o CNPJ de MEI identifica uma pessoa).
- Ficam guardados só: CNAE principal, situação, bairro (texto), CEP e município.

## Cobertura e limitações

- **Cobertura da cidade:** % dos estabelecimentos ativos localizados em algum bairro ou área.
- **Cobertura do bairro/área:** total de estabelecimentos localizados ali (todos os tipos), classificado em alta, média ou baixa pelos tercis dentro da cidade. Zero localizados = baixa, com o aviso "poucos dados localizados nesta área".
- **É uma aproximação.** Sem coordenadas, a cobertura depende de o texto do bairro no CNPJ estar preenchido e grafado como o IBGE. Medir exatamente exigiria geocodificar por CEP/endereço (CNEFE; ver [EXTENSIONS.md](EXTENSIONS.md)).
- **Áreas por setor censitário.** O IBGE não dá nome de bairro a esses setores. Por isso a localização nelas é mais fraca: depende do alias "centro"/"zona rural" e de o CNPJ citar o nome do povoado. Muitas áreas pequenas ficam com cobertura baixa, e a tela diz isso.
- **Bairro informado no CNPJ.** É declarado pela empresa e pode estar desatualizado. Muitos usam "CENTRO" mesmo em cidades cujo centro tem outro nome oficial. No Recife, por exemplo, não há bairro "Centro". Esses casos ficam **não localizados**, e não atribuídos por palpite.
- **Renda (Censo 2022).** Não foi implementada nesta etapa: é opcional no prompt e ficou para depois. Nenhuma renda é mostrada nem estimada.

## Resultado da carga

Carga de **14/11/2026**, CNPJ de referência **2026-10**, com o comando `python -m app.etl.load_uf --uf PE`. O log completo fica em `data/raw/load_uf_PE.log`, fora do Git.

### Resumo de Pernambuco

| Métrica | Valor |
|---|---|
| Cidades carregadas (clicáveis no explorador) | **185 de 185** |
| Com bairros oficiais do IBGE | 41 cidades, 660 bairros |
| Com áreas por setor censitário | 144 cidades, 2.040 áreas |
| Linhas lidas da base do CNPJ (Brasil inteiro) | 73.809.386, em 527 s |
| Estabelecimentos ativos em PE | 744.714 |
| Localizados em algum bairro/área | **605.599 (81,3%)** |
| … por casamento exato | 526.207 |
| … por alias ("centro"/"zona rural", só cidades com áreas) | 77.197 |
| … por trigram (único candidato ≥ 0,85) | 2.195 |
| Códigos de município da Receita sem casamento exato com o IBGE | 0 |
| Taxa de localização por cidade | 49 cidades ≥ 80%; 80 entre 50% e 80%; 56 abaixo de 50% |

### Exemplos de casamento por trigram (os mais frequentes)

| Estab. | Cidade | Texto no CNPJ | → Bairro/área do IBGE |
|---|---|---|---|
| 832 | Garanhuns | SEVERIANO DE MORAES FILHO | Severiano Moraes Filho |
| 208 | Olinda | ALTO SOL NASCENTE | Alto do Sol Nascente |
| 149 | Sanharó | AREA RURAL DE SANHARO | Sanharó – área rural |
| 96 | Serra Talhada | NOSSA SENHORA DA PENHA - SEDE | Nossa Senhora da Penha |
| 39 | Santa Maria da Boa Vista | PROJETO FULGENCIO | Projeto Fulgêncio 5 ⚠ |

⚠ O último caso merece revisão. O texto não diz qual "Projeto Fulgêncio" é, mas só o 5 passou do limiar. Se houver outros aglomerados com o mesmo prefixo, o certo seria não localizar. Fica registrado como ponto de refino.

### Recife (94 bairros oficiais)

- 213.323 estabelecimentos ativos; **211.774 localizados (99,3%)**: 211.768 por casamento exato e 6 por trigram.
- Os 20 textos não casados mais frequentes mostram o que falta: nomes populares sem limite oficial e "CENTRO". Recife não tem bairro com esse nome, e ele ficou não localizado de propósito.

| Estab. | Texto no CNPJ | Estab. | Texto no CNPJ |
|---|---|---|---|
| 361 | SITIO DOS PINTOS | 29 | BONJI |
| 164 | POCO DA PANELA | 27 | IBURA DE BAIXO |
| 121 | COHAB IBURA DE CIMA | 26 | JORDAO BAIXO |
| 87 | BAIRRO DO RECIFE | 23 | CID UNIVERSITARIA |
| 85 | CENTRO | 23 | DO RECIFE |
| 72 | RECIFE ANTIGO | 9 | JORDAO ALTO |
| 46 | SETUBAL | 9 | STO ANTONIO |
| 35 | ALTO DO MANDU SITIO GRANDE | 8 | CID.UNIVERSITARIA |

Vários desses textos poderiam ganhar um alias explícito sem ambiguidade, por exemplo "RECIFE ANTIGO" → Recife, "SETUBAL" → Boa Viagem, "CID UNIVERSITARIA" → Cidade Universitária. Isso fica para uma tabela de aliases revisada por alguém da cidade, e não foi feito por palpite.

### Cabrobó (exemplo de cidade pequena, 69 áreas)

- 1.566 ativos; 1.023 localizados (65,3%), todos por alias. Foram 862 na área urbana da sede ("CENTRO") e 161 na área rural ("ZONA RURAL").
- Os nomes informais dentro da cidade (COHAB, SUBESTACAO, IPSEP, MARIA LUIZA, SANTA RITA…) não existem na malha do IBGE e ficaram não localizados.
- **Limitação importante:** 67 das 69 áreas (aldeias, povoados, agrovilas) ficaram com zero estabelecimentos localizados. Elas aparecem no ranking com cobertura **baixa** e o aviso "poucos dados localizados nesta área". Em critérios "não quero perto", uma área sem nenhum dado tende a subir na lista. A tela mostra a cobertura, mas isso pode confundir. Ver "Decisões em aberto".

### Decisões em aberto

1. **Áreas sem nenhum estabelecimento localizado.** Hoje elas entram no ranking, com cobertura baixa. A alternativa é deixá-las fora do ranking, listadas como "sem dados localizados". Essa opção é mais conservadora.
2. **Alias "centro" → área urbana da sede.** Aplicado só em cidades sem bairro formal. É uma inferência documentada, e o efeito aparece separado na coluna "Alias". Pode ser desligado tirando o alias em `ibge_boundaries.py` e rodando `--steps boundaries,locate,counts`.

### Taxa de localização por cidade (todas as 185)

Ordenada pelo número de estabelecimentos ativos. Divisão: "bairros" = malha oficial de bairros; "áreas" = setores censitários.

| Cidade | IBGE | Divisão | Unidades | Ativos | Localizados | % | Exato | Alias | Trigram |
|---|---|---|---|---|---|---|---|---|---|
| Recife | 2611606 | bairros | 94 | 213323 | 211774 | 99,3% | 211768 | 0 | 6 |
| Jaboatão dos Guararapes | 2607901 | bairros | 27 | 59018 | 58650 | 99,4% | 58650 | 0 | 0 |
| Caruaru | 2604106 | bairros | 40 | 48842 | 43917 | 89,9% | 43889 | 0 | 28 |
| Petrolina | 2611101 | bairros | 36 | 41889 | 34531 | 82,4% | 34523 | 0 | 8 |
| Olinda | 2609600 | bairros | 31 | 36704 | 35849 | 97,7% | 35587 | 0 | 262 |
| Paulista | 2610707 | bairros | 24 | 30709 | 27698 | 90,2% | 27687 | 0 | 11 |
| Cabo de Santo Agostinho | 2602902 | bairros | 24 | 15794 | 12870 | 81,5% | 12845 | 0 | 25 |
| Camaragibe | 2603454 | bairros | 29 | 13868 | 13561 | 97,8% | 13549 | 0 | 12 |
| Garanhuns | 2606002 | bairros | 13 | 11707 | 10804 | 92,3% | 9962 | 0 | 842 |
| Santa Cruz do Capibaribe | 2612505 | bairros | 15 | 10429 | 10002 | 95,9% | 10002 | 0 | 0 |
| Vitória de Santo Antão | 2616407 | bairros | 23 | 9404 | 8326 | 88,5% | 8325 | 0 | 1 |
| Ipojuca | 2607208 | bairros | 21 | 9055 | 1674 | 18,5% | 1672 | 0 | 2 |
| Igarassu | 2606804 | bairros | 25 | 8896 | 6312 | 71,0% | 6311 | 0 | 1 |
| São Lourenço da Mata | 2613701 | bairros | 16 | 8279 | 7893 | 95,3% | 7891 | 0 | 2 |
| Serra Talhada | 2613909 | bairros | 14 | 7867 | 6217 | 79,0% | 5963 | 0 | 254 |
| Gravatá | 2606408 | áreas | 13 | 7078 | 573 | 8,1% | 1 | 476 | 96 |
| Carpina | 2604007 | áreas | 8 | 7005 | 247 | 3,5% | 7 | 222 | 18 |
| Arcoverde | 2601201 | bairros | 14 | 6665 | 6441 | 96,6% | 6441 | 0 | 0 |
| Abreu e Lima | 2600054 | bairros | 13 | 6612 | 6147 | 93,0% | 6147 | 0 | 0 |
| Goiana | 2606200 | áreas | 16 | 5378 | 2990 | 55,6% | 6 | 2984 | 0 |
| Limoeiro | 2608909 | bairros | 13 | 5003 | 3328 | 66,5% | 3296 | 0 | 32 |
| Belo Jardim | 2601706 | áreas | 26 | 4987 | 923 | 18,5% | 82 | 816 | 25 |
| Salgueiro | 2612208 | áreas | 46 | 4943 | 266 | 5,4% | 1 | 265 | 0 |
| Araripina | 2601102 | áreas | 23 | 4858 | 2173 | 44,7% | 7 | 2108 | 58 |
| Surubim | 2614501 | bairros | 10 | 4231 | 3570 | 84,4% | 3569 | 0 | 1 |
| Bezerros | 2601904 | bairros | 16 | 3856 | 2994 | 77,6% | 2904 | 0 | 90 |
| Palmares | 2610004 | áreas | 29 | 3854 | 1467 | 38,1% | 1 | 1458 | 8 |
| Moreno | 2609402 | áreas | 4 | 3710 | 1112 | 30,0% | 10 | 1091 | 11 |
| Toritama | 2615409 | áreas | 4 | 3414 | 1626 | 47,6% | 0 | 1626 | 0 |
| Afogados da Ingazeira | 2600104 | bairros | 9 | 3383 | 1167 | 34,5% | 1166 | 0 | 1 |
| Escada | 2605202 | bairros | 18 | 3168 | 2261 | 71,4% | 2255 | 0 | 6 |
| Pesqueira | 2610905 | bairros | 17 | 2986 | 2359 | 79,0% | 2358 | 0 | 1 |
| Paudalho | 2610608 | áreas | 12 | 2948 | 950 | 32,2% | 36 | 887 | 27 |
| Timbaúba | 2615300 | bairros | 18 | 2825 | 2315 | 81,9% | 2315 | 0 | 0 |
| Ouricuri | 2609907 | áreas | 18 | 2769 | 1125 | 40,6% | 25 | 1100 | 0 |
| Lajedo | 2608800 | áreas | 11 | 2443 | 1721 | 70,4% | 6 | 1715 | 0 |
| Tamandaré | 2614857 | áreas | 13 | 2355 | 1124 | 47,7% | 1 | 1123 | 0 |
| Barreiros | 2601409 | áreas | 14 | 2334 | 1311 | 56,2% | 0 | 1311 | 0 |
| Bonito | 2602308 | áreas | 13 | 2248 | 1115 | 49,6% | 19 | 1096 | 0 |
| Brejo da Madre de Deus | 2602605 | bairros | 4 | 2206 | 347 | 15,7% | 347 | 0 | 0 |
| São José do Egito | 2613602 | áreas | 16 | 2201 | 760 | 34,5% | 6 | 754 | 0 |
| Cupira | 2605004 | áreas | 7 | 1970 | 885 | 44,9% | 0 | 880 | 5 |
| Trindade | 2615607 | áreas | 9 | 1956 | 1070 | 54,7% | 0 | 1070 | 0 |
| São Caitano | 2613107 | áreas | 16 | 1896 | 1188 | 62,7% | 2 | 1186 | 0 |
| Ribeirão | 2611804 | áreas | 15 | 1814 | 863 | 47,6% | 0 | 856 | 7 |
| Petrolândia | 2611002 | áreas | 38 | 1784 | 1238 | 69,4% | 6 | 1232 | 0 |
| São Bento do Una | 2613008 | áreas | 32 | 1737 | 852 | 49,1% | 1 | 825 | 26 |
| Custódia | 2605103 | áreas | 72 | 1732 | 800 | 46,2% | 1 | 798 | 1 |
| Itambé | 2607653 | áreas | 6 | 1712 | 776 | 45,3% | 0 | 776 | 0 |
| São José do Belmonte | 2613503 | áreas | 16 | 1683 | 651 | 38,7% | 11 | 639 | 1 |
| Nazaré da Mata | 2609501 | áreas | 5 | 1668 | 665 | 39,9% | 0 | 665 | 0 |
| Sertânia | 2614105 | áreas | 20 | 1633 | 1012 | 62,0% | 75 | 936 | 1 |
| Aliança | 2600708 | áreas | 15 | 1597 | 938 | 58,7% | 8 | 921 | 9 |
| Tabira | 2614600 | áreas | 8 | 1596 | 963 | 60,3% | 1 | 962 | 0 |
| Cabrobó | 2603009 | áreas | 69 | 1566 | 1023 | 65,3% | 0 | 1023 | 0 |
| Sirinhaém | 2614204 | áreas | 11 | 1566 | 500 | 31,9% | 3 | 497 | 0 |
| Altinho | 2600807 | áreas | 13 | 1564 | 1340 | 85,7% | 0 | 1340 | 0 |
| Taquaritinga do Norte | 2615003 | áreas | 20 | 1528 | 398 | 26,0% | 27 | 371 | 0 |
| Bom Conselho | 2602100 | áreas | 48 | 1457 | 1134 | 77,8% | 1 | 1133 | 0 |
| Triunfo | 2615706 | áreas | 10 | 1414 | 414 | 29,3% | 0 | 414 | 0 |
| Pombos | 2611309 | áreas | 12 | 1368 | 597 | 43,6% | 0 | 597 | 0 |
| Buíque | 2602803 | áreas | 32 | 1357 | 806 | 59,4% | 0 | 806 | 0 |
| Ilha de Itamaracá | 2607604 | áreas | 3 | 1346 | 62 | 4,6% | 16 | 46 | 0 |
| São José da Coroa Grande | 2613404 | áreas | 5 | 1335 | 1010 | 75,7% | 62 | 948 | 0 |
| Floresta | 2605707 | áreas | 33 | 1312 | 540 | 41,2% | 0 | 534 | 6 |
| Exu | 2605301 | áreas | 19 | 1304 | 725 | 55,6% | 0 | 725 | 0 |
| Riacho das Almas | 2611705 | áreas | 26 | 1296 | 604 | 46,6% | 1 | 550 | 53 |
| Catende | 2604205 | bairros | 12 | 1289 | 926 | 71,8% | 926 | 0 | 0 |
| Glória do Goitá | 2606101 | bairros | 5 | 1287 | 769 | 59,8% | 768 | 0 | 1 |
| Sanharó | 2612406 | áreas | 13 | 1242 | 271 | 21,8% | 1 | 121 | 149 |
| Santa Maria da Boa Vista | 2612604 | áreas | 85 | 1229 | 332 | 27,0% | 0 | 290 | 42 |
| Bom Jardim | 2602209 | áreas | 20 | 1224 | 581 | 47,5% | 78 | 503 | 0 |
| Vicência | 2616308 | áreas | 15 | 1201 | 796 | 66,3% | 7 | 789 | 0 |
| Fernando de Noronha | 2605459 | áreas | 2 | 1185 | 29 | 2,4% | 0 | 29 | 0 |
| Águas Belas | 2600500 | áreas | 18 | 1178 | 720 | 61,1% | 4 | 716 | 0 |
| Agrestina | 2600302 | áreas | 23 | 1159 | 829 | 71,5% | 0 | 829 | 0 |
| Ipubi | 2607307 | bairros | 1 | 1148 | 6 | 0,5% | 6 | 0 | 0 |
| Chã Grande | 2604502 | áreas | 5 | 1145 | 464 | 40,5% | 1 | 462 | 1 |
| Itapissuma | 2607752 | bairros | 9 | 1144 | 125 | 10,9% | 125 | 0 | 0 |
| Bodocó | 2602001 | áreas | 10 | 1143 | 623 | 54,5% | 16 | 607 | 0 |
| Lagoa Grande | 2608750 | áreas | 13 | 1128 | 412 | 36,5% | 2 | 410 | 0 |
| Condado | 2604601 | áreas | 5 | 1123 | 970 | 86,4% | 0 | 970 | 0 |
| João Alfredo | 2608107 | bairros | 12 | 1112 | 840 | 75,5% | 835 | 0 | 5 |
| Macaparana | 2609006 | áreas | 5 | 1110 | 885 | 79,7% | 0 | 879 | 6 |
| Feira Nova | 2605400 | áreas | 4 | 1078 | 796 | 73,8% | 0 | 796 | 0 |
| Lagoa de Itaenga | 2608503 | áreas | 6 | 1022 | 579 | 56,7% | 7 | 572 | 0 |
| Carnaíba | 2603900 | áreas | 24 | 986 | 527 | 53,4% | 24 | 502 | 1 |
| Rio Formoso | 2611903 | áreas | 8 | 966 | 549 | 56,8% | 0 | 549 | 0 |
| Passira | 2610509 | bairros | 8 | 958 | 601 | 62,7% | 601 | 0 | 0 |
| Canhotinho | 2603702 | áreas | 10 | 936 | 722 | 77,1% | 0 | 722 | 0 |
| Lagoa do Carro | 2608453 | áreas | 9 | 919 | 603 | 65,6% | 4 | 594 | 5 |
| Ibimirim | 2606606 | áreas | 24 | 877 | 437 | 49,8% | 6 | 422 | 9 |
| Amaraji | 2600906 | bairros | 10 | 874 | 538 | 61,6% | 537 | 0 | 1 |
| Orobó | 2609709 | áreas | 12 | 873 | 331 | 37,9% | 10 | 321 | 0 |
| Panelas | 2610202 | áreas | 20 | 851 | 585 | 68,7% | 6 | 579 | 0 |
| Belém do São Francisco | 2601607 | áreas | 12 | 830 | 465 | 56,0% | 0 | 465 | 0 |
| Vertentes | 2616209 | bairros | 11 | 827 | 510 | 61,7% | 510 | 0 | 0 |
| Cachoeirinha | 2603108 | áreas | 7 | 819 | 640 | 78,1% | 0 | 640 | 0 |
| Itaíba | 2607505 | áreas | 27 | 810 | 487 | 60,1% | 8 | 479 | 0 |
| Flores | 2605608 | áreas | 15 | 794 | 379 | 47,7% | 6 | 373 | 0 |
| Venturosa | 2616001 | áreas | 6 | 787 | 465 | 59,1% | 0 | 465 | 0 |
| Água Preta | 2600401 | bairros | 6 | 773 | 494 | 63,9% | 494 | 0 | 0 |
| Gameleira | 2605905 | áreas | 11 | 767 | 402 | 52,4% | 0 | 402 | 0 |
| Araçoiaba | 2601052 | bairros | 2 | 763 | 71 | 9,3% | 71 | 0 | 0 |
| Dormentes | 2605152 | áreas | 13 | 760 | 346 | 45,5% | 0 | 346 | 0 |
| Afrânio | 2600203 | áreas | 24 | 751 | 352 | 46,9% | 6 | 346 | 0 |
| Camocim de São Félix | 2603504 | áreas | 4 | 749 | 553 | 73,8% | 0 | 553 | 0 |
| Itapetim | 2607703 | áreas | 6 | 738 | 381 | 51,6% | 9 | 372 | 0 |
| São João | 2613206 | áreas | 5 | 732 | 461 | 63,0% | 0 | 461 | 0 |
| Tacaratu | 2614808 | áreas | 44 | 725 | 257 | 35,4% | 0 | 257 | 0 |
| Alagoinha | 2600609 | áreas | 13 | 721 | 511 | 70,9% | 1 | 510 | 0 |
| Parnamirim | 2610400 | áreas | 13 | 703 | 324 | 46,1% | 5 | 319 | 0 |
| Santa Cruz da Baixa Verde | 2612471 | áreas | 4 | 695 | 535 | 77,0% | 16 | 519 | 0 |
| Pedra | 2610806 | áreas | 15 | 686 | 324 | 47,2% | 0 | 324 | 0 |
| Granito | 2606309 | bairros | 3 | 663 | 266 | 40,1% | 266 | 0 | 0 |
| São Vicente Férrer | 2613800 | áreas | 6 | 653 | 315 | 48,2% | 0 | 304 | 11 |
| Caetés | 2603207 | áreas | 8 | 631 | 505 | 80,0% | 2 | 503 | 0 |
| Jatobá | 2608057 | áreas | 21 | 620 | 288 | 46,5% | 1 | 287 | 0 |
| Tracunhaém | 2615508 | áreas | 5 | 616 | 364 | 59,1% | 2 | 358 | 4 |
| Inajá | 2607000 | áreas | 29 | 609 | 509 | 83,6% | 0 | 509 | 0 |
| Chã de Alegria | 2604403 | bairros | 7 | 593 | 398 | 67,1% | 398 | 0 | 0 |
| Quipapá | 2611507 | bairros | 2 | 593 | 0 | 0,0% | 0 | 0 | 0 |
| Jupi | 2608305 | áreas | 5 | 586 | 516 | 88,1% | 0 | 516 | 0 |
| Jataúba | 2608008 | bairros | 6 | 585 | 394 | 67,4% | 394 | 0 | 0 |
| São Joaquim do Monte | 2613305 | áreas | 11 | 585 | 445 | 76,1% | 2 | 443 | 0 |
| Sairé | 2612000 | áreas | 2 | 566 | 360 | 63,6% | 0 | 359 | 1 |
| Mirandiba | 2609303 | áreas | 38 | 555 | 389 | 70,1% | 0 | 389 | 0 |
| Itaquitinga | 2607802 | áreas | 4 | 547 | 409 | 74,8% | 0 | 409 | 0 |
| Barra de Guabiraba | 2601300 | bairros | 1 | 544 | 3 | 0,6% | 3 | 0 | 0 |
| Tupanatinga | 2615805 | áreas | 39 | 526 | 461 | 87,6% | 11 | 450 | 0 |
| Serrita | 2614006 | áreas | 10 | 525 | 293 | 55,8% | 13 | 280 | 0 |
| Machados | 2609105 | áreas | 4 | 516 | 333 | 64,5% | 0 | 333 | 0 |
| Frei Miguelinho | 2605806 | áreas | 13 | 509 | 231 | 45,4% | 14 | 217 | 0 |
| Cedro | 2604304 | áreas | 5 | 495 | 462 | 93,3% | 3 | 459 | 0 |
| Iati | 2606507 | áreas | 13 | 491 | 381 | 77,6% | 7 | 374 | 0 |
| Ferreiros | 2605509 | áreas | 4 | 484 | 393 | 81,2% | 0 | 393 | 0 |
| Primavera | 2611408 | áreas | 4 | 478 | 341 | 71,3% | 3 | 338 | 0 |
| Tuparetama | 2615904 | áreas | 4 | 469 | 278 | 59,3% | 0 | 278 | 0 |
| Capoeiras | 2603801 | áreas | 10 | 463 | 431 | 93,1% | 0 | 431 | 0 |
| Lagoa dos Gatos | 2608701 | áreas | 15 | 459 | 315 | 68,6% | 0 | 315 | 0 |
| Tacaimbó | 2614709 | áreas | 7 | 459 | 238 | 51,9% | 5 | 233 | 0 |
| Cortês | 2604809 | áreas | 4 | 456 | 380 | 83,3% | 2 | 378 | 0 |
| Santa Terezinha | 2612802 | áreas | 4 | 455 | 395 | 86,8% | 0 | 395 | 0 |
| Paranatama | 2610301 | áreas | 4 | 452 | 376 | 83,2% | 5 | 371 | 0 |
| Xexéu | 2616506 | áreas | 4 | 441 | 239 | 54,2% | 0 | 239 | 0 |
| Iguaracy | 2606903 | áreas | 14 | 437 | 233 | 53,3% | 0 | 233 | 0 |
| Joaquim Nabuco | 2608206 | áreas | 5 | 436 | 348 | 79,8% | 18 | 330 | 0 |
| Orocó | 2609808 | áreas | 28 | 433 | 351 | 81,1% | 0 | 351 | 0 |
| Santa Cruz | 2612455 | áreas | 4 | 433 | 343 | 79,2% | 3 | 340 | 0 |
| Cumaru | 2604908 | áreas | 10 | 414 | 210 | 50,7% | 1 | 209 | 0 |
| Poção | 2611200 | áreas | 5 | 410 | 348 | 84,9% | 6 | 342 | 0 |
| Carnaubeira da Penha | 2603926 | áreas | 90 | 404 | 327 | 80,9% | 0 | 327 | 0 |
| Jurema | 2608404 | áreas | 4 | 400 | 243 | 60,8% | 0 | 243 | 0 |
| Santa Maria do Cambucá | 2612703 | áreas | 15 | 397 | 350 | 88,2% | 9 | 337 | 4 |
| Saloá | 2612307 | áreas | 10 | 396 | 308 | 77,8% | 1 | 307 | 0 |
| Brejinho | 2602506 | áreas | 5 | 392 | 348 | 88,8% | 8 | 340 | 0 |
| Terra Nova | 2615201 | áreas | 9 | 387 | 178 | 46,0% | 0 | 178 | 0 |
| Moreilândia | 2614303 | áreas | 4 | 379 | 271 | 71,5% | 0 | 271 | 0 |
| Verdejante | 2616100 | áreas | 7 | 373 | 257 | 68,9% | 25 | 232 | 0 |
| Jaqueira | 2607950 | áreas | 6 | 371 | 325 | 87,6% | 3 | 322 | 0 |
| Buenos Aires | 2602704 | áreas | 3 | 363 | 237 | 65,3% | 0 | 232 | 5 |
| Correntes | 2604700 | bairros | 1 | 363 | 0 | 0,0% | 0 | 0 | 0 |
| Betânia | 2601805 | áreas | 27 | 347 | 136 | 39,2% | 0 | 136 | 0 |
| Camutanga | 2603603 | áreas | 3 | 333 | 310 | 93,1% | 0 | 310 | 0 |
| Brejão | 2602407 | áreas | 20 | 326 | 302 | 92,6% | 0 | 302 | 0 |
| Angelim | 2601003 | áreas | 5 | 324 | 257 | 79,3% | 4 | 252 | 1 |
| Manari | 2609154 | áreas | 7 | 324 | 303 | 93,5% | 9 | 294 | 0 |
| Santa Filomena | 2612554 | áreas | 11 | 321 | 190 | 59,2% | 0 | 190 | 0 |
| Lagoa do Ouro | 2608602 | áreas | 6 | 316 | 240 | 75,9% | 0 | 240 | 0 |
| Belém de Maria | 2601508 | áreas | 4 | 310 | 195 | 62,9% | 0 | 195 | 0 |
| Maraial | 2609204 | áreas | 5 | 309 | 254 | 82,2% | 3 | 251 | 0 |
| Jucati | 2608255 | áreas | 2 | 308 | 249 | 80,8% | 0 | 249 | 0 |
| Quixaba | 2611533 | áreas | 9 | 299 | 210 | 70,2% | 2 | 208 | 0 |
| São Benedito do Sul | 2612901 | áreas | 6 | 280 | 223 | 79,6% | 1 | 222 | 0 |
| Casinhas | 2604155 | áreas | 12 | 268 | 216 | 80,6% | 19 | 188 | 9 |
| Calçado | 2603306 | áreas | 5 | 244 | 233 | 95,5% | 1 | 232 | 0 |
| Calumbi | 2603405 | áreas | 7 | 241 | 213 | 88,4% | 0 | 212 | 1 |
| Terezinha | 2615102 | áreas | 2 | 207 | 198 | 95,7% | 0 | 198 | 0 |
| Palmeirina | 2610103 | áreas | 3 | 198 | 183 | 92,4% | 0 | 183 | 0 |
| Ibirajuba | 2606705 | áreas | 4 | 196 | 165 | 84,2% | 3 | 162 | 0 |
| Vertente do Lério | 2616183 | áreas | 10 | 195 | 175 | 89,7% | 21 | 154 | 0 |
| Ingazeira | 2607109 | áreas | 3 | 194 | 152 | 78,4% | 0 | 152 | 0 |
| Solidão | 2614402 | áreas | 5 | 176 | 153 | 86,9% | 4 | 149 | 0 |
| Itacuruba | 2607406 | áreas | 11 | 168 | 156 | 92,9% | 0 | 154 | 2 |
| Salgadinho | 2612109 | áreas | 5 | 166 | 154 | 92,8% | 0 | 154 | 0 |
