import { get, getCached, post, put } from '../api.js';
import { fmt, html, mount } from '../html.js';
import { icon, logo } from '../icons.js';
import { bbox, COVERAGE_LABEL, debounce, DIRECTION_LABEL, establishmentsText, normalize } from '../lib.js';
import { createMap } from '../map/mapView.js';
import '../styles/explorer.css';

const BRAZIL = [[-74, -34], [-34, 5.5]];
const MAX_PER_DIRECTION = 3;
const TOP = 10;
const MAX_CITY_ROWS = 300;
// Cidades sem bairro formal usam "áreas" por setor censitário: muda só o vocabulário da tela.
const UNITS = {
  bairro: { many: 'bairros', Many: 'Bairros', of: 'do bairro', inAny: 'algum dos', all: (n) => `Todos os ${n} bairros`, top: (n) => `Os ${n} que mais combinam`, seeAll: 'Ver todos os bairros', among: 'os bairros' },
  area: { many: 'áreas', Many: 'Áreas', of: 'da área', inAny: 'alguma das', all: (n) => `Todas as ${n} áreas`, top: (n) => `As ${n} que mais combinam`, seeAll: 'Ver todas as áreas', among: 'as áreas' },
};
const NO_DATA = (item) => `Não foi possível encontrar dados de ${item} desta área.`;
const DISCLAIMER =
  'Informações de caráter informativo. Não substituem análise própria ou profissional. Não constituem aconselhamento jurídico nem financeiro.';

