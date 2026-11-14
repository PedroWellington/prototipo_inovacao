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
| Malha municipal (tiles do ranking de cidades) | IBGE, Malha Municipal 2022: `geoftp.ibge.gov.br/.../malhas_municipais/municipio_2022/Brasil/BR/BR_Municipios_2022.zip` | Shapefile (EPSG:4674) | 2022 |
| População e área do município | IBGE, Censo 2022, Agregados por municípios (básico): `ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios/Agregados_por_Municipio_csv/Agregados_por_municipios_basico_BR_20260520.zip`, variáveis `v0001` (pessoas) e `AREA_KM2` | CSV `;` | 2022 (publicado em 20/05/2026) |
| Renda | IBGE, Censo 2022, Agregados por Setores Censitários, **Rendimento do Responsável**: `ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/`, arquivos por setor, bairro e município (`..._renda_responsavel_BR_20260508_csv.zip`). `V06006` = mediana do rendimento nominal mensal das pessoas responsáveis com rendimento; `V06001` = responsáveis | CSV `;` | 2022 (publicado em 08/05/2026) |
| Unidades de saúde: **fonte principal de hospital** (ver "CNES") | Ministério da Saúde, OpenDataSUS: `s3.sa-east-1.amazonaws.com/ckan.saude.gov.br/CNES/cnes_estabelecimentos_csv.zip` | CSV `;` | atualizado em 14/11/2026 |
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
- **Bairros no Brasil.** O IBGE publica a malha de bairros para 25 UFs. **DF e TO não têm o arquivo** (404 no FTP e ausentes da listagem em 14/11/2026). Ali todos os municípios usam áreas por setor censitário, e o ETL trata o 404 como "sem bairros oficiais".
- **Renda do Censo 2022.** O dicionário dos agregados "básicos" não tem renda. Ela saiu numa publicação própria (Rendimento do Responsável, 08/05/2026), com um arquivo por nível.
  - Sigilo vem como `X`, e ausência de valor vem como `.`: 8.904 setores com `X` e 337 com `.`, de 458.772. Os dois viram **nulo**.
  - Os 5.570 municípios têm mediana.
  - O decimal é `,` nos municípios e `.` nos setores, sem separador de milhar.
  - No arquivo de bairros, o código **3205200069** (Vila Velha/ES) aparece duas vezes, com grafias e valores diferentes ("São Toquarto" e "São Torquato"). Para não escolher um deles por palpite, esse bairro fica com renda indisponível.

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
   - Uma única leitura dos 10 arquivos serve para todas as UFs (`load_br`) ou para uma (`load_uf`, `load_city`).
   - Cada `.zip` é lido em streaming, sem descompactar em disco. Só ficam as linhas ativas das UFs pedidas **cujo CNAE principal pertence a algum tipo do catálogo**. Isso mantém o banco pequeno: são 28 CNAEs.
   - Consequência: incluir um CNAE novo em `business_type_cnae.csv` exige recarregar o CNPJ (`load_br --force`). Só o `seed_catalog` não basta.
   - A "cobertura" passou a ser medida sobre esses estabelecimentos, e não sobre todos os ativos. A tela diz "estabelecimentos ativos com atividade principal de algum tipo do catálogo".
   - Conta **estabelecimentos** (matriz e filial), não empresas.
   - Os `.zip` ficam em `data/raw/cnpj/2026-10/` (fora do Git) e **nunca são apagados**.
3. **Localização (`locate`).** O CNPJ não traz latitude e longitude. Por isso usa o texto do campo BAIRRO (opção B do PDF), sempre dentro do mesmo município e nesta ordem:
   1. **exato**: nome normalizado (minúsculo, sem acento, sem pontuação, espaços colapsados), só quando o nome não se repete na cidade;
   2. **alias**: só em cidades com áreas e sem ambiguidade (o alias tem de ser único na cidade). É uma inferência documentada:
      - nome oficial do distrito → área urbana daquele distrito (ex.: "PINHEIROS" em São Paulo);
      - "CENTRO" → área urbana do distrito-sede, que é o distrito **com o nome do município** (sem ele, não há alias);
      - "ZONA RURAL" → área rural, só quando o município tem **uma única** área rural;
   3. **trigram** (`pg_trgm`): limiar **0,85**, e só quando há **um único** bairro ou área acima dele. Em dúvida, o estabelecimento fica "não localizado".
