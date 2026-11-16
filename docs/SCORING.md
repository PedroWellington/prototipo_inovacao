# Como o VICUS ordena os bairros

O ranking mostra os **bairros que mais combinam com os critérios que você definiu**. Ele não recomenda bairro, não prevê resultado e não usa nenhum atributo pessoal ou protegido.

- **Onde é calculado:** inteiramente no banco, num único SQL em [`backend/app/scoring/rank.py`](../backend/app/scoring/rank.py). O frontend não calcula nota.
- **Endpoint:** `POST /api/cities/{ibge}/rank`
- **Testes:** [`backend/tests/test_scoring.py`](../backend/tests/test_scoring.py)

## Bairros e áreas

O motor é o mesmo para qualquer cidade. Onde a malha do IBGE não tem bairros, as unidades comparadas são **áreas formadas por setores censitários** (ver [DATA.md](DATA.md)). A fórmula não muda; só o vocabulário da tela troca "bairro" por "área", e a tela mostra um aviso. As áreas rurais são grandes, então tendem a ter densidade baixa: a nota é relativa, e isso aparece na frase comparativa e na cobertura.

## Entrada

Uma lista de critérios. Cada critério tem:

- `business_type_key`: o tipo de estabelecimento (farmácia, hospital…);
- `direction`: `attract` (quero perto) ou `repel` (não quero perto);
- `weight`: peso de 1 a 5.

O limite é de 3 critérios por direção.

## Fórmula

Para cada bairro `b` da cidade e cada critério `c`:

1. **Densidade:** `d(b,c) = estabelecimentos do tipo c no bairro b / área de b em km²`.
   - A área vem de `ST_Area(geom::geography)` sobre o limite da malha do IBGE (aproximado, ver DATA.md).
   - Um tipo pode reunir vários CNAEs. Por exemplo, farmácia = 4771-7/01 + 4771-7/02 + 4771-7/03. Todos são somados.
   - Conta **estabelecimentos = locais distintos** (mesmo CEP + logradouro + número), não CNPJs: vários CNPJs do tipo no mesmo endereço contam uma vez. Cadastros sem número ou sem CEP contam um a um. Ver [DATA.md](DATA.md), "O que é um estabelecimento".
2. **Percentil:** `p(b,c) = PERCENT_RANK() OVER (PARTITION BY c ORDER BY d)`, entre 0 e 1.
   - O valor é a fração dos *outros* bairros com densidade menor.
   - Bairros empatados recebem o mesmo percentil. Se todos empatam, `p = 0` para todos.
3. **Aderência:** `f = p` se o critério for `attract`, ou `f = 1 − p` se for `repel`.
4. **Nota (0 a 100):** `nota(b) = 100 × Σ(w_c × f(b,c)) / Σ(w_c)`.
5. **Posição:** nota decrescente.
   - Empates são desfeitos pelo nome do bairro, em ordem de bytes (`COLLATE "C"`: a mesma em qualquer servidor; a ordem alfabética do idioma varia com a collation do banco), e depois pelo id.
   - Antes de ordenar, a nota é arredondada em 6 casas, para eliminar ruído de ponto flutuante.

A nota é **relativa à cidade**. Ela diz como o bairro se posiciona em relação aos outros bairros da mesma cidade. Não é uma medida absoluta nem uma probabilidade.

### Frase comparativa do tooltip

- `mais densidade que X% dos bairros`: X = fração dos outros bairros com densidade **menor**.
- `menos densidade que Y% dos bairros`: Y = fração dos outros bairros com densidade **maior**.

Em critérios "perto", a frase mostra preferencialmente o lado "mais que"; em critérios "longe", o lado "menos que". Se o valor desse lado for 0%, mostra o outro lado.

## Exemplo numérico (o mesmo do teste automatizado)

Uma cidade com 4 bairros e dois critérios: hospitais (perto, peso 3) e farmácias (longe, peso 1).