export async function render(root) {
  mount(
    root,
    html`<div class="explorer">
      <header class="ex-top">
        <a href="#/explorer" class="ex-logo" aria-label="Início">${logo()}</a>
        <nav class="crumbs" aria-label="Navegação por nível" data-crumbs></nav>
        <div class="ex-top-actions">
          <a class="btn btn-ghost btn-sm" href="#/onboarding">${icon('sliders', 16)}<span class="hide-sm">Editar perfil</span></a>
          <a class="btn btn-ghost btn-sm" href="#/conta">${icon('user', 16)}<span class="hide-sm">Minha conta</span></a>
        </div>
      </header>
      <aside class="ex-panel" aria-label="Painel">
        <div class="ex-loading" data-loading hidden><span></span></div>
        <div data-panel></div>
      </aside>
      <section class="ex-map" aria-label="Mapa">
        <div class="map" data-map></div>
        <div class="legend" data-legend hidden>
          <div class="legend-bar" aria-hidden="true"></div>
          <div class="legend-scale small"><span>combina menos</span><span>combina mais</span></div>
          <p class="small">Verde = combina mais com seus critérios; vermelho = combina menos; o número é a posição.</p>
        </div>
        <div class="tooltip" data-tooltip role="tooltip" hidden></div>
      </section>
      <footer class="ex-footer small">${DISCLAIMER}</footer>
    </div>`,
  );

  const $ = (sel) => root.querySelector(sel);
  const panel = $('[data-panel]');
  const tooltip = $('[data-tooltip]');
  const ac = new AbortController();
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });

  // ---------- Estado ----------
  const s = {
    level: 'region',
    region: null,
    state: null,
    city: null,
    cityStatus: null,
    criteria: [],
    rank: null,
    rankById: new Map(),
    rankVersion: 0,
    rankError: null,
    loadingRank: false,
    showAll: false,
    selectedId: null,
    cityQuery: '',
    cities: [],
    hoods: new Map(), // id -> { name, bounds, label }
  };

  const [types, profile, regions, regionsGeo] = await Promise.all([
    getCached('/api/catalog/business-types'),
    get('/api/profile'),
    getCached('/api/geo/regions'),
    getCached('/api/geo/regions.geojson'),
  ]);
  const typeByKey = Object.fromEntries(types.map((t) => [t.key, t]));
  s.criteria = profile.criteria.map((c) => ({ ...c }));

  const map = createMap($('[data-map]'), { onHover, onClick });
  map.setData('regions', regionsGeo);
  map.setLevel('region');

  // ---------- Navegação entre níveis (o mapa nunca é recriado: só dados, visibilidade e câmera) ----------
  async function goRegion() {
    Object.assign(s, { level: 'region', region: null, state: null, city: null });
    hideTooltip();
    await map.setLevel('region');
    map.fit(BRAZIL);
    renderAll();
  }

  async function goState(region) {
    Object.assign(s, { level: 'state', region, state: null, city: null, statesList: null });
    hideTooltip();
    renderAll();
    const [statesGeo, list] = await Promise.all([getCached('/api/geo/states.geojson'), getCached(`/api/geo/states?region=${region.id}`)]);
    s.statesList = list;
    s.statesGeo = statesGeo;
    await map.setData('states', statesGeo);
    await map.filterStates(region.id);
    await map.setLevel('state');
    map.fit(bbox(regionsGeo.features.find((f) => f.id === region.id)));
    renderPanel();
  }

  async function goCity(state) {
    const region = s.region || regions.find((r) => r.id === state.region_id);
    Object.assign(s, { level: 'city', region, state, city: null, cityQuery: '', cities: [] });
    hideTooltip();
    renderAll();
    const [list, munisGeo, statesGeo] = await Promise.all([
      get(`/api/geo/municipalities?uf=${state.uf}`),
      getCached(`/api/geo/municipalities.geojson?uf=${state.uf}`),
      getCached('/api/geo/states.geojson'),
    ]);
    if (s.state !== state) return; // usuário já navegou para outro lugar
    s.cities = list;
    await map.setData('munis', munisGeo);
    await map.markMunicipalities(list.filter((c) => c.has_data).map((c) => c.id));
    await map.setLevel('city');
    map.fit(bbox(statesGeo.features.find((f) => f.id === state.id)));
    renderPanel();
  }

  const cityGeo = new Map(); // cache em memória das geometrias já vistas
  async function loadHoods(cityId) {
    const status = await get(`/api/cities/${cityId}/status`);
    if (!status.has_data) return { status };
    const url = `/api/cities/${cityId}/neighborhoods.geojson?v=${encodeURIComponent(status.loaded_at)}`;
    if (!cityGeo.has(url)) cityGeo.set(url, getCached(url));
    return { status, geo: await cityGeo.get(url) };
  }

  async function goResult(city) {
    Object.assign(s, { level: 'result', city, rank: null, rankError: null, cityStatus: null, selectedId: null, showAll: false });
    hideTooltip();
    renderAll();
    let loaded;
    try {
      loaded = await loadHoods(city.id);
    } catch (e) {
      s.rankError = e.message;
      return renderPanel();
    }
    if (s.city !== city) return;
    s.cityStatus = loaded.status;
    if (!loaded.geo) return renderPanel();
    s.hoods = new Map(
      loaded.geo.features.map((f) => [f.id, { name: f.properties.name, bounds: bbox(f), label: [f.properties.lx, f.properties.ly] }]),
    );
    await map.clearRank();
    await map.setHoods(loaded.geo);
    await map.setLevel('result');
    map.fit(bbox(loaded.geo));
    renderPanel();
    runRank();
  }

  // ---------- Ranking (backend) ----------
  let rankCtrl = null;
  async function runRank() {
    if (s.level !== 'result' || !s.cityStatus?.has_data) return;
    rankCtrl?.abort(); // cancela o pedido anterior: só a resposta mais nova importa
    rankCtrl = new AbortController();
    const city = s.city;
    setLoading(true);
    try {
      const res = await post(`/api/cities/${city.id}/rank`, { criteria: s.criteria }, { signal: rankCtrl.signal });
      if (s.city !== city) return;
      s.rank = res;
      s.rankById = new Map((res.neighborhoods || []).map((n) => [n.id, n]));
      s.rankVersion = (s.rankVersion || 0) + 1; // invalida o conteúdo do tooltip aberto
      s.rankError = null;
      if (res.status === 'ok') {
        const labels = new Map([...s.hoods].map(([id, h]) => [id, h.label]));
        const t0 = performance.now();
        await map.applyRank(res.neighborhoods, labels);
        // Medido em docs/PERFORMANCE.md: tempo para recolorir o mapa depois da resposta.
        map.raw.once('render', () => performance.measure('app:recolor', { start: t0 }));
      } else {
        await map.clearRank();
      }
    } catch (e) {
      if (e.name === 'AbortError') return;
      s.rankError = e.message; // mantém o resultado anterior na tela
    }
    setLoading(false);
    renderResults();
  }
  const scheduleRank = debounce(runRank, 250);
  const saveCriteria = debounce(() => put('/api/profile/criteria', { criteria: s.criteria }).catch(() => {}), 800);
  function criteriaChanged({ immediate = false } = {}) {
    saveCriteria();
    if (immediate) {
      scheduleRank.cancel();
      runRank();
    } else scheduleRank();
  }

  function setLoading(on) {
    s.loadingRank = on;
    $('[data-loading]').hidden = !on;
    panel.querySelector('[data-section=results]')?.classList.toggle('is-stale', on);
  }

  // ---------- Painel ----------
  function renderAll() {
    renderCrumbs();
    renderPanel();
    $('[data-legend]').hidden = s.level !== 'result';
  }

  function renderCrumbs() {
    const items = [{ label: 'Brasil', go: 'region' }];
    if (s.region) items.push({ label: s.region.name, go: 'state' });
    if (s.state) items.push({ label: s.state.name, go: 'city' });
    if (s.city) items.push({ label: s.city.name });
    mount(
      $('[data-crumbs]'),
      html`<ol>
        ${items.map((it, i) =>
          i < items.length - 1
            ? html`<li><button type="button" class="crumb" data-crumb="${it.go}">${it.label}</button>${icon('chevron', 14)}</li>`
            : html`<li><span class="crumb crumb-current" aria-current="page">${it.label}</span></li>`,
        )}
      </ol>`,
    );
  }

  const backButton = () =>
    s.level === 'region' ? '' : html`<button type="button" class="btn btn-ghost btn-sm ex-back" data-back>${icon('back', 16)} Voltar</button>`;

  function renderPanel() {
    const body = {
      region: () => html`<div class="ex-head"><h1>Escolha uma região</h1><p class="muted small">Clique no mapa ou na lista.</p></div>
        <ul class="pick-list">${regions.map((r) => html`<li><button type="button" class="pick" data-region="${r.id}"><span>${r.name}</span>${icon('chevron', 16)}</button></li>`)}</ul>`,
      state: () => html`${backButton()}<div class="ex-head"><h1>Escolha um estado</h1><p class="muted small">${s.region.name}</p></div>
        ${s.statesList
          ? html`<ul class="pick-list">${s.statesList.map((x) => html`<li><button type="button" class="pick" data-state="${x.id}"><span>${x.name}</span><span class="pick-meta">${x.uf}</span></button></li>`)}</ul>`
          : skeletonList(6)}`,
      city: () => html`${backButton()}<div class="ex-head"><h1>Escolha uma cidade</h1><p class="muted small">${s.state.name}. Só cidades com dados carregados podem ser analisadas.</p></div>
        <div class="search">${icon('search', 16)}<input class="input" type="search" placeholder="Buscar cidade" aria-label="Buscar cidade" data-city-search value="${s.cityQuery}" /></div>
        <div data-section="cities">${citiesList()}</div>`,
      result: () => html`${backButton()}<div class="ex-head"><h1>${s.city.name}</h1>
          <p class="muted small">${unit().Many} que mais combinam com os critérios que você definiu.</p></div>
        ${s.cityStatus?.division_kind === 'area' ? areaNotice() : ''}
        ${cityCoverage()}
        ${s.cityStatus?.has_data ? html`<section class="ex-section" data-section="criteria">${criteriaEditor()}</section>` : ''}
        <section class="ex-section" data-section="results">${resultsBody()}</section>`,
    }[s.level];
    mount(panel, body());
    panel.querySelector('[data-section=results]')?.classList.toggle('is-stale', s.loadingRank);
  }

  function citiesList() {
    if (!s.cities.length) return skeletonList(8);
    const q = normalize(s.cityQuery);
    const matches = s.cities.filter((c) => !q || normalize(c.name).includes(q));
    // Cidades com dados primeiro; depois as demais, esmaecidas.
    const sorted = [...matches.filter((c) => c.has_data), ...matches.filter((c) => !c.has_data)];
    if (!sorted.length) return html`<p class="empty small">Nenhuma cidade encontrada para “${s.cityQuery}”.</p>`;
    return html`<ul class="pick-list">${sorted.slice(0, MAX_CITY_ROWS).map((c) =>
        c.has_data
          ? html`<li><button type="button" class="pick" data-city="${c.id}"><span>${c.name}</span><span class="badge badge-ok">${icon('check', 12)} Dados disponíveis</span></button></li>`
          : html`<li><div class="pick pick-disabled" aria-disabled="true"><span>${c.name}</span><span class="pick-meta">Dados ainda não carregados para esta cidade</span></div></li>`,
      )}</ul>
      ${sorted.length > MAX_CITY_ROWS ? html`<p class="empty small">Mostrando ${MAX_CITY_ROWS} de ${sorted.length}. Digite para filtrar.</p>` : ''}`;
  }

  function unit() {
    return UNITS[s.cityStatus?.division_kind || 'bairro'];
  }

  function areaNotice() {
    return html`<div class="alert alert-warning area-notice">${icon('info', 16)}<span>Esta cidade não tem bairros oficiais na malha do IBGE.
      Usamos <strong>áreas formadas por setores censitários</strong>: área urbana, área rural e aglomerados (povoados, aldeias) de cada distrito.
      Como o CNPJ não traz coordenadas, muitos estabelecimentos não são localizados nessas áreas; confira a cobertura de cada uma.</span></div>`;
  }

  function cityCoverage() {
    const st = s.cityStatus;
    if (!st) return html`<div class="cov-card"><div class="skeleton" style="height:44px"></div></div>`;
    if (!st.has_data) return html`<div class="alert alert-warning">${icon('info', 16)}<span>${NO_DATA('estabelecimentos')} Os dados desta cidade ainda não foram carregados.</span></div>`;
    const c = st.coverage;
    return html`<div class="cov-card">
      <div class="cov-num tabular">${fmt.pct(c.share)}</div>
      <p class="small">dos ${fmt.int(c.total_active)} estabelecimentos ativos foram localizados em ${unit().inAny} ${st.neighborhoods} ${unit().many} pelo endereço do CNPJ.
        <span class="muted">Ref. ${st.reference_month}.</span></p>
    </div>`;
  }

  function criteriaEditor() {
    const used = new Set(s.criteria.map((c) => c.business_type_key));
    const free = types.filter((t) => !used.has(t.key));
    const count = (d) => s.criteria.filter((c) => c.direction === d).length;
    return html`<div class="section-head"><h2>Seus critérios</h2><span class="small muted">Peso de 1 a 5</span></div>
      ${s.criteria.length
        ? html`<ul class="crit-list">${s.criteria.map((c, i) => {
            const t = typeByKey[c.business_type_key];
            return html`<li class="crit">
              <div class="crit-top">
                <span class="crit-dir crit-${c.direction}" title="${c.direction === 'attract' ? 'Quero perto' : 'Não quero perto'}">${icon(c.direction, 16)}</span>
                <span class="crit-name">${t?.name || c.business_type_key}${t?.precision === 'approx' ? html` <span class="tag">aprox.</span>` : ''}</span>
                <div class="seg" role="group" aria-label="Direção">
                  <button type="button" aria-pressed="${String(c.direction === 'attract')}" data-dir="${i}" data-value="attract" ${c.direction !== 'attract' && count('attract') >= MAX_PER_DIRECTION ? 'disabled' : ''}>Perto</button>
                  <button type="button" aria-pressed="${String(c.direction === 'repel')}" data-dir="${i}" data-value="repel" ${c.direction !== 'repel' && count('repel') >= MAX_PER_DIRECTION ? 'disabled' : ''}>Longe</button>
                </div>
                <button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove="${i}" aria-label="Remover ${t?.name || ''}">${icon('close', 16)}</button>
              </div>
              <div class="crit-weight">
                <input type="range" min="1" max="5" step="1" value="${c.weight}" data-weight="${i}" aria-label="Peso de ${t?.name || ''}" />
                <output class="tabular" data-weight-out="${i}">${c.weight}</output>
              </div>
            </li>`;
          })}</ul>`
        : html`<p class="empty small">Nenhum critério ainda. Adicione abaixo o que você quer perto ou longe.</p>`}
      ${free.length && (count('attract') < MAX_PER_DIRECTION || count('repel') < MAX_PER_DIRECTION)
        ? html`<form class="crit-add" data-add>
            <select class="select" name="type" aria-label="Tipo de estabelecimento">${free.map((t) => html`<option value="${t.key}">${t.name}${t.precision === 'approx' ? ' (aprox.)' : ''}</option>`)}</select>
            <select class="select" name="direction" aria-label="Direção">
              ${count('attract') < MAX_PER_DIRECTION ? html`<option value="attract">Quero perto</option>` : ''}
              ${count('repel') < MAX_PER_DIRECTION ? html`<option value="repel">Não quero perto</option>` : ''}
            </select>
            <button class="btn btn-secondary" type="submit">${icon('plus', 16)} Adicionar</button>
          </form>`
        : ''}`;
  }

  function skeletonList(n) {
    return html`<ul class="pick-list" aria-hidden="true">${Array.from({ length: n }, () => html`<li><div class="pick"><span class="skeleton" style="height:14px;width:60%"></span></div></li>`)}</ul>`;
  }

  function resultsBody() {
    if (s.rankError)
      return html`<div class="alert alert-error">${icon('alert', 16)}<span>${s.rankError}</span></div>
        <button type="button" class="btn btn-secondary btn-sm retry" data-retry>Tentar de novo</button>${s.rank?.status === 'ok' ? rankList() : ''}`;
    if (!s.cityStatus?.has_data) return s.cityStatus ? '' : rankSkeleton();
    if (!s.rank) return rankSkeleton();
    if (s.rank.status !== 'ok') return html`<div class="alert alert-warning">${icon('info', 16)}<span>${s.rank.message}</span></div>`;
    return rankList();
  }

  function rankSkeleton() {
    return html`<div class="section-head"><h2>${unit().Many}</h2></div><ol class="rank-list" aria-hidden="true">${Array.from(
      { length: TOP },
      () => html`<li class="rank-row"><span class="skeleton" style="height:14px;width:100%"></span></li>`,
    )}</ol>`;
  }

  function rankList() {
    const r = s.rank;
    const rows = s.showAll ? r.neighborhoods : r.neighborhoods.slice(0, TOP);
    const sel = s.selectedId != null ? r.neighborhoods.find((n) => n.id === s.selectedId) : null;
    return html`${sel ? html`<div class="detail" aria-live="polite">
          <div class="detail-head"><strong>Detalhe ${unit().of}</strong>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" data-close-detail aria-label="Fechar detalhe">${icon('close', 16)}</button></div>
          ${hoodDetail(sel)}</div>`
        : ''}
      <div class="section-head"><h2>${s.showAll ? unit().all(r.count) : unit().top(Math.min(TOP, r.count))}</h2></div>
      <ol class="rank-list">${rows.map(
        (n) => html`<li><button type="button" class="rank-row ${n.id === s.selectedId ? 'is-selected' : ''}" data-hood="${n.id}">
          <span class="rank-pos tabular">${n.rank}</span>
          <span class="rank-name">${n.name}</span>
          <span class="rank-score tabular" style="--score:${n.score}">${fmt.dec(n.score)}</span>
        </button></li>`,
      )}</ol>
      ${r.count > TOP ? html`<button type="button" class="btn btn-ghost btn-sm btn-block" data-toggle-all>${s.showAll ? 'Mostrar só os 10 primeiros' : html`${icon('list', 16)} ${unit().seeAll}`}</button>` : ''}
      ${r.excluded.length ? html`<p class="small muted">Fora do ranking: ${r.excluded.map((e) => `${e.name} (${e.reason})`).join('; ')}.</p>` : ''}
      ${sourcesBlock(r)}`;
  }

  function sourcesBlock(r) {
    return html`<details class="sources small"><summary>${icon('info', 14)} Fontes e datas</summary><ul>
      ${r.sources.map((src) => html`<li><a href="${src.url}" target="_blank" rel="noopener">${src.name}</a> · ref. ${src.reference_date}</li>`)}
      <li>Mapa-base: © OpenStreetMap contributors</li>
      <li>Nota de 0 a 100: média ponderada, pelos seus pesos, da posição relativa (percentil) da densidade de cada tipo entre ${unit().among} da cidade.</li>
    </ul></details>`;
  }

  function sourcesLine(r) {
    return `Estabelecimentos: Receita Federal, CNPJ, ref. ${r.reference_dates.establishments}; ${r.division_kind === 'area' ? 'áreas: setores censitários do IBGE' : 'limites: IBGE'}, ${r.reference_dates.boundaries}`;
  }

  function hoodDetail(n) {
    const r = s.rank;
    const cov = n.coverage;
    return html`<div class="hd">
      <div class="hd-title"><strong>${n.name}</strong><span class="hd-score tabular">${fmt.dec(n.score)}<small>/100</small></span></div>
      <p class="small muted">Posição ${n.rank} de ${r.count}</p>
      <ul class="hd-crit">${n.criteria.map((c) => {
        const t = r.criteria.find((x) => x.business_type_key === c.type);
        return html`<li><span class="crit-dir crit-${c.direction}">${icon(c.direction, 14)}</span><div>
          <strong>${t.name_plural}</strong> <span class="muted">(${DIRECTION_LABEL[c.direction]}, peso ${c.weight})</span><br />
          ${establishmentsText(c.n)}, ${fmt.dec(c.density_per_km2)} por km², ${c.comparison_text}
          ${t.precision === 'approx' ? html`<br /><span class="muted">${t.note}</span>` : ''}</div></li>`;
      })}</ul>
      <p class="small hd-cov hd-cov-${cov.level}">Cobertura de dados ${unit().of}: <strong>${COVERAGE_LABEL[cov.level]}</strong>
        (${establishmentsText(cov.located_count)} localizados${cov.located_count === 0 ? '; poucos dados localizados nesta área' : ''})</p>
      <p class="hd-src">${sourcesLine(r)}</p>
    </div>`;
  }

  function renderResults() {
    const sec = panel.querySelector('[data-section=results]');
    if (!sec) return renderPanel();
    mount(sec, resultsBody());
    sec.classList.toggle('is-stale', s.loadingRank);
  }

  function renderCriteria() {
    const sec = panel.querySelector('[data-section=criteria]');
    if (sec) mount(sec, criteriaEditor());
  }

  // ---------- Tooltip (sem rede: tudo já está na memória) ----------
  function onHover(source, f, point) {
    if (!f) return hideTooltip();
    const t0 = performance.now();
    showHover(source, f, point);
    performance.measure('app:tooltip', { start: t0 }); // medido em docs/PERFORMANCE.md
  }

  function showHover(source, f, point) {
    const key = `${source}:${f.id}:${s.rank?.data_version}:${s.rankVersion}`;
    if (source === 'hoods') {
      const n = s.rank?.status === 'ok' && s.rankById.get(f.id);
      return showTooltip(() => (n ? hoodDetail(n) : html`<strong>${f.properties.name}</strong>`), point, key);
    }
    if (source === 'munis') {
      const c = s.cities.find((x) => x.id === f.id);
      prefetchCity(c);
      return showTooltip(
        () => html`<strong>${f.properties.name}</strong><br /><span class="small ${c?.has_data ? '' : 'muted'}">${c?.has_data ? 'Dados disponíveis. Clique para analisar.' : 'Dados ainda não carregados para esta cidade'}</span>`,
        point,
        key,
      );
    }
    showTooltip(() => html`<strong>${f.properties.name}</strong>`, point, key);
  }

  let tooltipKey = null;
  // key: só remonta o conteúdo quando muda de feição; no mesmo bairro, apenas reposiciona.
  function showTooltip(content, point, key = null) {
    if (key === null || key !== tooltipKey) mount(tooltip, typeof content === 'function' ? content() : content);
    tooltipKey = key;
    tooltip.hidden = false;
    const box = tooltip.parentElement.getBoundingClientRect();
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    const x = point.x + 16 + w > box.width ? point.x - w - 16 : point.x + 16;
    const y = Math.max(8, Math.min(point.y + 16, box.height - h - 8));
    tooltip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
    tooltipKey = null;
  }

  function onClick(source, f, point) {
    if (source === 'regions') return goState(regions.find((r) => r.id === f.id));
    if (source === 'states') return goCity(s.statesList.find((x) => x.id === f.id));
    if (source === 'munis') {
      const c = s.cities.find((x) => x.id === f.id);
      if (c?.has_data) return goResult(c);
      return showTooltip(html`<strong>${f.properties.name}</strong><br /><span class="small muted">Dados ainda não carregados para esta cidade</span>`, point);
    }
    if (source === 'hoods') {
      selectHood(f.id, { fly: false });
      const n = s.rank?.status === 'ok' && s.rankById.get(f.id);
      if (n && matchMedia('(hover: none)').matches) showTooltip(hoodDetail(n), point); // toque no celular
    }
  }

  function selectHood(id, { fly = true } = {}) {
    s.selectedId = id;
    map.select(id);
    if (fly && s.hoods.has(id)) map.fit(s.hoods.get(id).bounds, { maxZoom: 15 });
    renderResults();
    panel.querySelector('.detail')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const prefetched = new Set();
  function prefetchCity(c) {
    if (!c?.has_data || prefetched.has(c.id)) return;
    prefetched.add(c.id);
    loadHoods(c.id).catch(() => prefetched.delete(c.id));
  }

  // ---------- Eventos do painel (delegados) ----------
  on(root, 'click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.crumb) return { region: goRegion, state: () => goState(s.region), city: () => goCity(s.state) }[d.crumb]();
    if (d.back !== undefined) return { state: goRegion, city: () => goState(s.region), result: () => goCity(s.state) }[s.level]();
    if (d.region) return goState(regions.find((r) => r.id === Number(d.region)));
    if (d.state) return goCity(s.statesList.find((x) => x.id === Number(d.state)));
    if (d.city) return goResult(s.cities.find((c) => c.id === Number(d.city)));
    if (d.hood) return selectHood(Number(d.hood));
    if (d.closeDetail !== undefined) {
      s.selectedId = null;
      map.select(null);
      return renderResults();
    }
    if (d.toggleAll !== undefined) {
      s.showAll = !s.showAll;
      return renderResults();
    }
    if (d.retry !== undefined) return s.cityStatus ? runRank() : goResult(s.city);
    if (d.remove) {
      s.criteria.splice(Number(d.remove), 1);
      renderCriteria();
      return criteriaChanged({ immediate: true });
    }
    if (d.dir) {
      const c = s.criteria[Number(d.dir)];
      if (c.direction === d.value) return;
      c.direction = d.value;
      renderCriteria();
      return criteriaChanged({ immediate: true });
    }
  });

  on(root, 'input', (e) => {
    const t = e.target;
    if (t.dataset.weight) {
      const i = Number(t.dataset.weight);
      s.criteria[i].weight = Number(t.value);
      panel.querySelector(`[data-weight-out="${i}"]`).textContent = t.value; // atualização otimista, na hora
      criteriaChanged();
    } else if (t.dataset.citySearch !== undefined) {
      s.cityQuery = t.value;
      mount(panel.querySelector('[data-section=cities]'), citiesList());
    }
  });

  on(root, 'submit', (e) => {
    if (!e.target.matches('[data-add]')) return;
    e.preventDefault();
    const fd = new FormData(e.target);
    s.criteria.push({ business_type_key: fd.get('type'), direction: fd.get('direction'), weight: 3 });
    renderCriteria();
    criteriaChanged({ immediate: true });
  });

  on(root, 'pointerover', (e) => {
    const b = e.target.closest('[data-city]');
    if (b) prefetchCity(s.cities.find((c) => c.id === Number(b.dataset.city)));
  });
  on(root, 'focusin', (e) => {
    const b = e.target.closest('[data-city]');
    if (b) prefetchCity(s.cities.find((c) => c.id === Number(b.dataset.city)));
  });
  on(document, 'keydown', (e) => {
    if (e.key === 'Escape') hideTooltip();
  });

  // ---------- Início: pré-seleção pela sede ----------
  renderAll();
  const hq = profile.profile;
  if (hq?.has_hq && hq.hq_uf) {
    const states = await getCached('/api/geo/states');
    const st = states.find((x) => x.uf === hq.hq_uf);
    s.region = regions.find((r) => r.id === st.region_id);
    s.statesList = states.filter((x) => x.region_id === st.region_id);
    await goCity(st);
    const city = s.cities.find((c) => c.id === hq.hq_municipality_ibge);
    if (city?.has_data) await goResult(city);
  }

  return () => {
    ac.abort();
    rankCtrl?.abort();
    scheduleRank.cancel();
    map.destroy();
  };
}