4. **Contagens (`counts`).**
   - A view materializada `neighborhood_type_counts` guarda a contagem por bairro/área e tipo, somando os CNAEs do tipo.
   - A view `municipality_type_counts` guarda a contagem por município e tipo, para o ranking de cidades. Conta **todos** os estabelecimentos do município, localizados ou não num bairro: o município vem do próprio CNPJ.
   - A view `neighborhood_coverage` guarda a cobertura por bairro/área.
   - A tabela `city_data_status` guarda uma linha por cidade carregada. **Toda cidade com linha nessa tabela fica clicável no explorador**, sem código específico de cidade.

5. **Censo (`census`, nacional, uma vez).**
   - População, área e renda de cada município vão para `municipalities`.
   - Medianas de setores e bairros vão para `census_income`.
   - A malha municipal vai simplificada em três níveis para os tiles: 1.500 m, 250 m e 30 m de tolerância, em Web Mercator.
   - A renda de cada bairro/área (`census.update_neighborhood_income`) vem assim:
     - **bairro oficial:** a mediana publicada pelo IBGE para o código do bairro;
     - **área por setor censitário:** média das medianas dos setores da área (`census_tracts`, gravado pelos limites), ponderada pelos responsáveis com valor. É **aproximado**: uma média de medianas não é a mediana da área;
     - sem nenhum setor com valor: **nulo**, e a tela mostra "Não foi possível encontrar dados de renda desta área."
6. **Carga nacional (`load_br`).**
   - Etapas: censo → limites de cada UF → leitura única do CNPJ → por UF: estabelecimentos, localização, renda, contagens e status.
   - Cada UF é uma transação registrada em `etl_progress`. Se a carga cair, o mesmo comando continua da UF seguinte; `--force` refaz tudo.
   - O comando, a partir dos arquivos já baixados: `docker compose run --rm backend python -m app.etl.load_br --local-path /data/raw/cnpj/2026-10`.

### O que não é guardado

- Razão social, nome fantasia, telefone, e-mail e qualquer dado de sócio ou MEI **não são lidos para o banco**.
- O identificador do estabelecimento é o SHA-256 do CNPJ (o CNPJ de MEI identifica uma pessoa).
- Ficam guardados só: CNAE principal, situação, bairro (texto), CEP, município e `location_id`, que é o hash de CNPJ de outro cadastro do mesmo local, nunca o endereço (ver "O que é um estabelecimento").
- Do CNES ficam só: código da unidade, tipo de unidade, município e bairro/área. Nada de nome, telefone ou responsável.

## Cobertura e limitações

- **Cobertura da cidade:** % dos cadastros ativos de CNPJ (do catálogo) localizados em algum bairro ou área.
- **Cobertura do bairro/área:** total de estabelecimentos (locais distintos) localizados ali (todos os tipos), classificado em alta, média ou baixa pelos tercis dentro da cidade. Zero localizados = baixa, com o aviso "poucos dados localizados nesta área".
- **É uma aproximação.** Sem coordenadas, a cobertura depende de o texto do bairro no CNPJ estar preenchido e grafado como o IBGE. Medir exatamente exigiria geocodificar por CEP/endereço (CNEFE; ver [EXTENSIONS.md](EXTENSIONS.md)).
- **Áreas por setor censitário.** O IBGE não dá nome de bairro a esses setores. Por isso a localização nelas é mais fraca: depende dos aliases (nome do distrito, "centro", "zona rural") e de o CNPJ citar o nome do povoado. Muitas áreas pequenas ficam com cobertura baixa, e a tela diz isso.
- **Bairro informado no CNPJ.** É declarado pela empresa e pode estar desatualizado. Muitos usam "CENTRO" mesmo em cidades cujo centro tem outro nome oficial. No Recife, por exemplo, não há bairro "Centro". Esses casos ficam **não localizados**, e não atribuídos por palpite.
- **Renda (Censo 2022).** É a renda da **pessoa responsável** pelo domicílio, não a renda total do domicílio, e é de 2022. Serve como indicador de poder de compra relativo. Não diz nada sobre patrimônio nem sobre o quanto alguém "está disposto a pagar". A tela sempre traz a nota "Renda é um indicador e não determina preferências."

