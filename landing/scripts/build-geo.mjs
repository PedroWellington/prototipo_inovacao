// Gera os arquivos geográficos estáticos da landing (landing/data/), sem rede em tempo de execução.
//   cd landing; npm install; npm run build-geo        (precisa do Docker com o banco no ar)
// Fontes:
//   - Estados, Nordeste, Brasil e municípios de PE: Malha Municipal 2022 do IBGE (data/raw/ibge/BR_Municipios_2022.zip,
//     já baixada pelo ETL do produto). Estados e regiões saem do "dissolve" dos municípios: as divisas coincidem.
//   - Bairros do Recife: a mesma base do produto (tabela neighborhoods, malha de bairros do Censo 2022 do IBGE).
// Saída: TopoJSON em Web Mercator (metros, EPSG:3857), quantizado, com 2 ou 3 níveis de detalhe por camada.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import mapshaper from 'mapshaper';

const LANDING = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(LANDING, '..');
const OUT = join(LANDING, 'data');
const BUILD = join(LANDING, '.build');
const MUN_ZIP = join(REPO, 'data/raw/ibge/BR_Municipios_2022.zip');
const BAIRROS = join(BUILD, 'bairros-recife.geojson');
const RECIFE = 2611606;
const NE = ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'];

// interval = tolerância de simplificação em metros; q = passo de quantização em metros (interval/8).
// O cliente usa o nível mais leve cujo interval ainda fica abaixo de ~1 pixel de tela.
const LAYERS = {
  brasil: { budget: 150_000, lods: [2500, 500] },
  pe: { budget: 150_000, lods: [1000, 200, 40] },
  recife: { budget: 120_000, lods: [40, 10, 3] },
};

mkdirSync(OUT, { recursive: true });
mkdirSync(BUILD, { recursive: true });
if (!existsSync(MUN_ZIP)) {
  throw new Error(`Falta ${MUN_ZIP}. Rode o ETL do produto (app.etl.census) ou baixe a Malha Municipal 2022 do IBGE.`);
}

// 1. Bairros do Recife exportados do banco do produto (nunca baixados de novo).
const sql = `SELECT json_build_object('type','FeatureCollection','features', json_agg(json_build_object(
  'type','Feature','properties', json_build_object('name', name, 'code', ibge_code),
  'geometry', ST_AsGeoJSON(geom, 7)::json) ORDER BY name))
  FROM neighborhoods WHERE municipality_ibge = ${RECIFE} AND kind = 'bairro'`;
const exported = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'sh', '-c', 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'], {
  cwd: REPO, input: sql, maxBuffer: 256 * 1024 * 1024,
}).toString().trim();
const bairros = JSON.parse(exported);
if (!bairros.features?.length) throw new Error('Nenhum bairro do Recife no banco: rode load_city --ibge 2611606.');
writeFileSync(BAIRROS, exported);
console.log(`bairros do Recife exportados do banco: ${bairros.features.length}`);

// 2. mapshaper: projeção, dissolve e um arquivo por nível de detalhe.
const q = (interval, span) => Math.ceil(span / (interval / 8));
async function run(name, input, layersCmd, spanMeters) {
  const files = [];
  for (const [i, interval] of LAYERS[name].lods.entries()) {
    const file = `${name}-${i}.json`;
    await mapshaper.runCommands(
      `${input} -proj EPSG:3857 ${layersCmd} -simplify interval=${interval} keep-shapes planar ` +
        `-o target=* format=topojson quantization=${q(interval, spanMeters)} ${JSON.stringify(join(OUT, file))}`,
    );
    const raw = readFileSync(join(OUT, file));
    files.push({ file, interval, bytes: raw.length, gzip: gzipSync(raw, { level: 9 }).length });
  }
  return files;
}

