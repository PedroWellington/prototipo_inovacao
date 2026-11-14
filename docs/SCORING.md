# Como o VICUS ordena os bairros

O ranking mostra os **bairros que mais combinam com os critérios que você definiu**. Ele não recomenda bairro, não prevê resultado e não usa nenhum atributo pessoal ou protegido.

- **Onde é calculado:** inteiramente no banco, num único SQL em [`backend/app/scoring/rank.py`](../backend/app/scoring/rank.py). O frontend não calcula nota.
- **Endpoint:** `POST /api/cities/{ibge}/rank`
- **Testes:** [`backend/tests/test_scoring.py`](../backend/tests/test_scoring.py)

## Bairros e áreas

O motor é o mesmo para qualquer cidade. Onde o IBGE não tem bairros oficiais, as unidades comparadas são **áreas formadas por setores censitários** (ver [DATA.md](DATA.md)). A fórmula não muda; só o vocabulário da tela troca "bairro" por "área", e a tela mostra um aviso. As áreas rurais são grandes, então tendem a ter densidade baixa: a nota é relativa, e isso aparece na frase comparativa e na cobertura.

## Entrada

Uma lista de critérios. Cada critério tem:

- `business_type_key`: o tipo de estabelecimento (farmácia, hospital…);
- `direction`: `attract` (quero perto) ou `repel` (não quero perto);
- `weight`: peso de 1 a 5.

O limite é de 3 critérios por direção.

## Fórmula

Para cada bairro `b` da cidade e cada critério `c`:

1. **Densidade:** `d(b,c) = estabelecimentos do tipo c no bairro b / área de b em km²`.
   - A área vem de `ST_Area(geom::geography)` sobre o limite oficial do IBGE.
   - Um tipo pode reunir vários CNAEs. Por exemplo, farmácia = 4771-7/01 + 4771-7/02 + 4771-7/03. Todos são somados.
   - Conta **estabelecimentos** (matriz e filial), não empresas.
2. **Percentil:** `p(b,c) = PERCENT_RANK() OVER (PARTITION BY c ORDER BY d)`, entre 0 e 1.
   - O valor é a fração dos *outros* bairros com densidade menor.
   - Bairros empatados recebem o mesmo percentil. Se todos empatam, `p = 0` para todos.
3. **Aderência:** `f = p` se o critério for `attract`, ou `f = 1 − p` se for `repel`.
4. **Nota (0 a 100):** `nota(b) = 100 × Σ(w_c × f(b,c)) / Σ(w_c)`.
5. **Posição:** nota decrescente.
   - Empates são desfeitos pelo nome do bairro, em ordem alfabética, e depois pelo id.
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