## O que é um estabelecimento

**Estabelecimento = local distinto** (mesmo CEP + logradouro + número) com pelo menos um cadastro ativo de CNPJ cuja atividade principal é do tipo. Vale para todos os tipos com fonte CNPJ. Hospital tem o CNES como fonte; ver a seção seguinte.

### Por que

A auditoria mostrou que CNPJ não é prédio:

- Em **Altinho (PE, 20 mil habitantes)** havia **823 CNPJs** com CNAE hospitalar: 654 num único endereço e 106 em outro. São filiais abertas por profissional ou serviço, não 823 hospitais.
- Em **Caruaru**, 1.796 CNPJs hospitalares estavam espalhados por poucos endereços.

Contar CNPJs punha essas cidades no topo de qualquer critério "hospital perto".

### Como é feito

- Na leitura do CNPJ, o ETL monta uma chave com CEP, tipo + logradouro e número, normalizados (sem acento, maiúsculas, só letras e dígitos). Essa chave fica **só na tabela temporária** da carga.
- No banco, cada cadastro recebe `location_id`: o hash de CNPJ do menor cadastro do mesmo local no município. **Não guardamos endereço nem hash de endereço.** Endereços com CEP são enumeráveis, então um hash de endereço seria reversível. O `location_id` só diz que certos CNPJs dividem um local.
- **Sem número ("S/N", vazio, "0") ou sem CEP**, não há como provar que é o mesmo lugar. Nesse caso cada cadastro conta como um local, e o erro fica para o lado de contar a mais, como antes.
- As views contam `count(DISTINCT location_id)` por bairro/área e tipo, e por município e tipo. A cobertura do bairro (`neighborhood_coverage`) também conta locais.
- A **taxa de localização** (`city_data_status`, [COBERTURA.md](COBERTURA.md)) continua medida em **cadastros**, e a tela diz "cadastros ativos de CNPJ".
- **Efeito colateral conhecido:** um prédio com várias clínicas no mesmo número conta como **um** local por tipo. Salas diferentes do mesmo número (complemento) não separam locais.

### Impacto (Brasil, CNPJ 2026-10)

| Tipo | Cadastros CNPJ | Locais distintos | Redução |
|---|---|---|---|
| Clínica / consultório | 297.710 | 185.454 | −38% |
| Hospital (CNAE) | 78.768 | 50.185 | −36% |
| Fisioterapia | 69.821 | 61.188 | −12% |
| Faculdade | 12.988 | 11.433 | −12% |
| Nutricionista | 19.030 | 16.834 | −12% |
| Ótica | 76.641 | 68.495 | −11% |
| Restaurante | 400.851 | 363.660 | −9% |
| Lanchonete / padaria | 770.469 | 712.186 | −8% |
| Laboratório | 28.517 | 26.848 | −6% |
| Supermercado / mercado | 502.242 | 481.148 | −4% |
| Farmácia | 120.694 | 115.793 | −4% |
| **Todos (catálogo)** | **2.740.044** | **2.283.544** | **−17%** |

### Antes e depois: hospital

A última coluna é a contagem final, com o CNES como fonte do hospital.

| Lugar | CNPJs com CNAE hospitalar | Locais distintos (CNPJ) | Unidades no CNES (**contagem final**) |
|---|---|---|---|
| Altinho (PE) | 823 | 27 | **1** |
| Caruaru (PE) | 1.796 | 144 | **21** |
| Recife (PE) | 736 | 326 | **96** |
| São Paulo (SP) | 5.156 | 3.331 | **296** |
| Iputinga (bairro do Recife) | 4 | 4 | **2** |

### Antes e depois: outros tipos (cadastros → locais)