| Bairro | Área (km²) | Hospitais | Dens. hosp. | p hosp. | Farmácias | Dens. farm. | p farm. | f farm. = 1−p |
|---|---|---|---|---|---|---|---|---|
| Alfa | 1 | 4 | 4 | 1 | 3 | 3 | 1 | 0 |
| Beta | 1 | 2 | 2 | 1/3 | 0 | 0 | 0 | 1 |
| Gama | 2 | 4 | 2 | 1/3 | 0 | 0 | 0 | 1 |
| Delta | 1 | 0 | 0 | 0 | 1 | 1 | 2/3 | 1/3 |

Nota = 100 × (3 × f_hosp + 1 × f_farm) / 4:

| Posição | Bairro | Conta | Nota |
|---|---|---|---|
| 1 | Alfa | 100 × (3×1 + 1×0)/4 | **75,0** |
| 2 | Beta | 100 × (3×⅓ + 1×1)/4 | **50,0** |
| 3 | Gama | 100 × (3×⅓ + 1×1)/4 | **50,0** (empata com Beta; Beta vem antes pelo nome) |
| 4 | Delta | 100 × (3×0 + 1×⅓)/4 | **8,3** |

Repare em Gama: tem tantos hospitais quanto Alfa, mas o dobro da área. Por isso tem a mesma densidade que Beta.

## O que NÃO entra no cálculo

- **Faturamento anual** informado no onboarding. Fica só no perfil.
- **Sede** (estado, cidade, bairro). Serve só para abrir o mapa no lugar certo.
- Qualquer atributo pessoal ou protegido. Os dados de sócios e MEI não são carregados.
- Dados estimados. Veja abaixo.

## Falta de dado

- **Cidade sem carga de dados:** o ranking não é calculado. A resposta é `status: "no_data"`, com a mensagem `Não foi possível encontrar dados de estabelecimentos desta área.`
- **Tipo sem CNAE mapeado:** o ranking não é calculado. A mensagem é `Não foi possível encontrar dados de [tipo] desta área.` O sistema **nunca** assume zero nesse caso.
- **Zero estabelecimentos de um tipo num bairro de cidade com dados:** é uma contagem real, não falta de dado. Mesmo assim, ela depende de o endereço do CNPJ ter sido localizado. Por isso cada bairro mostra a **cobertura de dados** ([DATA.md](DATA.md)).
- **Bairro sem área válida:** fica fora do ranking e aparece listado em `excluded`, com o motivo.

## Reprodutibilidade e cache

- Mesmos critérios e mesmos dados produzem a mesma lista, na mesma ordem. Isso é testado.
- O resultado fica em cache em memória no backend. A chave combina a cidade, os critérios ordenados e a versão dos dados.
- A versão dos dados é a data da carga da cidade mais o hash do mapeamento tipo→CNAE. Editar o CSV de CNAEs invalida o cache.

## Renda no detalhe do bairro e da cidade

- **Valor:** mediana do rendimento nominal mensal das pessoas responsáveis pelo domicílio (Censo 2022, IBGE, variável V06006). Ver [DATA.md](DATA.md).
- **Bairro da malha do IBGE:** valor publicado pelo IBGE para o bairro. **Área por setor censitário:** média das medianas dos setores, ponderada pelos responsáveis (V06001), marcada como **aproximado**.
- **Comparação por quartis** (no SQL de `rank.py` e de `/api/cities/{ibge}/status`): a mediana do lugar é comparada aos quartis Q1, Q2 e Q3 das medianas da referência (bairros da cidade; para a cidade, os municípios da mesma UF; no ranking de cidades, as cidades analisadas).

| Quartil | Frase mostrada |
|---|---|
| 1º (≤ Q1) | Poder de compra abaixo da média … Perfil compatível com oferta de melhor custo-benefício. |
| 2º e 3º | Poder de compra próximo da média … Perfil compatível com oferta mista. |
| 4º (> Q3) | Poder de compra acima da média … Perfil compatível com oferta premium. |

- Sempre com fonte, data e a nota **"Renda é um indicador e não determina preferências."** Nunca "dispostos a pagar" nem patrimônio: o dado é renda.
- Sem valor (sigilo "X" do IBGE, setor sem domicílio): `Não foi possível encontrar dados de renda desta área.`
- No ranking de **bairros**, a renda só aparece no detalhe: não entra na nota.