const mun = `-i ${JSON.stringify(MUN_ZIP)} name=municipios -filter-fields CD_MUN,NM_MUN,SIGLA_UF`;
const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  crs: 'EPSG:3857',
  layers: {
    // Estados do país, o Nordeste (9 UFs) e o contorno do Brasil: todos da mesma topologia.
    brasil: await run('brasil', mun,
      `-dissolve SIGLA_UF name=estados -rename-fields uf=SIGLA_UF ` +
        `-filter target=estados '${JSON.stringify(NE)}.indexOf(uf) > -1' name=ne + ` +
        `-dissolve target=ne name=nordeste ` +
        `-dissolve target=estados name=brasil +`,
      4_800_000),
    // Municípios de Pernambuco (contexto vizinho do Recife) e o contorno do estado.
    pe: await run('pe', mun,
      `-filter "SIGLA_UF === 'PE'" -each "code = +CD_MUN, name = NM_MUN, delete CD_MUN, delete NM_MUN, delete SIGLA_UF" ` +
        `-dissolve name=pernambuco +`,
      1_100_000),
    // Bairros do Recife e o contorno da cidade a partir deles (mesma geometria, sem frestas).
    recife: await run('recife', `-i ${JSON.stringify(BAIRROS)} name=bairros snap`,
      `-filter-fields name -dissolve name=cidade +`,
      30_000),
  },
};

// 3. Orçamento comprimido por grupo (soma dos níveis, como o navegador baixa).
let over = false;
for (const [name, files] of Object.entries(manifest.layers)) {
  const gz = files.reduce((s, f) => s + f.gzip, 0);
  const ok = gz <= LAYERS[name].budget;
  over ||= !ok;
  console.log(`${name.padEnd(7)} ${files.map((f) => `${f.file} ${(f.gzip / 1024).toFixed(1)} KB`).join(' · ')} => ${(gz / 1024).toFixed(1)} KB gzip ${ok ? 'ok' : `ACIMA de ${LAYERS[name].budget / 1000} KB`}`);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

// 4. FONTES.md com as datas reais dos arquivos usados.
const day = (p) => statSync(p).mtime.toISOString().slice(0, 10);
writeFileSync(join(OUT, 'FONTES.md'), `# Fontes dos dados geográficos da landing

Gerado por \`npm run build-geo\` em ${manifest.generated}. Não edite à mão; ajuste \`scripts/build-geo.mjs\`.
Todos os arquivos estão em Web Mercator (EPSG:3857), simplificados com topologia preservada (mapshaper) e quantizados.

| Arquivos | Conteúdo | Fonte e órgão | Ano de referência | URL | Licença (conforme a fonte) | Obtido em |
|---|---|---|---|---|---|---|
| \`brasil-*.json\` | 27 UFs, o Nordeste (união de AL, BA, CE, MA, PB, PE, PI, RN, SE) e o contorno do Brasil | Malha Municipal 2022, IBGE (dissolvida por UF) | 2022 | https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Brasil/BR/BR_Municipios_2022.zip | Sem licença explícita no Leia-me da malha; citar "IBGE" como fonte. Ver as limitações abaixo. | ${day(MUN_ZIP)} |
| \`pe-*.json\` | ${JSON.parse(readFileSync(join(OUT, 'pe-0.json'))).objects.municipios.geometries.length} municípios de Pernambuco e o contorno do estado | Malha Municipal 2022, IBGE | 2022 | mesma URL acima | idem (citar "IBGE") | ${day(MUN_ZIP)} |
| \`recife-*.json\` | ${bairros.features.length} bairros do Recife e o contorno da cidade (união dos bairros) | Malha de Bairros do Censo 2022, IBGE, exportada do banco do produto (tabela \`neighborhoods\`, \`source = ibge_bairros\`) | 2022 | https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/bairros/gpkg/UF/PE/PE_bairros_CD2022.gpkg | Licença não conferida para este arquivo; citar "IBGE" como fonte | ${day(join(REPO, 'data/raw/ibge/PE_bairros_CD2022.gpkg'))} |

**Limitações declaradas pelo IBGE** ([Leia-me da Malha Municipal 2022](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Leia_me.pdf)): os limites são **aproximados**; a malha "não pode ser utilizada, em nenhuma hipótese, como sendo uma malha oficial da divisão político-administrativa"; a linha de costa tem finalidade operacional. Por isso a landing diz "limites do IBGE", nunca "demarcação oficial". Documentação completa: Nota Metodológica Malha Municipal Digital e Áreas Territoriais 2022 (biblioteca do IBGE).

Comparação com os "Limites dos bairros" da Prefeitura do Recife: ver [../docs/COMPARACAO-BAIRROS.md](../docs/COMPARACAO-BAIRROS.md).

## Níveis de detalhe

| Arquivo | Tolerância (m) | Bytes | gzip |
|---|---|---|---|
${Object.values(manifest.layers).flat().map((f) => `| \`${f.file}\` | ${f.interval} | ${f.bytes} | ${f.gzip} |`).join('\n')}
`);
if (over) process.exitCode = 1;