| Tipo | Altinho | Caruaru | Recife | São Paulo |
|---|---|---|---|---|
| Clínica | 2 → 2 | 662 → 336 | 2.773 → 816 | 38.198 → 16.612 |
| Farmácia | 9 → 9 | 340 → 318 | 909 → 809 | 4.856 → 4.416 |
| Lanchonete / padaria | 26 → 24 | 1.393 → 1.268 | 6.787 → 5.904 | 61.097 → 54.007 |
| Supermercado / mercado | 28 → 27 | 682 → 654 | 2.372 → 2.159 | 23.361 → 21.458 |

## CNES (Ministério da Saúde)

### Avaliação

Feita com `scripts/evaluate_cnes.py` e o arquivo de 14/11/2026: 642.608 unidades, das quais 503.307 ativas (sem motivo de desativação).

Para cada tipo de saúde, comparamos por município as unidades ativas do CNES com os locais distintos do CNPJ:

| Tipo do catálogo | Tipos de unidade do CNES (`TP_UNIDADE`) | Unidades CNES | Locais CNPJ | Correlação por município | Coordenada dentro do município |
|---|---|---|---|---|---|
| Hospital | 05 hospital geral, 07 especializado, 15 unidade mista, 62 hospital-dia, 20/21 pronto-socorro | 8.564 | 50.185 | 0,93 | 97,1% |
| Clínica | 04 policlínica, 36 clínica/centro de especialidade | 108.123 | 185.454 | 0,94 | 97,3% |
| Laboratório | 39 unidade de apoio diagnose e terapia (SADT) | 32.118 | 26.848 | 0,94 | 97,6% |

### Decisão

- **Hospital: CNES é a fonte principal**, e o CNPJ vira complemento.
  - O tipo de unidade do CNES diz o que é um hospital. Já o CNAE hospitalar aparece em salas, lojas e empresas de serviço médico.
  - Mesmo agrupando por endereço, o CNPJ tem 5,9× mais "hospitais" que o CNES. Em 1.291 municípios ele passa do dobro do CNES, e o CNES nunca passa o dobro do CNPJ.
  - O CNES tem coordenada, então o bairro sai por **ponto-em-polígono**, não pelo texto do endereço. 8.117 das 8.564 unidades (94,8%) caíram num bairro ou área.
  - A tela mostra "N unidades ativas no CNES (Ministério da Saúde); complemento: M locais com CNPJ de atividade principal de hospital". A fonte e a data aparecem no detalhe e em "Fontes e datas".
- **Clínica, laboratório, fisioterapia e nutricionista: o CNPJ continua como fonte principal.** O tipo de unidade do CNES não corresponde ao tipo do catálogo:
  - "clínica/centro de especialidade" inclui odontologia, que o catálogo exclui;
  - "SADT" mistura laboratório, imagem e terapias;
  - consultórios isolados (tipo 22) são em boa parte de pessoa física.
  - As contagens divergem nos dois sentidos (Recife: clínicas CNES 1.587 × CNPJ 816; São Paulo: 8.079 × 16.612). Trocar a fonte mudaria o significado do tipo, e por isso fica para quando houver um mapeamento conferido.

### Como entra

- Os dados ficam em CSV, não em código:
  - `business_types.csv` tem a coluna `source` (`cnpj` ou `cnes`);
  - `business_type_cnes.csv` mapeia tipo → `TP_UNIDADE`.
- A etapa `cnes` do `load_br` (ou `python -m app.etl.cnes`) carrega em `health_units` só as unidades **ativas** dos tipos mapeados, com código CNES, tipo, município e bairro. **Sem nome, telefone ou responsável.**
- O município vem do código IBGE de 6 dígitos do CNES. Coordenada ausente ou fora do município: a unidade conta na cidade, mas em nenhum bairro.
- As views usam a fonte de cada tipo (`n_establishments`) e guardam o CNPJ como complemento (`n_cnpj`).
- O CNES é atualizado todo dia. Para atualizar, apague `data/raw/cnes/cnes_estabelecimentos_csv.zip` e rode `load_br --steps cnes --force`.

### Exemplo: hospitais do Iputinga (Recife)

