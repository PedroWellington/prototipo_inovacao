// Visão geral (tela inicial pós-login): tudo com dados reais da conta. O que é ilustração diz que é.
import { get, getCached } from '../api.js';
import { companyCard, daysText } from '../components/account.js';
import { topbar } from '../components/topbar.js';
import { loadCredits } from '../credits.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { activeCities, firstName, lastCity } from '../lib.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const DISCLAIMER =
  'Informações de caráter informativo. Não substituem análise própria ou profissional. Não constituem aconselhamento jurídico nem financeiro.';
const DIRECTION = { attract: 'Quero perto', repel: 'Não quero perto' };
const NO_DATA = (item) => `Não foi possível encontrar dados de ${item} desta área.`;
let entered = false; // entrada escalonada só na primeira exibição da sessão

// Desenho abstrato (não é mapa de lugar nenhum): só ilustra a ideia de aproximar um bairro.
const ART = html`<svg viewBox="0 0 480 340" aria-hidden="true" focusable="false">
  <defs><pattern id="ovGrid" patternUnits="userSpaceOnUse" width="30" height="30" patternTransform="rotate(7)"><path d="M30 0H0V30" class="ov-art-grid"/></pattern></defs>
  <rect x="10" y="10" width="460" height="320" rx="22" fill="url(#ovGrid)" class="ov-art-frame"/>
  <path class="ov-art-land" d="M40 90 120 52 182 74 214 30 292 52 352 26 440 92 410 150 454 210 380 252 360 306 252 314 196 266 116 290 36 196Z"/>
  <path class="ov-art-road" d="M-10 186C96 140 150 204 256 150S420 128 490 48M-10 262C124 188 222 240 300 220S438 200 492 168M66-10C122 140 172 262 226 350M290-10C214 118 312 212 378 350"/>
  <path class="ov-art-pick" d="M250 132 314 114 352 164 330 220 274 232 228 196Z"/>
  <circle cx="290" cy="174" r="24" class="ov-art-ring"/><circle cx="290" cy="174" r="8" class="ov-art-dot"/>
</svg>`;

