# Fontes dos dados geográficos da landing

Gerado por `npm run build-geo` em 2026-11-15. Não edite à mão; ajuste `scripts/build-geo.mjs`.
Todos os arquivos estão em Web Mercator (EPSG:3857), simplificados com topologia preservada (mapshaper) e quantizados.

| Arquivos | Conteúdo | Fonte e órgão | Ano de referência | URL | Licença (conforme a fonte) | Obtido em |
|---|---|---|---|---|---|---|
| `brasil-*.json` | 27 UFs, o Nordeste (união de AL, BA, CE, MA, PB, PE, PI, RN, SE) e o contorno do Brasil | Malha Municipal 2022, IBGE (dissolvida por UF) | 2022 | https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Brasil/BR/BR_Municipios_2022.zip | Sem licença explícita no Leia-me da malha; citar "IBGE" como fonte. Ver as limitações abaixo. | 2026-11-14 |
| `pe-*.json` | 185 municípios de Pernambuco e o contorno do estado | Malha Municipal 2022, IBGE | 2022 | mesma URL acima | idem (citar "IBGE") | 2026-11-14 |
| `recife-*.json` | 94 bairros do Recife e o contorno da cidade (união dos bairros) | Malha de Bairros do Censo 2022, IBGE, exportada do banco do produto (tabela `neighborhoods`, `source = ibge_bairros`) | 2022 | https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/gpkg/UF/PE/PE_bairros_CD2022.gpkg | Licença não conferida para este arquivo; citar "IBGE" como fonte | 2026-11-14 |

**Limitações declaradas pelo IBGE** ([Leia-me da Malha Municipal 2022](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Leia_me.pdf)): os limites são **aproximados**; a malha "não pode ser utilizada, em nenhuma hipótese, como sendo uma malha oficial da divisão político-administrativa"; a linha de costa tem finalidade operacional. Por isso a landing diz "limites do IBGE", nunca "demarcação oficial". Documentação completa: Nota Metodológica Malha Municipal Digital e Áreas Territoriais 2022 (biblioteca do IBGE).

Comparação com os "Limites dos bairros" da Prefeitura do Recife: ver [../docs/COMPARACAO-BAIRROS.md](../docs/COMPARACAO-BAIRROS.md).

## Níveis de detalhe

| Arquivo | Tolerância (m) | Bytes | gzip |
|---|---|---|---|
| `brasil-0.json` | 2500 | 50089 | 15226 |
| `brasil-1.json` | 500 | 220666 | 63624 |
| `pe-0.json` | 1000 | 47960 | 14986 |
| `pe-1.json` | 200 | 111364 | 35192 |
| `pe-2.json` | 40 | 266238 | 87121 |
| `recife-0.json` | 40 | 26115 | 8666 |
| `recife-1.json` | 10 | 49479 | 16967 |
| `recife-2.json` | 3 | 85112 | 29607 |