Auditoria com `scripts/audit_establishments.py --ibge 2611606 --bairro Iputinga --type hospital`. O CSV completo fica em `data/raw/audit/`, fora do Git. MEIs apareceriam como "MEI (omitido)"; não houve nenhum.

| CNPJ básico | CNAE | Endereço no CNPJ | Método | No CNES |
|---|---|---|---|---|
| 09192486 | 8610-1/02 | Av. Caxangá, 4360 | exato | sim: CNES 6230407, hospital especializado |
| 15224542 | 8610-1/01 | Av. Caxangá, 3929 (loja 08) | exato | não |
| 01559521 | 8610-1/01 | R. do Bom Pastor, 141 (loja A) | exato | não |
| 64476582 | 8610-1/02 | R. Bom Pastor, 47 (sala 1, galeria) | exato | não |

- O CNES tem **2 unidades hospitalares** com coordenada dentro do Iputinga. Uma é o CNPJ 09192486. A outra (CNES 2427427, hospital geral) usa o CNPJ da mantenedora, que no cadastro da Receita está no bairro Caxangá: a diferença entre "texto do endereço" e "coordenada".
- Três dos quatro CNPJs com CNAE hospitalar estão em loja ou sala. Com o CNES como fonte, o Iputinga passa a contar **2 hospitais**, com "complemento: 4 locais com CNPJ".

## Resultado da carga

Carga de **14/11/2026**, CNPJ de referência **2026-10**, Censo 2022 e CNES de 14/11/2026. Comando: `python -m app.etl.load_br`. Os logs ficam em `data/raw/load_br*.log`, fora do Git.

### Brasil

| Métrica | Valor |
|---|---|
| Municípios no catálogo do IBGE | 5.571 |
| Cidades carregadas (clicáveis no explorador e no ranking de cidades) | **5.570**. A que falta é Boa Esperança do Norte (MT), criada depois do Censo 2022 e sem malha nem setores. |
| Com bairros oficiais do IBGE | 895 cidades, 17.575 bairros |
| Com áreas por setor censitário (aviso na tela) | 4.675 cidades, 36.330 áreas |
| Cadastros de CNPJ ativos com CNAE do catálogo | 2.740.044 (2.283.544 locais distintos) |
| Localizados em algum bairro/área | **1.534.146 cadastros (56,0%)** |
| Bairros/áreas com renda do Censo | 51.869 de 53.905 |
| Unidades hospitalares do CNES | 8.564 (8.117 localizadas por coordenada) |
| Taxa de localização por cidade | 1.679 cidades ≥ 80%; 2.456 entre 50% e 80%; 1.431 abaixo de 50% |
| Tempo | Censo 2 min; limites 18 min; leitura única do CNPJ 10–20 min; gravação por UF 10–12 min |

A taxa de cada cidade está em **[COBERTURA.md](COBERTURA.md)**, gerado por `report --all`.

### Por UF

| UF | Municípios | Com bairros oficiais | Cadastros CNPJ | Localizados | % |
|---|---|---|---|---|---|
| AC | 22 | 8 | 7.835 | 2.594 | 33,1% |
| AL | 102 | 6 | 32.667 | 25.496 | 78,0% |
| AM | 62 | 44 | 41.272 | 36.405 | 88,2% |
| AP | 16 | 4 | 8.258 | 6.329 | 76,6% |
| BA | 417 | 11 | 175.087 | 114.927 | 65,6% |
| CE | 184 | 105 | 107.050 | 82.433 | 77,0% |
| DF | 1 | 0 | 46.412 | 119 | 0,3% |
| ES | 78 | 17 | 62.358 | 47.901 | 76,8% |
| GO | 246 | 2 | 107.186 | 15.842 | 14,8% |
| MA | 217 | 6 | 54.282 | 22.082 | 40,7% |
| MG | 853 | 55 | 285.544 | 161.015 | 56,4% |
| MS | 79 | 18 | 38.328 | 16.731 | 43,7% |
| MT | 141 de 142 | 44 | 54.732 | 31.954 | 58,4% |
| PA | 144 | 25 | 68.172 | 33.442 | 49,1% |
| PB | 223 | 12 | 45.651 | 36.366 | 79,7% |
| PE | 185 | 41 | 89.226 | 73.079 | 81,9% |
| PI | 224 | 25 | 38.352 | 30.484 | 79,5% |
| PR | 399 | 42 | 174.069 | 112.632 | 64,7% |
| RJ | 92 | 31 | 249.146 | 190.931 | 76,6% |
| RN | 167 | 19 | 39.788 | 30.836 | 77,5% |
| RO | 52 | 23 | 18.860 | 12.388 | 65,7% |
| RR | 15 | 1 | 6.221 | 4.798 | 77,1% |
| RS | 497 | 162 | 151.833 | 104.909 | 69,1% |
| SC | 295 | 125 | 112.807 | 84.521 | 74,9% |
| SE | 75 | 11 | 22.049 | 18.692 | 84,8% |
| SP | 645 | 58 | 682.202 | 230.329 | 33,8% |
| TO | 139 | 0 | 20.596 | 6.911 | 33,6% |

