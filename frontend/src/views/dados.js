// Dados e fontes (ref. 09): data_sources reais com data de referência, o que a cobertura significa e transparência.
import { get, getCached } from '../api.js';
import { appPage, legalFooter } from '../components/page.js';
import { loadCredits } from '../credits.js';
import { fmt, html } from '../html.js';
import { icon } from '../icons.js';
import { lastCity } from '../lib.js';
import { countNumber, growBar, skeleton } from '../motion.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const entered = { done: false };
const NO_DATA = (item) => `Não foi possível encontrar dados de ${item} desta área.`;
// Faixas de cobertura (as mesmas do motor: docs/SCORING.md): parte dos cadastros ativos localizados em bairro.
const COVERAGE = [
  ['alta', 0.8, 'Pelo menos 80% dos cadastros ativos foram localizados em um bairro. A posição do bairro reflete bem o que existe nele.'],
  ['média', 0.5, 'Entre 50% e 80% localizados. Leia a posição com cautela: parte dos estabelecimentos não entrou na conta do bairro.'],
  ['baixa', 0.5, 'Menos da metade localizada. Os números do bairro estão incompletos; confira no local antes de decidir.'],
];

export async function render(root) {
  const user = await loadUser();
  return appPage(root, {
    active: 'fontes',
    user,
    entered,
    skeleton: () => html`<div class="ov-head"><div><div class="ov-eyebrow">Dados e fontes</div><h1>De onde vêm os números</h1>${skeleton('14px', '55%')}</div></div>
      <section class="ov-block" style="min-height:300px">${skeleton('16px', '40%')}</section>`,
    load: () => Promise.all([getCached('/api/catalog/sources'), loadCredits().then((c) => (lastCity(c) ? get(`/api/cities/${lastCity(c).ibge}/status`).catch(() => null) : null))]),
    body: ([src, status]) => html`
      <div class="ov-head" data-cx><div>
        <div class="ov-eyebrow">Dados e fontes</div>
        <h1>De onde vêm os números</h1>
        <p>Só dados abertos, cada um com data de referência. Cadastro não é prédio: por isso cada área mostra a cobertura dos seus dados.</p>
      </div></div>
      <div class="ov-metrics is-three">
        <div class="ov-metric" data-cx><div class="ov-metric-top">Cidades com dados<span class="ov-miniicon">${icon('map', 16)}</span></div><strong>${countNumber(src.cities_with_data)}</strong><small>municípios com estabelecimentos carregados e localizados</small></div>
        <div class="ov-metric" data-cx><div class="ov-metric-top">Fontes<span class="ov-miniicon">${icon('info', 16)}</span></div><strong>${countNumber(src.sources.length + 1)}</strong><small>Receita Federal, IBGE, CNES e OpenStreetMap</small></div>
        <div class="ov-metric" data-cx><div class="ov-metric-top">Transparência por padrão<span class="ov-miniicon">${icon('check', 16)}</span></div><strong class="is-text">Fonte e data em cada número</strong><small>Sem dado, dizemos que não há. Nunca estimamos.</small></div>
      </div>
      <div class="ov-section-head" data-cx><h2>Fontes e datas de referência</h2><a class="ov-textlink" href="#/como-calculamos">Como calculamos ${icon('chevron', 14)}</a></div>
      <section class="ov-block" data-cx>
        <table class="src-table">
          <thead><tr><th scope="col">Fonte</th><th scope="col">O que fornece</th><th scope="col">Referência</th></tr></thead>
          <tbody>
            ${src.sources.map((s) => html`<tr><td><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a></td><td class="muted">${describe(s)}</td><td class="tabular">${s.reference_date}</td></tr>`)}
            <tr><td><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a></td><td class="muted">Mapa-base (ruas, água, rótulos), © OpenStreetMap, licença ODbL</td><td class="tabular">tiles atuais</td></tr>
          </tbody>
        </table>
      </section>
      <div class="ov-section-head" data-cx><h2>O que a cobertura significa</h2></div>
      <div class="ov-widegrid">
        <section class="ov-block" data-cx>
          <p class="small muted">O CNPJ não traz coordenadas: o bairro vem do texto do endereço, comparado com os nomes da malha do IBGE. A cobertura é a parte dos cadastros ativos que conseguimos localizar.</p>
          <ul class="cov-levels">
            ${COVERAGE.map(([name, v, text], i) => html`<li><div class="cov-level-head"><strong>Cobertura ${name}</strong><span class="tabular">${i === 0 ? '≥ 80%' : i === 1 ? '50% a 80%' : '< 50%'}</span></div>${growBar(i === 0 ? 0.9 : i === 1 ? 0.65 : 0.3, `Cobertura ${name}`)}<p class="small muted">${text}</p></li>`)}
          </ul>
        </section>
        <section class="ov-block" data-cx>
          <h3>${status ? `Cobertura em ${status.name}` : 'Cobertura por cidade'}</h3>
          ${status
            ? status.has_data
              ? html`<p class="ov-coverage"><strong class="tabular">${fmt.pct(status.coverage.share)}</strong> dos ${fmt.int(status.coverage.total_active)} cadastros ativos de CNPJ foram localizados em ${status.division_kind === 'area' ? 'áreas' : 'bairros'} (ref. ${status.reference_month}).</p>
                  ${growBar(status.coverage.share, `${fmt.pct(status.coverage.share)} localizados`)}
                  <p class="small muted">População ${status.population != null ? fmt.int(status.population) : NO_DATA('população')}${status.area_km2 ? ` · ${fmt.dec(status.area_km2)} km²` : ''} (IBGE, Censo 2022).</p>`
              : html`<p class="ov-empty">${NO_DATA('estabelecimentos')}</p>`
            : html`<p class="ov-empty">Abra uma cidade no explorador para ver a cobertura dela aqui. Cada análise mostra a cobertura da cidade e de cada bairro.</p>`}
        </section>
      </div>
      ${legalFooter()}`,
  });
}

function describe(s) {
  const k = s.key || '';
  if (k.startsWith('rfb')) return 'Estabelecimentos ativos por atividade principal (CNAE), agrupados por endereço';
  if (k === 'ms_cnes') return 'Unidades de saúde ativas (hospitais, prontos-socorros) com coordenadas';
  if (k.includes('renda')) return 'Renda mediana do responsável pelo domicílio, por setor censitário e bairro';
  if (k.includes('bairro') || k.includes('malha') || k.includes('setores')) return 'Limites territoriais (malhas aproximadas; não são divisão oficial)';
  if (k.includes('censo')) return 'População e área por município e bairro';
  return 'Dados abertos com data de referência';
}