export async function render(root) {
  const [user, profile, credits, types] = await Promise.all([
    loadUser(),
    get('/api/profile'),
    loadCredits(true),
    getCached('/api/catalog/business-types'),
  ]);
  const p = profile.profile || {};
  const typeName = Object.fromEntries(types.map((t) => [t.key, t.name]));
  const last = lastCity(credits);
  const active = activeCities(credits);
  const r = credits.rules;
  const hq = p.has_hq && p.hq_city_name ? `${p.hq_city_name} – ${p.hq_uf}` : null;
  const items = [
    ...credits.cities.map((c) => ({ ...c, kind: 'city', label: `${c.name} – ${c.uf}` })),
    ...credits.searches.map((s) => ({ ...s, kind: 'search', label: `Ranking de cidades: ${s.label}` })),
  ].sort((a, b) => b.active - a.active || b.unlocked_at.localeCompare(a.unlocked_at));
  const lastOpen = last ? html`data-open-city="${last.ibge}"` : html`data-go="/explorer"`;

  mount(
    root,
    html`<div class="app-shell" data-dashboard>
      ${topbar({ active: 'home', user, profile: p })}
      <main class="overview" id="main">
        <div class="ov-head ov-animate">
          <div>
            <div class="ov-eyebrow">Visão geral</div>
            <h1>Olá, ${firstName(user.name)}.<br /><span>O seu próximo território, com mais clareza.</span></h1>
            <p>Explore cidades, ajuste os critérios do seu negócio e compare bairros. A decisão continua nas suas mãos.</p>
          </div>
          ${companyCard(p, user, { compact: true })}
        </div>

        <div class="ov-topgrid">
          <section class="ov-hero ov-animate" aria-labelledby="ovHeroTitle">
            <div class="ov-hero-copy">
              <div class="ov-hero-tag">Comece pelo território</div>
              <h2 id="ovHeroTitle">Do Brasil ao bairro.<br />Sem perder o contexto.</h2>
              <p>Navegue da região à cidade em uma câmera contínua e compare bairros com os critérios que você definiu.</p>
              <button type="button" class="ov-btn" data-go="/explorer">${icon('map', 16)} Analisar uma cidade</button>
            </div>
            <div class="ov-hero-art">${ART}</div>
            <span class="ov-art-label">Aproximação ilustrativa</span>
          </section>
          <div class="ov-sidestack">
            <div class="ov-sidelarge ov-animate">
              <div class="ov-kicker">01 / Seu negócio</div>
              <h3>Você escolhe<br />os critérios.</h3>
              <p>A plataforma ordena áreas conforme as preferências do seu negócio, sem promessas de resultado.</p>
              <div class="ov-orbit" aria-hidden="true"></div>
            </div>
            <div class="ov-quick ov-animate">
              <div>
                <strong>${last ? `Continuar em ${last.name}` : 'Analisar uma cidade'}</strong>
                <small>${last
                  ? last.active
                    ? `Análise aberta, ${daysText(last)}. Reabrir no prazo não gasta crédito.`
                    : 'O prazo desta análise venceu: reabrir usa 1 crédito, com confirmação antes.'
                  : 'Escolha região, estado e cidade, ou veja as cidades que mais combinam com seus critérios.'}</small>
              </div>
              <button type="button" class="ov-round" ${lastOpen} aria-label="${last ? `Abrir ${last.name}` : 'Abrir o explorador'}">${icon('chevron', 18)}</button>
            </div>
          </div>
        </div>

        <div class="ov-section-head ov-animate"><h2>Seu espaço de trabalho</h2><span>Dados da sua conta</span></div>
        <div class="ov-metrics ${hq ? '' : 'is-three'}">
          <div class="ov-metric ov-animate">
            <div class="ov-metric-top">Plano atual<span class="ov-miniicon">${icon('layers', 16)}</span></div>
            <strong class="is-text">${credits.plan}</strong><small>Plano da sua conta</small>
          </div>
          <div class="ov-metric ov-animate">
            <div class="ov-metric-top">Créditos<span class="ov-miniicon">${icon('coin', 16)}</span></div>
            <strong class="tabular">${fmt.int(credits.balance)}</strong>
            <small>1 crédito = 1 cidade por ${r.city_unlock_days} dias. O ranking de cidades usa ${r.city_search_cost} por busca.</small>
          </div>
          <div class="ov-metric ov-animate">
            <div class="ov-metric-top">Análises ativas<span class="ov-miniicon">${icon('map', 16)}</span></div>
            <strong class="tabular">${fmt.int(active.length)}</strong>
            <small>${active.length === 1 ? 'cidade aberta e no prazo' : 'cidades abertas e no prazo'}</small>
          </div>
          ${hq
            ? html`<div class="ov-metric ov-animate">
                <div class="ov-metric-top">Sede<span class="ov-miniicon">${icon('pin', 16)}</span></div>
                <strong class="is-text">${hq}</strong>
                <small>${p.hq_neighborhood_text ? `${p.hq_neighborhood_text}. ` : ''}A sede não entra no cálculo.</small>
              </div>`
            : ''}
        </div>

        <div class="ov-section-head ov-animate"><h2>Uma análise que parte das suas preferências</h2><span>Você tem o controle</span></div>
        <div class="ov-bottomgrid">
          <section class="ov-block ov-animate" aria-labelledby="ovCrit">
            <div class="ov-block-header"><h3 id="ovCrit">Critérios da sua empresa</h3>
              <button type="button" class="ov-textlink" ${last?.active ? html`data-open-city="${last.ibge}"` : html`data-go="/explorer"`}>Editar no mapa ${icon('chevron', 14)}</button></div>
            ${profile.criteria.length
              ? html`<ol class="ov-criteria">${profile.criteria.map(
                  (c, i) => html`<li class="ov-criterion">
                    <span class="ov-criterion-num tabular">${String(i + 1).padStart(2, '0')}</span>
                    <div><strong>${typeName[c.business_type_key] || c.business_type_key}</strong><small>${DIRECTION[c.direction]}</small></div>
                    <span class="ov-weight tabular">Peso ${c.weight}</span>
                  </li>`,
                )}</ol>`
              : html`<p class="ov-empty">Nenhum critério ainda. No explorador, adicione o que você quer perto e o que não quer perto do seu negócio.</p>`}
          </section>
          <section class="ov-block ov-animate" aria-labelledby="ovHow">
            <div class="ov-block-header"><h3 id="ovHow">Como funciona sua pesquisa</h3>
              <a class="ov-textlink" href="#/como-calculamos">Como calculamos ${icon('chevron', 14)}</a></div>
            <ol class="ov-process">
              <li><span class="ov-step">01</span><div><strong>Escolha o território</strong><p>Por região, estado e cidade, ou peça as cidades que mais combinam com seus critérios.</p></div></li>
              <li><span class="ov-step">02</span><div><strong>Personalize os pesos</strong><p>Defina o que quer perto e o que prefere longe, com peso de 1 a 5.</p></div></li>
              <li><span class="ov-step">03</span><div><strong>Compare com transparência</strong><p>Veja a posição de cada bairro e confira fontes, datas e cobertura dos dados.</p></div></li>
            </ol>
          </section>
        </div>

        <div class="ov-section-head ov-animate"><h2>Continuidade e transparência</h2></div>
        <div class="ov-widegrid">
          <section class="ov-block ov-animate" id="analises" aria-labelledby="ovAn">
            <div class="ov-block-header"><h3 id="ovAn">Minhas análises</h3>
              <button type="button" class="ov-textlink" data-go="/explorer">Nova análise ${icon('chevron', 14)}</button></div>
            ${items.length
              ? html`<ul class="ov-analyses">${items.map(
                  (x) => html`<li><button type="button" class="ov-analysis ${x.active ? '' : 'is-expired'}"
                      ${x.kind === 'city' ? html`data-open-city="${x.ibge}"` : html`data-open-search="${x.scope_key}"`}>
                    <span class="ov-miniicon">${icon(x.kind === 'city' ? 'map' : 'list', 15)}</span>
                    <span class="ov-analysis-name">${x.label}</span>
                    <span class="ov-analysis-days small tabular">${icon('clock', 13)} ${daysText(x)}</span>
                  </button></li>`,
                )}</ul>`
              : html`<p class="ov-empty">Nenhuma análise ainda. Abra uma cidade para começar: cada análise fica aqui com os dias de validade.</p>`}
          </section>
          <section class="ov-block ov-animate" id="fontes" aria-labelledby="ovSrc">
            <div class="ov-block-header"><h3 id="ovSrc">Dados e fontes</h3></div>
            <div class="ov-sources" data-sources aria-busy="true">
              <span class="skeleton" style="height:14px;width:70%"></span><span class="skeleton" style="height:14px;width:85%"></span>
              <span class="skeleton" style="height:14px;width:60%"></span><span class="skeleton" style="height:14px;width:75%"></span>
            </div>
          </section>
        </div>
        <p class="ov-footnote ov-animate">${DISCLAIMER}</p>
      </main>
    </div>`,
  );

  // Entrada escalonada (opacity + transform) só na primeira vez nesta sessão; ao voltar, a tela já está pronta.
  const shell = root.querySelector('[data-dashboard]');
  if (!entered) {
    root.querySelectorAll('.ov-animate').forEach((el, i) => el.style.setProperty('--i', Math.min(i, 12)));
    shell.classList.add('is-entering');
    entered = true;
  }
  const section = new URLSearchParams(location.hash.split('?')[1] || '').get('s');
  if (section) root.querySelector(`#${section === 'analises' ? 'analises' : 'fontes'}`)?.scrollIntoView({ block: 'start' });

  // Fontes e cobertura: depois do primeiro desenho, num bloco de altura fixa (sem salto de layout).
  const ac = new AbortController();
  Promise.all([getCached('/api/catalog/sources'), last ? get(`/api/cities/${last.ibge}/status`).catch(() => null) : null])
    .then(([src, status]) => {
      const box = root.querySelector('[data-sources]');
      if (!box || ac.signal.aborted) return;
      box.removeAttribute('aria-busy');
      mount(
        box,
        html`<p class="ov-coverage">${status
            ? status.has_data
              ? html`<strong class="tabular">${fmt.pct(status.coverage.share)}</strong> dos ${fmt.int(status.coverage.total_active)} cadastros ativos de CNPJ de ${status.name} foram localizados em ${status.division_kind === 'area' ? 'áreas' : 'bairros'} (ref. ${status.reference_month}).`
              : NO_DATA('estabelecimentos')
            : html`Dados carregados em <strong class="tabular">${fmt.int(src.cities_with_data)}</strong> cidades. Cada análise mostra a cobertura da cidade.`}</p>
          <ul class="ov-source-list">${src.sources.map(
            (s) => html`<li><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a><span class="tabular">ref. ${s.reference_date}</span></li>`,
          )}<li><span>Mapa-base: © OpenStreetMap contributors</span></li></ul>`,
      );
    })
    .catch(() => {
      const box = root.querySelector('[data-sources]');
      if (box) mount(box, html`<p class="ov-empty">${NO_DATA('fontes')}</p>`);
    });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-city], [data-open-search], [data-go]');
    if (!b) return;
    if (b.dataset.openCity) go(`/explorer?city=${b.dataset.openCity}`);
    else if (b.dataset.openSearch) go(`/explorer?search=${b.dataset.openSearch}`);
    else go(b.dataset.go);
  }, { signal: ac.signal });
  return () => ac.abort();
}