### Onde a localização por bairro é fraca, e por quê

O ranking de **cidades** não depende disso: o município vem do próprio CNPJ. O que fica fraco é o ranking de **bairros** dessas cidades, e a tela mostra a cobertura.

- **Capitais e grandes cidades sem bairros na malha do IBGE.** São Paulo, Campinas, Goiânia, Brasília e Palmas não têm bairros oficiais e usam áreas por distrito.
  - **São Paulo:** os textos do CNPJ ("PINHEIROS", "VILA MARIANA", "SANTO AMARO"…) são nomes de distritos oficiais. Com o alias "nome do distrito → área urbana do distrito", a cidade passou de **1,0% para 31,8%** localizados.
  - **Goiânia (0,3%), Brasília (0,3%) e Campinas (9,4%):** os distritos não têm nome de bairro, e os textos do CNPJ ("SETOR BUENO", "ASA NORTE"…) não casam com nada oficial.
- **DF e TO:** o IBGE não publica malha de bairros (404). Todo município usa áreas.
- **Erro corrigido nesta etapa:** o alias "centro" ia para a área urbana do distrito de código "05", tratado como sede. Em São Paulo o distrito 05 é **Artur Alvim** (zona leste), e 2.088 cadastros com "CENTRO" estavam lá. Agora a sede é o distrito **com o nome do município**. Sem ele, não há alias "centro", e esses cadastros ficam não localizados.

### Exemplos

- **Recife (94 bairros oficiais):** 21.695 cadastros do catálogo; **21.540 localizados (99,3%)**. Os textos não casados mais comuns são nomes populares sem limite oficial (SITIO DOS PINTOS, POCO DA PANELA, COHAB IBURA DE CIMA) e "CENTRO", que não existe como bairro no Recife e por isso fica não localizado de propósito.
- **Cabrobó (69 áreas):** 267 cadastros; 172 localizados (64,4%), todos por alias ("CENTRO", "ZONA RURAL" e o nome do distrito-sede). Os nomes informais (COHAB, SUBESTACAO, IPSEP…) não existem na malha do IBGE.

### Decisões em aberto

1. **Áreas sem nenhum estabelecimento localizado** (comuns em povoados e aldeias). Hoje entram no ranking com cobertura baixa e o aviso "poucos dados localizados nesta área". Em critérios "não quero perto", tendem a subir. A alternativa conservadora é deixá-las fora do ranking.
2. **Aliases de distrito ("centro", nome do distrito, "zona rural").** São inferências documentadas, e o efeito aparece separado na coluna "Alias" de [COBERTURA.md](COBERTURA.md). Para desligar, tire os aliases em `ibge_boundaries.area_rows` e rode `load_br --steps boundaries,locate,counts --force`.
3. **Aliases revisados por cidade** ("RECIFE ANTIGO" → Recife, "SETOR BUENO" → ?). Exigem conhecimento local e uma tabela revisada. Não foram feitos por palpite.
4. **CNES para clínica e laboratório:** só com um mapeamento tipo de unidade → tipo do catálogo conferido (ver "CNES").
