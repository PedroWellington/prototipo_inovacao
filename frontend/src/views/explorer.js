import { get, getCached, post, put } from '../api.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { bbox, brl, countText, cityComparisonText, cityRankRows, COVERAGE_LABEL, debounce, DIRECTION_LABEL, establishmentsText, normalize } from '../lib.js';
import { createHologram } from '../map/hologram.js';
import { createMap } from '../map/mapView.js';
import { analysesList, companyCard, creditsCard } from '../components/account.js';
import { setActiveNav, topbar, wireTopbar } from '../components/topbar.js';
import { measure, rankListShell, updateRankList } from '../rankList.js';
import { cityActive, creditsState, ensureCity, ensureSearch, loadCredits, onCredits } from '../credits.js';
import { loadUser } from '../session.js';
import '../styles/components.css';
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
const INCOME_DIR = { attract: 'poder de compra acima da mediana', repel: 'poder de compra abaixo da mediana' };
const DEFAULT_MIN_POP = 20000;
// Holograma da unidade: ângulo de quem olha (90 = de cima). No MapLibre, pitch = 90 - ângulo.
const HOLO_VIEW_ANGLE_DEG = 50;
const HOLO_PITCH = 90 - HOLO_VIEW_ANGLE_DEG;
const HOLO_MS = 700; // inclinar e subir: a mesma animação
const HOLO_SWAP_MS = 450; // trocar de bairro já inclinado
const HOLO_MAX_ZOOM = 16; // bairros muito pequenos não vão além do nível de quarteirão
const HOLO_FRAME = 0.25; // folga de cada lado ao enquadrar o bairro: ele ocupa cerca de metade da área útil
const PANEL_KEY = 'explorer-panel'; // preferência só deste navegador (aberto/recolhido)
const METHOD_LINK = () => html`<a href="#/como-calculamos" target="_blank" rel="noopener">Como calculamos</a>`;

