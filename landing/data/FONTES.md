# Fontes dos dados geográficos da landing

Gerado por `npm run build-geo` em 2026-11-15. Não edite à mão; ajuste `scripts/build-geo.mjs`.
Todos os arquivos estão em Web Mercator (EPSG:3857), simplificados com topologia preservada (mapshaper) e quantizados.

| Arquivos | Conteúdo | Fonte e órgão | Ano de referência | URL | Licença (conforme a fonte) | Obtido em |
|---|---|---|---|---|---|---|
| `brasil-*.json` | 27 UFs, o Nordeste (união de AL, BA, CE, MA, PB, PE, PI, RN, SE) e o contorno do Brasil | Malha Municipal 2022, IBGE (dissolvida por UF) | 2022 | https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Brasil/BR/BR_Municipios_2022.zip | Sem licença explícita no Leia-me da malha; citar "IBGE" como fonte. Ver as limitações abaixo. | 2026-11-14 |
| `pe-*.json` | 185 municípios de Pernambuco e o contorno do estado | Malha Municipal 2022, IBGE | 2022 | mesma URL acima | idem (citar "IBGE") | 2026-11-14 |
| `recife-*.json` | 94 bairros do Recife e o contorno da cidade (união dos bairros) | Malha de Bairros do Censo 2022, IBGE, exportada do banco do produto (tabela `neighborhoods`, `source = ibge_bairros`) | 2022 | https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/gpkg/UF/PE/PE_bairros_CD2022.gpkg | Sem licença explícita no arquivo, na pasta do FTP nem na publicação metodológica; citar "IBGE" como fonte. Ver as condições abaixo. | 2026-11-14 |

**Limitações declaradas pelo IBGE** ([Leia-me da Malha Municipal 2022](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Leia_me.pdf)): os limites são **aproximados**; a malha "não pode ser utilizada, em nenhuma hipótese, como sendo uma malha oficial da divisão político-administrativa"; a linha de costa tem finalidade operacional. Por isso a landing e o app dizem "malha do IBGE", nunca "limites oficiais". Documentação completa: Nota Metodológica Malha Municipal Digital e Áreas Territoriais 2022 (biblioteca do IBGE).

**Condições de uso da Malha de Bairros (conferido em 15/11/2026):**

- A pasta do FTP (`censo_2022/bairros/`) só tem os arquivos, sem Leia-me nem termo de uso. O GeoPackage não traz metadados de licença, só a data da última alteração (2024-11-08).
- A publicação [Censo Demográfico 2022: Malha de Setores Censitários](https://biblioteca.ibge.gov.br/visualizacao/livros/liv102138.pdf) (IBGE, 120 p.) não traz licença nem termo de uso.
  - Na p. 14, define bairros como divisões "legalmente instituídos pelo Poder Municipal", representados por setores censitários.
  - Avisa que "em algumas situações, os limites originais dos bairros precisaram ser aproximados graficamente". Isso explica parte das diferenças em relação à malha da Prefeitura.
- O registro de metadados do IBGE ([Malha de Bairros 2022](https://metadadosgeo.ibge.gov.br/geonetwork_ibge/srv/api/records/c0a902c4-1e02-43b3-ac7b-1318cc733da5)) pode trazer restrições de uso. Ele bloqueia acesso automatizado e **não foi lido: conferir num navegador e anotar aqui**.
- Até lá: citar "IBGE" como fonte, apresentar os limites como aproximados e não sugerir demarcação oficial.

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