## Ranking de cidades ("Você já tem uma cidade em mente?" → Não)

O mesmo motor, por município. O SQL está em [`backend/app/scoring/rank_cities.py`](../backend/app/scoring/rank_cities.py) e o endpoint é `POST /api/cities/rank`.

### Entrada

- **Alcance:** Brasil, uma região (`region_id`) ou um estado (`uf`).
- **Critérios:** os mesmos do perfil (tipo, perto/longe, peso de 1 a 5).
- **Normalização:** `population` (padrão) ou `area`.
- **População mínima:** padrão 20 mil habitantes, ajustável. Pode ser 0.
- **Renda (opcional):** `{direction: attract | repel, weight}`. `attract` = poder de compra acima da mediana; `repel` = abaixo.

### Quem entra

Só cidades do alcance que, ao mesmo tempo:

- têm dados carregados (`city_data_status`);
- têm população e área do Censo 2022 maiores que zero;
- têm população ≥ população mínima;
- têm renda, **quando a renda é critério**. Sem a renda como critério, a cidade entra e a renda aparece como indisponível.

A resposta traz `counts`, com `analyzed` de `in_scope`, para a frase "cidades analisadas: X de Y no alcance escolhido", e quantas ficaram fora por cada motivo.

### Fórmula

Para cada cidade `m` e critério `c`:

1. **Contagem:** `n(m,c)` = estabelecimentos (locais distintos) ativos do município com CNAE principal do tipo `c`, de `municipality_type_counts`. Conta **todos** os do município, localizados ou não num bairro: o município vem do próprio CNPJ.
2. **Valor normalizado:**
   - por habitantes: `v = n × 10.000 / população` (Censo 2022);
   - por km²: `v = n / área do município` (Censo 2022).
   - As duas medidas e a contagem absoluta sempre vão na resposta e no tooltip; só a escolhida entra na nota.
3. **Renda (se for critério):** `v` = mediana de renda do município.
4. **Percentil, aderência, nota e posição:** iguais aos dos bairros. `p = PERCENT_RANK()` entre as cidades analisadas; `f = p` (perto) ou `1 − p` (longe); `nota = 100 × Σ(w × f) / Σ w`. A posição segue a nota decrescente, arredondada em 6 casas. O empate é desfeito pelo **nome da cidade** (`COLLATE "C"`, como nos bairros) e depois pelo código IBGE (há nomes repetidos entre estados).

Por que habitantes é o padrão: um município grande, com muita área rural, parece "vazio" por km² mesmo tendo cobertura suficiente para a população.

### Exemplo numérico (o mesmo de `backend/tests/test_city_rank.py`)

Um critério: hospitais (perto, peso 1).

| Cidade | População | Área (km²) | Hospitais | Por 10 mil hab. | Por km² |
|---|---|---|---|---|---|
| Alfa | 100.000 | 100 | 10 | 1,0 | 0,100 |
| Beta | 50.000 | 10 | 5 | 1,0 | 0,500 |
| Gama | 30.000 | 1.000 | 9 | 3,0 | 0,009 |
| Delta | 10.000 | 5 | 4 | 4,0 | 0,800 |

| Configuração | Resultado |
|---|---|
| Por habitantes, mínimo 20 mil (Delta fora) | 1º Gama 100; 2º Alfa 0; 3º Beta 0 (Alfa e Beta empatam; Alfa vem antes pelo nome) |
| Por km², mínimo 20 mil | 1º Beta 100; 2º Alfa 50; 3º Gama 0 |
| Por habitantes, sem mínimo | 1º Delta 100; 2º Gama 66,7; 3º Alfa 0; 4º Beta 0 |

Gama é o caso que motiva o padrão: é a primeira por habitantes e a última por km², por causa dos 1.000 km² de área.

### Cache

O resultado fica em memória. A chave combina alcance, critérios, normalização, mínimo, renda e versão dos dados (última carga + hash do mapeamento tipo→CNAE).