// Explorador em três colunas: painel esquerdo (conta, navegação e critérios), mapa no centro e painel direito
// (Ranking | Detalhes). Os painéis ficam sobre o mapa, que nunca muda de tamanho: só a câmera desconta as faixas.
export async function render(root) {
  const user = await loadUser();
  mount(
    root,
    html`<div class="explorer" data-explorer>
      ${topbar({ active: 'explorer', user })}
      <div class="ex-work">
        <section class="ex-map" aria-label="Mapa">
          <div class="map" data-map></div>
          <div class="holo-layer" data-holo></div>
          <div class="ex-loading" data-loading hidden><span></span></div>
          <div class="ex-maptop">
            <button type="button" class="ex-chip ex-chip-icon panel-toggle" data-toggle-panel aria-controls="ex-left" aria-expanded="true"
              aria-label="Recolher ou abrir o painel de navegação">${icon('panel', 18)}</button>
            <nav class="crumbs ex-chip" aria-label="Caminho geográfico" data-crumbs></nav>
            <button type="button" class="ex-chip ex-plane" data-plane hidden aria-label="Voltar ao plano: mapa visto de cima, sem o holograma">${icon('layers', 15)}<span class="sr-only-sm">Voltar ao plano</span></button>
            <a class="ex-chip ex-overview" href="#/home">${icon('back', 15)}<span class="sr-only-sm">Visão geral</span></a>
          </div>
          <div class="legend" data-legend hidden>
            <div class="legend-bar" aria-hidden="true"></div>
            <div class="legend-scale small"><span>combina menos</span><span>combina mais</span></div>
            <p class="small">Tom mais escuro = combina mais com seus critérios; mais claro = combina menos. O número em cada área é a posição.</p>
          </div>
          <div class="tooltip" data-tooltip role="tooltip" hidden></div>
        </section>
        <aside class="ex-left" id="ex-left" aria-label="Navegação territorial e critérios">
          <div class="ex-account" data-account></div>
          <div data-panel></div>
        </aside>
        <aside class="ex-right" id="ex-right" aria-label="Ranking e detalhes" data-right></aside>
        <div class="ex-scrim" data-scrim hidden></div>
      </div>
    </div>`,
  );

  const $ = (sel) => root.querySelector(sel);
  const panel = $('[data-panel]');
  const tooltip = $('[data-tooltip]');
  const ac = new AbortController();
  wireTopbar(root, { signal: ac.signal });
  const on = (el, ev, fn) => el.addEventListener(ev, fn, { signal: ac.signal });

  // ---------- Estado ----------
  const s = {
    level: 'start',
    mode: null, // 'city' = já tem cidade em mente; 'discover' = ranking de cidades
    scope: null, // { kind: 'br' | 'region' | 'uf', id, uf, label, bounds }
    cityRank: null,
    cityRankById: new Map(),
    cityRankError: null,
    norm: 'population',
    minPop: DEFAULT_MIN_POP,
    income: null, // { direction, weight } ou null
    showAllCities: false,
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
    tab: 'ranking', // painel direito: 'ranking' | 'detail'
    holo: { state: 'PLANO', id: null, slot: 0, prev: null }, // máquina de estados do holograma; prev = câmera antes do clique
    leftOpen: true,
    sheetOpen: false, // celular: gaveta do painel direito expandida
  };

  const [types, profile, regions, regionsGeo, tiles] = await Promise.all([
    getCached('/api/catalog/business-types'),
    get('/api/profile'),
    getCached('/api/geo/regions'),
    getCached('/api/geo/regions.geojson'),
    getCached('/api/geo/tiles/version'),
    loadCredits(true),
  ]);
  const typeByKey = Object.fromEntries(types.map((t) => [t.key, t]));
  s.criteria = profile.criteria.map((c) => ({ ...c }));

  const map = createMap($('[data-map]'), { onHover, onClick }, { tilesVersion: tiles.version });
  // Área livre para o holograma (sem painéis, barra de cima, gaveta, legenda e atribuição): medida só quando
  // o layout muda (syncInsets), nunca por quadro.
  let holoArea = { left: 0, right: 0, top: 0, bottom: 0 };
  const holo = createHologram($('[data-holo]'), { project: (ll) => map.project(ll), area: () => holoArea });
  map.onMove(() => holo.follow());
  // Leituras para os testes (perf/journey.mjs, perf/holo-fps.mjs): estado, pitch e onde fica cada bairro na tela.
  Object.assign($('[data-holo]'), {
    holoState: () => ({ ...s.holo, pitch: map.pitch(), top: (s.rank?.neighborhoods || []).slice(0, 5).map((n) => n.id) }),
    holoPoint: (id) => map.project(labelOf(id)),
    hoodAt: (pt) => map.hoodAt(pt),
  });

  // ---------- Painel lateral: blocos da conta + recolher (só transform: o mapa não muda de tamanho) ----------
  const accountBox = $('[data-account]');
  function renderAccount(st = creditsState()) {
    mount(accountBox, html`${companyCard(profile.profile, user, { compact: true })}${creditsCard(st, { compact: true })}${analysesList(st, { compact: true, limit: 3 })}`);
  }
  renderAccount();
  const offCredits = onCredits(renderAccount);

  // Desktop: o painel esquerdo recolhe (transform). Celular: ele vira gaveta lateral e o direito, gaveta de baixo.
  const shell = $('[data-explorer]');
  const wide = matchMedia('(min-width: 861px)');
  const left = $('.ex-left');
  const right = $('[data-right]');
  function syncInsets(animate = true) {
    const box = $('.ex-map');
    const ins = wide.matches
      ? { left: s.leftOpen ? left.offsetWidth : 0, right: right.offsetWidth, bottom: 44 }
      : { left: 0, right: 0, bottom: right.offsetHeight + 16 };
    holoArea = { left: ins.left + 8, right: box.clientWidth - ins.right - 8, top: 68, bottom: box.clientHeight - ins.bottom };
    if (wide.matches) map.setInsets({ left: s.leftOpen ? left.offsetWidth : 0, right: right.offsetWidth, bottom: 0 }, { animate });
    else if (!s.sheetOpen) {
      // Gaveta recolhida: a câmera desconta a altura dela, e a atribuição do OSM sobe para ficar à vista.
      map.setInsets({ left: 0, right: 0, bottom: right.offsetHeight + 8 }, { animate });
      shell.style.setProperty('--sheet-h', `${right.offsetHeight + 8}px`);
    }
  }
  function setPanel(open, { animate = true, remember = true } = {}) {
    s.leftOpen = open;
    shell.classList.toggle('is-collapsed', wide.matches && !open);
    shell.classList.toggle('drawer-open', !wide.matches && open);
    $('[data-scrim]').hidden = wide.matches || !(open || s.sheetOpen);
    $('[data-toggle-panel]').setAttribute('aria-expanded', String(open));
    left.inert = !open; // fora da ordem de tabulação quando recolhido
    syncInsets(animate);
    if (!remember || !wide.matches) return;
    try {
      localStorage.setItem(PANEL_KEY, open ? 'open' : 'closed');
    } catch {
      /* sem armazenamento: só não lembra a preferência */
    }
  }
  function setSheet(open) {
    s.sheetOpen = open;
    shell.classList.toggle('sheet-open', open);
    right.querySelector('[data-sheet]')?.setAttribute('aria-expanded', String(open));
    $('[data-scrim]').hidden = wide.matches || !(open || (s.leftOpen && !wide.matches));
    syncInsets(false); // a área livre do holograma muda com a gaveta
  }
  let panelPref = 'open';
  try {
    panelPref = localStorage.getItem(PANEL_KEY) || 'open';
  } catch {
    /* idem */
  }
  // Abaixo de 1100 px os dois painéis deixariam pouco mapa: o esquerdo começa recolhido (abre pelo botão).
  const initialPanel = () =>
    setPanel(wide.matches && matchMedia('(min-width: 1100px)').matches ? panelPref === 'open' : false, { animate: false, remember: false });
  wide.addEventListener('change', initialPanel, { signal: ac.signal });
  addEventListener('resize', () => syncInsets(false), { signal: ac.signal, passive: true }); // área livre do holograma
  map.setData('regions', regionsGeo);
  map.setLevel('region');

  // ---------- Navegação entre níveis (o mapa nunca é recriado: só dados, visibilidade e câmera) ----------
  async function goStart() {
    Object.assign(s, { level: 'start', mode: null, region: null, state: null, city: null });
    hideTooltip();
    await map.setLevel('region');
    map.fit(BRAZIL);
    renderAll();
  }

  // "Sim, tenho uma cidade em mente": fluxo região -> estado -> cidade; com sede cadastrada, abre direto nela.
  async function startCityMode() {
    s.mode = 'city';
    const hq = profile.profile;
    if (!(hq?.has_hq && hq.hq_uf)) return goRegion();
    const states = await getCached('/api/geo/states');
    const st = states.find((x) => x.uf === hq.hq_uf);
    s.region = regions.find((r) => r.id === st.region_id);
    s.statesList = states.filter((x) => x.region_id === st.region_id);
    await goCity(st);
    const city = s.cities.find((c) => c.id === hq.hq_municipality_ibge);
    if (city?.has_data) await goResult(city);
  }

  // "Não": escolhe o alcance e vê o ranking de cidades.
  async function goScope() {
    Object.assign(s, { level: 'scope', mode: 'discover', region: null, state: null, city: null });
    hideTooltip();
    await map.setLevel('region');
    map.fit(BRAZIL);
    renderAll();
    s.allStates = await getCached('/api/geo/states');
    if (s.level === 'scope') renderPanel();
  }

  async function scopeOf(kind, value) {
    if (kind === 'br') return { kind, label: 'Brasil', bounds: BRAZIL };
    if (kind === 'region') {
      const r = regions.find((x) => x.id === value);
      return { kind, id: r.id, label: r.name, bounds: bbox(regionsGeo.features.find((f) => f.id === r.id)) };
    }
    const [states, statesGeo] = await Promise.all([getCached('/api/geo/states'), getCached('/api/geo/states.geojson')]);
    const st = states.find((x) => x.uf === value);
    return { kind, uf: st.uf, label: st.name, bounds: bbox(statesGeo.features.find((f) => f.id === st.id)) };
  }

  async function goCities(scope) {
    if (!(await ensureSearch(scope))) return; // o servidor cobra; aqui só confirma com o usuário
    Object.assign(s, { level: 'cities', mode: 'discover', scope, city: null, showAllCities: false, cityRankError: null });
    hideTooltip();
    renderAll();
    await map.setLevel('cities');
    map.fit(scope.bounds);
    runCityRank();
  }

  // Volta do mapa de bairros para o ranking de cidades sem recalcular (cores e números continuam no mapa).
  async function backToCities() {
    Object.assign(s, { level: 'cities', city: null });
    hideTooltip();
    renderAll();
    await map.setLevel('cities');
    map.fit(s.scope.bounds);
  }

  async function goRegion() {
    Object.assign(s, { level: 'region', mode: 'city', region: null, state: null, city: null });
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
    if (!(await ensureCity(city))) return; // confirmação "Isto usa 1 crédito. Restam X." (reabrir no prazo é grátis)
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
    rankCtrl?.abort(); // troca de cidade: só a resposta mais nova importa
    rankCtrl = new AbortController();
    const city = s.city;
    setLoading(true);
    const t0 = performance.now();
    try {
      const res = await post(`/api/cities/${city.id}/rank`, { criteria: s.criteria }, { signal: rankCtrl.signal });
      performance.measure('app:rank-request', { start: t0 }); // docs/PERFORMANCE.md: pedido + resposta
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
  let cityCtrl = null;
  async function runCityRank() {
    if (s.level !== 'cities') return;
    cityCtrl?.abort();
    cityCtrl = new AbortController();
    const scope = s.scope;
    const where = scope.kind === 'uf' ? { uf: scope.uf } : scope.kind === 'region' ? { region_id: scope.id } : {};
    setLoading(true);
    try {
      const res = await post(
        '/api/cities/rank',
        { ...where, criteria: s.criteria, normalization: s.norm, min_population: s.minPop, income: s.income },
        { signal: cityCtrl.signal },
      );
      if (s.scope !== scope) return;
      if (res.status === 'ok') res.cities = cityRankRows(res);
      s.cityRank = res;
      s.cityRankById = new Map((res.cities || []).map((c) => [c.ibge, c]));
      s.rankVersion = (s.rankVersion || 0) + 1;
      s.cityRankError = null;
      const t0 = performance.now();
      if (res.status === 'ok') {
        await map.applyCityRank(res.cities);
        map.raw.once('render', () => performance.measure('app:city-recolor', { start: t0 })); // docs/PERFORMANCE.md
      } else await map.clearCityRank();
    } catch (e) {
      if (e.name === 'AbortError') return;
      s.cityRankError = e.message;
    }
    setLoading(false);
    renderResults();
  }

  // Cada função só age no seu nível: bairros (result) ou cidades (cities).
  // Mudanças de peso: agrupadas por quadro (requestAnimationFrame) e com um pedido por vez; o que mudar
  // enquanto um pedido está em andamento vai num único pedido seguinte, com o valor mais novo.
  let rankFrame = 0;
  let inFlight = false;
  let again = false;
  async function rerank() {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      await (s.level === 'cities' ? runCityRank() : runRank());
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        scheduleRank();
      }
    }
  }
  const scheduleRank = () => {
    if (!rankFrame) rankFrame = requestAnimationFrame(() => ((rankFrame = 0), rerank()));
  };
  scheduleRank.cancel = () => (cancelAnimationFrame(rankFrame), (rankFrame = 0));
  const saveCriteria = debounce(() => put('/api/profile/criteria', { criteria: s.criteria }).catch(() => {}), 800);
  function criteriaChanged() {
    saveCriteria();
    scheduleRank();
  }

  function setLoading(on) {
    s.loadingRank = on;
    $('[data-loading]').hidden = !on;
    right.querySelector('[data-right-body]')?.classList.toggle('is-stale', on);
  }

  // ---------- Painel ----------
  function renderAll() {
    setActiveNav(root, s.mode === 'discover' ? 'compare' : 'explorer'); // menu: Comparar = ranking de cidades
    renderCrumbs();
    renderPanel();
    renderRight();
    $('[data-legend]').hidden = s.level !== 'result' && s.level !== 'cities';
    // Trocou de nível ou de cidade: o mapa volta ao plano na hora, antes de qualquer enquadramento.
    const where = `${s.level}:${s.city?.id ?? ''}`;
    if (where !== lastWhere && s.holo.state !== 'PLANO') toPlane({ instant: true });
    lastWhere = where;
  }
  let lastWhere = '';

  // ---------- Holograma: máquina de estados PLANO <-> INCLINADO(bairro) ----------
  // Clique num bairro: a câmera aproxima até o bairro ocupar cerca de metade da área útil, inclina e sobe o
  // holograma, numa só animação (curva --ease); o holograma ganha um tamanho proporcional ao bairro na tela.
  // Mesmo bairro de novo, "fechar", "Voltar ao plano" ou Esc: volta à câmera de antes do clique. Outro bairro
  // já inclinado: o antigo desce, o novo sobe, a câmera desliza (a câmera guardada continua a do primeiro clique).
  // Clicar no fundo ou arrastar não muda o estado. Qualquer clique no meio reverte do ponto atual.
  const labelOf = (id) => s.hoods.get(id)?.label;
  // Faixas cobertas (painéis, gaveta) mais a reserva no alto para o corpo do holograma.
  const holoPadding = () => {
    const ins = { ...map.insets(), ...(wide.matches ? {} : { bottom: right.offsetHeight + 8 }) }; // celular: gaveta aberta
    const reserve = Math.round(Math.min(0.42 * $('.ex-map').clientHeight, wide.matches ? 280 : 200));
    return { top: reserve, right: ins.right, bottom: ins.bottom, left: ins.left };
  };
  // Câmera que enquadra o bairro em ~metade da área útil (folga HOLO_FRAME de cada lado) e o fator de escala do
  // holograma: metade do tamanho do bairro em pixels no zoom final, entre 0,8 e 2,4 do tamanho base.
  function holoCamera(bounds) {
    const box = $('.ex-map');
    const p = holoPadding();
    const w = Math.max(1, box.clientWidth - p.left - p.right), h = Math.max(1, box.clientHeight - p.top - p.bottom);
    const padding = { top: p.top + h * HOLO_FRAME, bottom: p.bottom + h * HOLO_FRAME, left: p.left + w * HOLO_FRAME, right: p.right + w * HOLO_FRAME };
    const cam = map.cameraFor(bounds, padding, HOLO_MAX_ZOOM);
    const a = map.project(bounds[0]), b = map.project(bounds[1]);
    const px = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2 ** (cam.zoom - map.zoom());
    const cap = (0.5 * Math.min(w, h)) / holo.baseWidth(); // nunca mais de metade da área útil
    return { ...cam, scale: Math.max(0.6, Math.min(2.4, cap, Math.max(0.8, (0.5 * px) / holo.baseWidth()))) };
  }
  function holoClick(id) {
    if (!labelOf(id)) return;
    if (s.holo.state === 'INCLINADO' && s.holo.id === id) return toPlane();
    toInclined(id);
  }
  function toInclined(id) {
    const ll = labelOf(id);
    const from = s.holo;
    // Mesmo slot se ele já mostra este bairro (ou está vazio); senão o outro, e o antigo desce.
    const same = holo.anchor(from.slot) === ll || holo.rise(from.slot) < 0.01;
    const slot = same ? from.slot : 1 - from.slot;
    const old = 1 - slot;
    holo.set(slot, { lngLat: ll });
    const r0 = holo.rise(slot), ro = holo.rise(old);
    const swapping = from.state === 'INCLINADO' && map.pitch() > HOLO_PITCH - 1;
    const prev = from.state === 'PLANO' ? map.camera() : from.prev; // guarda só ao sair do plano
    const cam = holoCamera(s.hoods.get(id).bounds);
    s.holo = { state: 'INCLINADO', id, slot, prev };
    holo.scale(cam.scale);
    const dur = swapping ? HOLO_SWAP_MS : Math.max(250, HOLO_MS * (1 - map.pitch() / HOLO_PITCH));
    map.tiltTo(
      { pitch: HOLO_PITCH, center: cam.center, zoom: cam.zoom, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      {
        duration: dur,
        onUpdate: (e) => {
          holo.set(slot, { rise: r0 + (1 - r0) * e });
          holo.set(old, { rise: ro * (1 - e) });
        },
      },
    );
    $('[data-plane]').hidden = false;
  }
  function toPlane({ instant = false } = {}) {
    const r = [holo.rise(0), holo.rise(1)];
    const prev = s.holo.prev;
    s.holo = { ...s.holo, state: 'PLANO', id: null, prev: null };
    const dur = instant ? 0 : Math.max(250, HOLO_MS * (map.pitch() / HOLO_PITCH));
    map.tiltTo(
      { pitch: 0, center: prev?.center, zoom: prev?.zoom, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      {
        duration: dur,
        onUpdate: (e) => {
          holo.set(0, { rise: r[0] * (1 - e) });
          holo.set(1, { rise: r[1] * (1 - e) });
        },
        onDone: () => holo.scale(1),
      },
    );
    $('[data-plane]').hidden = true;
  }

  function renderCrumbs() {
    const items = [{ label: 'Explorar', go: 'start' }];
    if (s.mode === 'discover') {
      if (s.level !== 'scope') items.push({ label: 'Alcance', go: 'scope' });
      if (s.scope && s.level !== 'scope') items.push({ label: `Cidades: ${s.scope.label}`, go: 'cities' });
    } else if (s.mode === 'city') {
      items.push({ label: 'Brasil', go: 'region' });
      if (s.region) items.push({ label: s.region.name, go: 'state' });
      if (s.state) items.push({ label: s.state.name, go: 'city' });
    }
    if (s.city) items.push({ label: s.city.name });
    if (items.length === 1) items[0] = { label: 'Explorar' };
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
    s.level === 'start' ? '' : html`<button type="button" class="btn btn-ghost btn-sm ex-back" data-back>${icon('back', 16)} Voltar</button>`;

  function renderPanel() {
    const body = {
      start: () => html`<div class="ex-head"><h1>Você já tem uma cidade em mente?</h1>
          <p class="muted small">Os dois caminhos usam os critérios e pesos do seu perfil.</p></div>
        <div class="choices">
          <button type="button" class="choice" data-start="city"><strong>Sim</strong>
            <span class="small muted">Escolho região, estado e cidade e comparo os bairros dela.</span></button>
          <button type="button" class="choice" data-start="discover"><strong>Não</strong>
            <span class="small muted">Escolho o alcance (Brasil, uma região ou um estado) e vejo as cidades que mais combinam com os meus critérios.</span></button>
        </div>`,
      scope: () => html`${backButton()}<div class="ex-head"><h1>Onde procurar?</h1>
          <p class="muted small">O ranking compara só as cidades do alcance escolhido.</p></div>
        <ul class="pick-list">
          <li><button type="button" class="pick" data-scope="br"><span>Brasil inteiro</span>${icon('chevron', 16)}</button></li>
          ${regions.map((r) => html`<li><button type="button" class="pick" data-scope-region="${r.id}"><span>${r.name}</span><span class="pick-meta">Região</span></button></li>`)}
        </ul>
        <label class="field small">Ou um estado
          <select class="select" data-scope-uf aria-label="Estado">
            <option value="">Escolha um estado</option>
            ${(s.allStates || []).map((x) => html`<option value="${x.uf}">${x.name}</option>`)}
          </select></label>`,
      cities: () => html`${backButton()}<div class="ex-head"><h1>Cidades: ${s.scope.label}</h1>
          <p class="muted small">Cidades que mais combinam com os critérios que você definiu. Ranking e detalhes ficam no painel ao lado.</p></div>
        <section class="ex-section" data-section="city-controls">${cityControls()}</section>
        <section class="ex-section" data-section="criteria">${criteriaEditor()}</section>`,
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
          <p class="muted small">${unit().Many} que mais combinam com os critérios que você definiu. Mude um peso e veja a ordem mudar no painel ao lado.</p></div>
        ${s.cityStatus && !s.cityStatus.has_data ? cityCoverage() : ''}
        ${s.cityStatus?.has_data ? html`<section class="ex-section" data-section="criteria">${criteriaEditor()}</section>` : ''}`,
    }[s.level];
    mount(panel, body());
  }

  // ---------- Painel direito: Ranking | Detalhes ----------
  const hasResults = () => s.level === 'result' || s.level === 'cities';
  function renderRight() {
    const title = s.level === 'result' ? s.city.name : s.level === 'cities' ? `Cidades: ${s.scope.label}` : 'Explore com clareza';
    mount(
      right,
      html`<div class="right-head">
          <button type="button" class="sheet-handle" data-sheet aria-expanded="${String(s.sheetOpen)}" aria-controls="ex-right"
            aria-label="Expandir ou recolher o painel de ranking"><span></span></button>
          <span class="right-icon">${icon(hasResults() ? 'list' : 'layers', 18)}</span>
          <div><span class="overline">${hasResults() ? 'Painel de leitura' : 'Como ler o mapa'}</span><h2>${title}</h2></div>
        </div>
        ${hasResults()
          ? html`<div class="tabs" role="tablist" aria-label="Painel">
              <button type="button" class="tab" role="tab" id="tab-ranking" aria-controls="right-body" aria-selected="${String(s.tab === 'ranking')}" data-tab="ranking">Ranking</button>
              <button type="button" class="tab" role="tab" id="tab-detail" aria-controls="right-body" aria-selected="${String(s.tab === 'detail')}" data-tab="detail">Detalhes</button>
            </div>`
          : ''}
        <div class="right-body" id="right-body" ${hasResults() ? html`role="tabpanel" aria-labelledby="tab-${s.tab}"` : ''} data-right-body>${rightBody()}</div>`,
    );
    right.querySelector('[data-right-body]').classList.toggle('is-stale', s.loadingRank);
    if (s.tab === 'ranking') fillRankList(new Map());
    if (!wide.matches) syncInsets(false); // a gaveta de baixo mudou de altura (abas)
  }

  function rightBody() {
    if (!hasResults()) return introBody();
    if (s.tab === 'detail') return s.level === 'cities' ? cityDetailTab() : hoodDetailTab();
    return s.level === 'cities' ? cityResults() : resultsBody();
  }

  function introBody() {
    return html`<p class="small muted">Escolha uma cidade para ver os ${UNITS.bairro.many} que mais combinam com os critérios que você definiu,
        ou peça o ranking de cidades de uma região ou estado.</p>
      <ol class="ex-steps">
        <li><span>01</span><div><strong>Escolha o território</strong><p class="small muted">Região, estado e cidade, no painel ou no mapa.</p></div></li>
        <li><span>02</span><div><strong>Ajuste os pesos</strong><p class="small muted">O que você quer perto e o que não quer perto, de 1 a 5.</p></div></li>
        <li><span>03</span><div><strong>Compare</strong><p class="small muted">Cada área mostra a posição, a nota, a cobertura, a fonte e a data.</p></div></li>
      </ol>
      <div class="source-card small">${icon('info', 16)}<span>Dados abertos da Receita Federal (CNPJ), do CNES e do IBGE, sempre com fonte e data de referência. ${METHOD_LINK()}.</span></div>`;
  }

  // Detalhes da cidade aberta: o bairro selecionado (se houver), aviso de áreas, cobertura e Censo.
  function hoodDetailTab() {
    const sel = s.rank?.status === 'ok' && s.selectedId != null ? s.rank.neighborhoods.find((n) => n.id === s.selectedId) : null;
    return html`${sel
        ? html`<div class="detail" aria-live="polite">
            <div class="detail-head"><strong>Detalhe ${unit().of}</strong>
              <button type="button" class="btn btn-ghost btn-sm btn-icon" data-close-detail aria-label="Fechar detalhe">${icon('close', 16)}</button></div>
            ${hoodDetail(sel)}</div>`
        : s.cityStatus?.has_data
          ? html`<p class="small muted ex-hint">Clique num ${unit() === UNITS.area ? 'área' : 'bairro'} do mapa ou do ranking para ver os números dele.</p>`
          : ''}
      ${s.cityStatus?.division_kind === 'area' ? areaNotice() : ''}
      ${cityCoverage()}
      ${cityCensus()}`;
  }

  function cityDetailTab() {
    const c = s.cityRank?.status === 'ok' && s.focusCity != null ? s.cityRankById.get(s.focusCity) : null;
    return html`<p class="small muted ex-hint">Passe o mouse numa cidade do mapa para ver os números dela aqui; clique para abrir os bairros.</p>
      ${c ? html`<div class="detail">${cityDetail(c)}</div>` : ''}
      ${s.cityRank?.status === 'ok' ? html`<p class="small">${s.cityRank.income.note}</p>` : ''}`;
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
    return html`<div class="alert alert-warning area-notice">${icon('info', 16)}<span>Esta cidade não tem bairros na malha do IBGE.
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
      <p class="small">dos ${fmt.int(c.total_active)} cadastros ativos de CNPJ com atividade principal de algum tipo do catálogo foram localizados em ${unit().inAny} ${st.neighborhoods} ${unit().many} pelo texto do endereço do CNPJ.
        ${METHOD_LINK()}.
        <span class="muted">Ref. ${st.reference_month}.</span></p>
    </div>`;
  }

  function cityCensus() {
    const st = s.cityStatus;
    if (!st) return '';
    const pop = st.population != null ? `${fmt.int(st.population)} habitantes` : NO_DATA('população');
    return html`<div class="cov-card cov-census small">
      <p><strong>${pop}</strong>${st.area_km2 ? html` · ${fmt.dec(st.area_km2)} km²` : ''} <span class="muted">(IBGE, Censo 2022)</span></p>
      ${incomeBlock(st.income, 'as cidades do estado')}
    </div>`;
  }

  // Renda: valor, quartil, frase padrão, fonte, data e a nota fixa. Sem dado: a mensagem padrão (nunca estimativa).
  function incomeBlock(inc, among) {
    if (!inc) return '';
    if (!inc.available) return html`<p class="inc small"><strong>Renda:</strong> ${inc.message} <span class="muted">${inc.note}</span></p>`;
    return html`<div class="inc small"><strong>Renda (Censo 2022):</strong> mediana do rendimento mensal do responsável pelo domicílio
      <span class="tabular">${brl(inc.median)}</span>${inc.approximate ? html` <span class="tag">aproximado</span>` : ''};
      ${inc.quartile}º quartil (de 4) entre ${among}.<br />${inc.text}<br />
      <span class="muted">${inc.note} Fonte: ${inc.source?.name || 'IBGE, Censo 2022'}, ref. ${inc.source?.reference_date || '2022'}.</span></div>`;
  }

  function cityControls() {
    return html`<div class="section-head"><h2>Como comparar</h2></div>
      <div class="ctl">
        <span class="small">Contar estabelecimentos</span>
        <div class="seg" role="group" aria-label="Normalização">
          <button type="button" aria-pressed="${String(s.norm === 'population')}" data-norm="population">Por 10 mil habitantes</button>
          <button type="button" aria-pressed="${String(s.norm === 'area')}" data-norm="area">Por km²</button>
        </div>
      </div>
      <p class="small muted">${s.norm === 'population'
        ? 'Padrão. Por km², municípios grandes com muita área rural parecem “vazios” mesmo atendendo a população.'
        : 'Atenção: por km², municípios grandes com muita área rural tendem a ficar no fim da lista.'}</p>
      <label class="ctl small">População mínima (Censo 2022)
        <input class="input input-sm tabular" type="number" min="0" step="5000" inputmode="numeric" value="${s.minPop}" data-min-pop /></label>
      <label class="ctl small">Renda (opcional)
        <select class="select" data-income aria-label="Renda como critério">
          <option value="" ${s.income ? '' : 'selected'}>Não usar</option>
          <option value="attract" ${s.income?.direction === 'attract' ? 'selected' : ''}>Poder de compra acima da mediana</option>
          <option value="repel" ${s.income?.direction === 'repel' ? 'selected' : ''}>Poder de compra abaixo da mediana</option>
        </select></label>
      ${s.income
        ? html`<div class="crit-weight"><input type="range" min="1" max="5" step="1" value="${s.income.weight}" data-income-weight aria-label="Peso da renda" />
            <output class="tabular" data-income-weight-out>${s.income.weight}</output></div>
            <p class="small muted">Renda é um indicador e não determina preferências. Cidades sem dado de renda ficam fora quando ela é critério.</p>`
        : ''}`;
  }

  function cityResults() {
    const r = s.cityRank;
    if (s.cityRankError)
      return html`<div class="alert alert-error">${icon('alert', 16)}<span>${s.cityRankError}</span></div>
        <button type="button" class="btn btn-secondary btn-sm retry" data-retry>Tentar de novo</button>`;
    if (!r) return rankSkeleton('Cidades');
    if (r.status !== 'ok') return html`<div class="alert alert-warning">${icon('info', 16)}<span>${r.message}</span></div>`;
    const k = r.counts;
    const rows = s.showAllCities ? r.cities : r.cities.slice(0, TOP);
    const out = [
      k.in_scope - k.with_data ? `${fmt.int(k.in_scope - k.with_data)} sem dados carregados` : '',
      k.below_min_population ? `${fmt.int(k.below_min_population)} abaixo da população mínima` : '',
      k.without_income ? `${fmt.int(k.without_income)} sem dado de renda` : '',
    ].filter(Boolean);
    return html`<p class="small analyzed"><strong>Cidades analisadas: ${fmt.int(k.analyzed)} de ${fmt.int(k.in_scope)}</strong> no alcance escolhido${out.length ? ` (${out.join('; ')})` : ''}.</p>
      ${k.analyzed
        ? html`<div class="section-head"><h2>${s.showAllCities ? `Todas as ${fmt.int(k.analyzed)} cidades` : `As ${Math.min(TOP, k.analyzed)} que mais combinam`}</h2></div>
          ${rankListShell(`Cidades em ordem de posição (${rows.length})`)}
          ${k.analyzed > TOP ? html`<button type="button" class="btn btn-ghost btn-sm btn-block" data-toggle-all-cities>${s.showAllCities ? 'Mostrar só as 10 primeiras' : html`${icon('list', 16)} Ver todas as cidades`}</button>` : ''}
          <p class="small muted">Clique numa cidade para ver o mapa dos bairros dela.</p>`
        : html`<p class="empty small">Nenhuma cidade atende aos filtros. Diminua a população mínima ou amplie o alcance.</p>`}
      <details class="sources small"><summary>${icon('info', 14)} Fontes e datas</summary><ul>
        ${r.sources.map((src) => html`<li><a href="${src.url}" target="_blank" rel="noopener">${src.name}</a> · ref. ${src.reference_date}</li>`)}
        <li>Mapa-base: © OpenStreetMap contributors</li>
        <li>Nota de 0 a 100: média ponderada, pelos seus pesos, da posição relativa (percentil) de cada critério entre as cidades analisadas, ${s.norm === 'area' ? 'por km²' : 'por 10 mil habitantes'}. ${METHOD_LINK()}.</li>
        <li>${r.income.note}</li>
      </ul></details>`;
  }

  function cityDetail(c) {
    const r = s.cityRank;
    const ref = r.sources.find((x) => x.key === 'rfb_cnpj')?.reference_date;
    return html`<div class="hd">
      <div class="hd-title"><strong>${c.name} <span class="muted">${c.uf}</span></strong><span class="hd-score tabular">${fmt.dec(c.score)}<small>/100</small></span></div>
      <p class="small muted">Posição ${c.rank} de ${fmt.int(r.counts.analyzed)} · ${fmt.int(c.population)} hab. · ${fmt.dec(c.area_km2)} km²</p>
      <ul class="hd-crit">${c.criteria.map((k) => {
        if (k.type === 'renda')
          return html`<li><span class="crit-dir crit-${k.direction}">${icon(k.direction, 14)}</span><div>
            <strong>Renda</strong> <span class="muted">(${INCOME_DIR[k.direction]}, peso ${k.weight})</span><br />${cityComparisonText(k.direction, k.lower, k.higher, 'renda mediana')}</div></li>`;
        const t = r.criteria.find((x) => x.business_type_key === k.type);
        return html`<li><span class="crit-dir crit-${k.direction}">${icon(k.direction, 14)}</span><div>
          <strong>${t.name_plural}</strong> <span class="muted">(${DIRECTION_LABEL[k.direction]}, peso ${k.weight})</span><br />
          ${countText(k.n, k.n_cnpj, t)}; ${fmt.dec(k.per_10k, 2)} por 10 mil hab.; ${fmt.dec(k.per_km2, 3)} por km²;
          ${cityComparisonText(k.direction, k.lower, k.higher, r.normalization === 'area' ? 'estabelecimentos por km²' : 'estabelecimentos por 10 mil habitantes')}</div></li>`;
      })}</ul>
      ${incomeBlock(c.income, 'as cidades analisadas')}
      <p class="small">Cobertura da localização por bairro: ${fmt.pct(c.coverage.share)} de ${fmt.int(c.coverage.total_active)} cadastros de CNPJ.</p>
      <p class="hd-src">Estabelecimentos: Receita Federal, CNPJ, ref. ${ref}${r.criteria.some((x) => x.source === 'cnes') ? `; unidades de saúde: CNES, ${r.sources.find((x) => x.key === 'ms_cnes')?.reference_date || ''}` : ''}; população, área e renda: IBGE, Censo 2022</p>
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
    if (s.level === 'cities') return cityResults();
    if (!s.cityStatus?.has_data) return s.cityStatus ? html`<p class="small muted">${NO_DATA('estabelecimentos')}</p>` : rankSkeleton();
    if (s.rankError)
      return html`<div class="alert alert-error">${icon('alert', 16)}<span>${s.rankError}</span></div>
        <button type="button" class="btn btn-secondary btn-sm retry" data-retry>Tentar de novo</button>${s.rank?.status === 'ok' ? rankList() : ''}`;
    if (!s.rank) return rankSkeleton();
    if (s.rank.status !== 'ok') return html`<div class="alert alert-warning">${icon('info', 16)}<span>${s.rank.message}</span></div>`;
    return rankList();
  }

  function rankSkeleton(title = unit().Many) {
    return html`<div class="section-head"><h2>${title}</h2></div><ol class="rank-list" aria-hidden="true">${Array.from(
      { length: TOP },
      () => html`<li class="rank-row"><span class="skeleton" style="height:14px;width:100%"></span></li>`,
    )}</ol>`;
  }

  function rankList() {
    const r = s.rank;
    const shown = s.showAll ? r.count : Math.min(TOP, r.count);
    return html`${coverageLine()}
      <div class="section-head"><h2>${s.showAll ? unit().all(r.count) : unit().top(shown)}</h2></div>
      ${rankListShell(`${unit().Many} em ordem de posição (${shown})`)}
      ${r.count > TOP ? html`<button type="button" class="btn btn-ghost btn-sm btn-block" data-toggle-all>${s.showAll ? 'Mostrar só os 10 primeiros' : html`${icon('list', 16)} ${unit().seeAll}`}</button>` : ''}
      ${r.excluded.length ? html`<p class="small muted">Fora do ranking: ${r.excluded.map((e) => `${e.name} (${e.reason})`).join('; ')}.</p>` : ''}
      ${sourcesBlock(r)}`;
  }

  // Cobertura sempre à vista no ranking (o cartão completo fica em Detalhes).
  function coverageLine() {
    const st = s.cityStatus;
    if (!st?.has_data) return '';
    return html`<button type="button" class="cov-line small" data-tab="detail">${icon('info', 14)}
      <span>Cobertura: <strong class="tabular">${fmt.pct(st.coverage.share)}</strong> dos cadastros localizados em ${unit().many} · ref. ${st.reference_month}</span></button>`;
  }

  // Linhas do ranking na ordem atual (bairros ou cidades); null quando não há lista a mostrar.
  function rankRows() {
    if (s.level === 'cities') {
      const r = s.cityRank;
      if (!r || r.status !== 'ok' || !r.counts.analyzed) return null;
      return (s.showAllCities ? r.cities : r.cities.slice(0, TOP)).map((c) => ({ ...c, key: c.ibge }));
    }
    const r = s.rank;
    if (r?.status !== 'ok') return null;
    return (s.showAll ? r.neighborhoods : r.neighborhoods.slice(0, TOP)).map((n) => ({ ...n, key: n.id }));
  }
  const bar = (score) => html`<span class="rank-bar" aria-hidden="true"><span style="transform:scaleX(${(score / 100).toFixed(3)})"></span></span>`;
  function rankRow(x) {
    if (s.level === 'cities')
      return html`<button type="button" class="rank-row" data-city-rank="${x.ibge}" title="Ver os bairros de ${x.name}">
        <span class="rank-pos tabular">${x.rank}</span>
        <span class="rank-name" title="${x.name} – ${x.uf}">${x.name} <span class="muted small">${x.uf}</span>${bar(x.score)}</span>
        <span class="rank-score tabular">${fmt.dec(x.score)}</span></button>`;
    return html`<button type="button" class="rank-row ${x.id === s.selectedId ? 'is-selected' : ''}" data-hood="${x.id}" ${x.id === s.selectedId ? 'aria-current="true"' : ''}>
      <span class="rank-pos tabular">${x.rank}</span>
      <span class="rank-name" title="${x.name}">${x.name}${bar(x.score)}</span>
      <span class="rank-score tabular">${fmt.dec(x.score)}</span></button>`;
  }
  function fillRankList(before) {
    const ol = right.querySelector('[data-rank-list]');
    const rows = ol && rankRows();
    if (rows) updateRankList(ol, rows, rankRow, before);
  }

  function sourcesBlock(r) {
    return html`<details class="sources small"><summary>${icon('info', 14)} Fontes e datas</summary><ul>
      ${r.sources.map((src) => html`<li><a href="${src.url}" target="_blank" rel="noopener">${src.name}</a> · ref. ${src.reference_date}</li>`)}
      <li>Mapa-base: © OpenStreetMap contributors</li>
      <li>Nota de 0 a 100: média ponderada, pelos seus pesos, da posição relativa (percentil) da densidade de cada tipo entre ${unit().among} da cidade. ${METHOD_LINK()}.</li>
    </ul></details>`;
  }

  function sourcesLine(r) {
    const cnes = r.criteria.some((c) => c.source === 'cnes') ? `; unidades de saúde: CNES, ${r.sources.find((x) => x.key === 'ms_cnes')?.reference_date || ''}` : '';
    return `Estabelecimentos: Receita Federal, CNPJ, ref. ${r.reference_dates.establishments}${cnes}; ${r.division_kind === 'area' ? 'áreas: setores censitários do IBGE' : 'limites: IBGE'}, ${r.reference_dates.boundaries}`;
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
          ${countText(c.n, c.n_cnpj, t)}, ${fmt.dec(c.density_per_km2)} por km², ${c.comparison_text}
          ${t.precision === 'approx' ? html`<br /><span class="muted">${t.note}</span>` : ''}</div></li>`;
      })}</ul>
      <p class="small hd-cov hd-cov-${cov.level}">Cobertura de dados ${unit().of}: <strong>${COVERAGE_LABEL[cov.level]}</strong>
        (${establishmentsText(cov.located_count)} localizados${cov.located_count === 0 ? '; poucos dados localizados nesta área' : ''})</p>
      ${incomeBlock(n.income, `${unit().among} da cidade`)}
      <p class="hd-src">${sourcesLine(r)}</p>
    </div>`;
  }

  // Atualiza o painel direito sem reconstruir a lista: o <ol> antigo volta para o lugar e as linhas deslizam.
  function renderResults() {
    const body = right.querySelector('[data-right-body]');
    if (!body || !hasResults()) return renderRight();
    const old = body.querySelector('[data-rank-list]');
    const before = measure(old);
    mount(body, rightBody());
    const slot = body.querySelector('[data-rank-list]');
    if (slot && old) {
      old.setAttribute('aria-label', slot.getAttribute('aria-label'));
      slot.replaceWith(old);
    }
    if (s.tab === 'ranking') fillRankList(before);
    body.classList.toggle('is-stale', s.loadingRank);
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
    // Tooltip compacto: nome, nota e posição (no máximo 2 linhas). Os detalhes ficam na aba Detalhes.
    if (source === 'hoods') {
      const n = s.rank?.status === 'ok' && s.rankById.get(f.id);
      return showTooltip(() => (n ? compact(n.name, n.score, n.rank, s.rank.count) : html`<strong>${f.properties.name}</strong>`), point, key);
    }
    if (source === 'cities') {
      const c = s.cityRank?.status === 'ok' && s.cityRankById.get(f.id);
      if (c && s.focusCity !== c.ibge) {
        s.focusCity = c.ibge; // a aba Detalhes mostra a última cidade apontada (com os critérios dela)
        if (s.tab === 'detail') renderResults();
      }
      const pop = f.properties.population;
      const why = pop != null && pop < s.minPop ? 'abaixo da população mínima' : 'fora do alcance ou sem dados';
      return showTooltip(
        () => (c ? compact(`${c.name} – ${c.uf}`, c.score, c.rank, s.cityRank.counts.analyzed) : html`<strong>${f.properties.name}</strong> <span class="muted">${f.properties.uf}</span><br /><span class="small muted">Fora do ranking (${why})</span>`),
        point,
        key,
      );
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

  const compact = (name, score, rank, of) =>
    html`<strong>${name}</strong><br /><span class="small tabular">${fmt.dec(score)}/100 · ${rank} de ${fmt.int(of)}</span>`;
  let tooltipKey = null;
  // key: só remonta o conteúdo quando muda de feição; no mesmo bairro, apenas reposiciona.
  function showTooltip(content, point, key = null) {
    if (key === null || key !== tooltipKey) mount(tooltip, typeof content === 'function' ? content() : content);
    tooltipKey = key;
    tooltip.hidden = false;
    // Dentro da área livre do mapa (entre os painéis), nunca por cima deles nem do holograma.
    const a = holoArea;
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    const hits = (x, y) => holo.bounds().some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
    let x = point.x + 14 + w > a.right ? point.x - w - 14 : point.x + 14;
    let y = Math.max(a.top, Math.min(point.y + 14, a.bottom - h));
    if (hits(x, y)) x = x > point.x ? point.x - w - 14 : point.x + 14; // troca de lado
    if (hits(x, y)) y = Math.min(a.bottom - h, point.y + 28); // ou desce
    // Pixels inteiros: a posição do mouse no mapa é fracionária e deixava o texto do tooltip borrado.
    tooltip.style.translate = `${Math.round(Math.max(a.left, Math.min(x, a.right - w)))}px ${Math.round(y)}px`;
    tooltip.classList.add('is-on');
  }

  function hideTooltip() {
    tooltip.classList.remove('is-on');
    tooltip.hidden = true;
    tooltipKey = null;
  }

  function onClick(source, f, point) {
    if (source === 'regions' && s.level === 'scope') return scopeOf('region', f.id).then(goCities);
    if (source === 'regions') return goState(regions.find((r) => r.id === f.id));
    if (source === 'cities') {
      if (s.cityRankById.has(f.id)) return openRankedCity(f.id);
      return showTooltip(html`<strong>${f.properties.name}</strong><br /><span class="small muted">Fora do ranking com os filtros atuais.</span>`, point);
    }
    if (source === 'states') return goCity(s.statesList.find((x) => x.id === f.id));
    if (source === 'munis') {
      const c = s.cities.find((x) => x.id === f.id);
      if (c?.has_data) return goResult(c);
      return showTooltip(html`<strong>${f.properties.name}</strong><br /><span class="small muted">Dados ainda não carregados para esta cidade</span>`, point);
    }
    if (source === 'hoods') {
      // Os números do bairro vão para a aba Detalhes; o tooltip sai para não cobrir o holograma.
      // Celular (sem hover): o toque seleciona e abre a gaveta de detalhes.
      hideTooltip();
      selectHood(f.id);
      if (!wide.matches) setSheet(true);
      holoClick(f.id);
    }
  }

  // Selecionar um bairro (no mapa ou no ranking) abre a aba Detalhes; o ranking guarda o destaque.
  // A câmera de quem seleciona é a do holograma (holoClick): aqui só seleção e painel.
  function selectHood(id) {
    s.selectedId = id;
    s.tab = 'detail';
    map.select(id);
    renderRight();
  }

  // Do ranking de cidades para o mapa de bairros da cidade.
  function openRankedCity(ibge) {
    const c = s.cityRankById.get(ibge);
    return goResult({ id: c.ibge, name: c.name, has_data: true });
  }

  // "Minhas análises" e links da tela inicial: abre a cidade com o contexto (região/estado) para o "Voltar".
  async function openCityDirect(ibge) {
    const c = creditsState()?.cities.find((x) => x.ibge === ibge);
    const status = c ? null : await get(`/api/cities/${ibge}/status`);
    const uf = c?.uf || status.uf;
    const states = await getCached('/api/geo/states');
    const st = states.find((x) => x.uf === uf);
    Object.assign(s, { mode: 'city', region: regions.find((r) => r.id === st.region_id), state: st });
    return goResult({ id: ibge, name: c?.name || status.name, has_data: true });
  }

  function openSearchDirect(key) {
    const scope = key === 'BR' ? scopeOf('br') : /^R\d$/.test(key) ? scopeOf('region', Number(key.slice(1))) : scopeOf('uf', key);
    return scope.then(goCities);
  }

  const prefetched = new Set();
  function prefetchCity(c) {
    // Só pré-carrega cidades já liberadas: a geometria das demais o servidor só entrega depois do crédito.
    if (!c?.has_data || prefetched.has(c.id) || !cityActive(c.id)) return;
    prefetched.add(c.id);
    loadHoods(c.id).catch(() => prefetched.delete(c.id));
  }

  // ---------- Eventos do painel (delegados) ----------
  on(root, 'click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.togglePanel !== undefined) return setPanel(b.getAttribute('aria-expanded') !== 'true');
    if (d.tab) {
      if (s.tab === d.tab) return;
      s.tab = d.tab;
      return renderRight();
    }
    if (d.sheet !== undefined) return setSheet(!s.sheetOpen);
    if (d.openCity) return openCityDirect(Number(d.openCity));
    if (d.openSearch) return openSearchDirect(d.openSearch);
    if (d.crumb)
      return { start: goStart, scope: goScope, cities: backToCities, region: goRegion, state: () => goState(s.region), city: () => goCity(s.state) }[d.crumb]();
    if (d.back !== undefined)
      return {
        scope: goStart,
        cities: goScope,
        region: goStart,
        state: goRegion,
        city: () => goState(s.region),
        result: () => (s.mode === 'discover' ? backToCities() : goCity(s.state)),
      }[s.level]();
    if (d.start) return d.start === 'city' ? startCityMode() : goScope();
    if (d.scope) return scopeOf('br').then(goCities);
    if (d.scopeRegion) return scopeOf('region', Number(d.scopeRegion)).then(goCities);
    if (d.cityRank) return openRankedCity(Number(d.cityRank));
    if (d.norm) {
      if (s.norm === d.norm) return;
      s.norm = d.norm;
      mount(panel.querySelector('[data-section=city-controls]'), cityControls());
      return runCityRank();
    }
    if (d.toggleAllCities !== undefined) {
      s.showAllCities = !s.showAllCities;
      return renderResults();
    }
    if (d.region) return goState(regions.find((r) => r.id === Number(d.region)));
    if (d.state) return goCity(s.statesList.find((x) => x.id === Number(d.state)));
    if (d.city) return goResult(s.cities.find((c) => c.id === Number(d.city)));
    if (d.hood) {
      selectHood(Number(d.hood));
      return holoClick(Number(d.hood));
    }
    if (d.plane !== undefined) return toPlane();
    if (d.closeDetail !== undefined) {
      s.selectedId = null;
      map.select(null);
      if (s.holo.state === 'INCLINADO') toPlane(); // fechar o detalhe = desclicar o bairro
      return renderResults();
    }
    if (d.toggleAll !== undefined) {
      s.showAll = !s.showAll;
      return renderResults();
    }
    if (d.retry !== undefined) return s.level === 'cities' ? runCityRank() : s.cityStatus ? runRank() : goResult(s.city);
    if (d.remove) {
      s.criteria.splice(Number(d.remove), 1);
      renderCriteria();
      return criteriaChanged();
    }
    if (d.dir) {
      const c = s.criteria[Number(d.dir)];
      if (c.direction === d.value) return;
      c.direction = d.value;
      renderCriteria();
      return criteriaChanged();
    }
  });

  on(root, 'input', (e) => {
    const t = e.target;
    if (t.dataset.weight) {
      const i = Number(t.dataset.weight);
      s.criteria[i].weight = Number(t.value);
      panel.querySelector(`[data-weight-out="${i}"]`).textContent = t.value; // atualização otimista, na hora
      criteriaChanged();
    } else if (t.dataset.minPop !== undefined) {
      s.minPop = Math.max(0, Math.floor(Number(t.value) || 0));
      scheduleRank();
    } else if (t.dataset.incomeWeight !== undefined && s.income) {
      s.income.weight = Number(t.value);
      panel.querySelector('[data-income-weight-out]').textContent = t.value;
      scheduleRank();
    } else if (t.dataset.citySearch !== undefined) {
      s.cityQuery = t.value;
      mount(panel.querySelector('[data-section=cities]'), citiesList());
    }
  });

  on(root, 'change', (e) => {
    const t = e.target;
    if (t.dataset.scopeUf !== undefined && t.value) return scopeOf('uf', t.value).then(goCities);
    if (t.dataset.income !== undefined) {
      s.income = t.value ? { direction: t.value, weight: s.income?.weight || 3 } : null;
      mount(panel.querySelector('[data-section=city-controls]'), cityControls());
      runCityRank();
    }
  });

  on(root, 'submit', (e) => {
    if (!e.target.matches('[data-add]')) return;
    e.preventDefault();
    const fd = new FormData(e.target);
    s.criteria.push({ business_type_key: fd.get('type'), direction: fd.get('direction'), weight: 3 });
    renderCriteria();
    criteriaChanged();
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
    if (e.key !== 'Escape') return;
    hideTooltip();
    if (s.holo.state === 'INCLINADO') return toPlane();
    if (!wide.matches && (s.leftOpen || s.sheetOpen)) {
      setSheet(false);
      setPanel(false);
    }
  });

  // ---------- Início: "Você já tem uma cidade em mente?" (a sede pré-seleciona a cidade no "Sim") ----------
  renderAll();
  initialPanel();
  // Quadros do holograma: só depois que o explorador abriu, no ocioso (nunca na landing nem no dashboard).
  (window.requestIdleCallback || ((f) => setTimeout(f, 800)))(() => holo.load(), { timeout: 3000 });
  on($('[data-scrim]'), 'click', () => {
    if (s.sheetOpen) setSheet(false);
    if (s.leftOpen && !wide.matches) setPanel(false);
  });
  // Vindo da tela inicial ou do menu: #/explorer?city=<ibge>, ?search=<alcance> ou ?compare=1 (ranking de cidades)
  function openFromQuery() {
    const query = new URLSearchParams(location.hash.split('?')[1] || '');
    history.replaceState(null, '', '#/explorer'); // recarregar a página não repete a abertura
    if (query.get('city')) {
      const id = Number(query.get('city'));
      if (s.level === 'result' && s.city?.id === id) return; // já está aberta: nada a refazer
      openCityDirect(id);
    } else if (query.get('search')) openSearchDirect(query.get('search'));
    else if (query.get('compare') && s.mode !== 'discover') goScope();
    else if (query.get('compare')) setActiveNav(root, 'compare');
  }
  openFromQuery();

  const cleanup = () => {
    ac.abort();
    rankCtrl?.abort();
    cityCtrl?.abort();
    offCredits();
    scheduleRank.cancel();
    holo.destroy();
    map.destroy();
  };
  // O roteador mantém o explorador vivo ao ir para a visão geral ou a conta (router.js): ao voltar, mapa,
  // cidade, critérios e aba estão como ficaram; só o saldo é relido e um ?city= novo é aberto.
  cleanup.resume = () => {
    loadCredits(true).catch(() => {});
    map.resize();
    openFromQuery();
  };
  return cleanup;
}
