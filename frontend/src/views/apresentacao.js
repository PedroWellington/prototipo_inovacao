// Modo apresentação: o relatório em slides para mostrar a sócio, banco ou investidor. Mesmo conteúdo e mesmos avisos
// do PDF (dados de POST /report/data, sem Google). Setas, toque e tela cheia; temas claro e escuro pelos tokens.
import { get, getCached, post } from '../api.js';
import { miniMap } from '../components/miniMap.js';
import { appPage, pageHead } from '../components/page.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { brl } from '../lib.js';
import { skeleton } from '../motion.js';
import { pdfButton, pdfStatus, recalledCriteria, wirePdf } from '../report.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const entered = { done: false };
const RANK_COLOR = ['var(--score-5)', 'var(--score-4)', 'var(--score-3)', 'var(--score-2)', 'var(--score-1)'];
const DIR = { attract: 'quer perto', repel: 'quer longe' };
const COVERAGE = { high: 'alta', medium: 'média', low: 'baixa' };
const NO_DATA = (item) => `Não foi possível encontrar dados de ${item} desta área.`;

export async function render(root) {
  const ibge = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('city'));
  const user = await loadUser();
  const ac = new AbortController();
  let d, geo, criteria;
  let at = 0;

  const cleanup = appPage(root, {
    active: 'analises',
    user,
    entered,
    skeleton: () => html`${pageHead({ eyebrow: 'Modo apresentação', title: 'Carregando…' })}<section class="ov-block slides-skeleton">${skeleton('320px', '100%')}</section>`,
    load: async () => {
      if (!ibge) throw new Error('Abra uma cidade no explorador para apresentar.');
      criteria = recalledCriteria(ibge) || (await get('/api/profile')).criteria;
      const [data, status] = await Promise.all([post(`/api/cities/${ibge}/report/data`, { criteria }), get(`/api/cities/${ibge}/status`)]);
      d = data;
      geo = await getCached(`/api/cities/${ibge}/neighborhoods.geojson?v=${encodeURIComponent(status.loaded_at || '')}`).catch(() => null);
      return d;
    },
    body: () => html`${pageHead({
        eyebrow: 'Modo apresentação',
        title: `${d.city.name} – ${d.city.uf}`,
        meta: `${slides().length} slides · use as setas do teclado ou deslize no celular`,
      })}
      <section class="slides" data-slides tabindex="0" aria-roledescription="apresentação" aria-label="Slides do relatório" data-pdf-scope>
        <div class="slides-stage" data-stage>${slides()[0]}</div>
        <div class="slides-bar">
          <button type="button" class="btn btn-secondary btn-sm" data-prev aria-label="Slide anterior">${icon('back', 16)}</button>
          <span class="tabular small" data-count aria-live="polite">1 / ${slides().length}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-next aria-label="Próximo slide">${icon('chevron', 16)}</button>
          <span class="slides-gap"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-full>${icon('layers', 15)} Tela cheia</button>
          ${pdfButton('slides', 'btn-secondary btn-sm')}
        </div>
        ${pdfStatus()}
      </section>`,
  });

  const unit1 = () => (d.unit === 'bairros' ? 'bairro' : 'área');
  const map = (opts) => (geo ? miniMap(geo, opts) : html`<p class="small muted">${NO_DATA('limites')}</p>`);
  const ranks = () => new Map(d.neighborhoods.map((h) => [h.id, String(h.rank)]));
  const foot = (txt) => html`<p class="slide-foot">${txt}</p>`;

  function tile(label, value, src, missing) {
    return html`<div class="slide-tile"><span class="slide-label">${label}</span>
      ${value == null ? html`<span class="small muted">${missing}</span>` : html`<strong class="tabular">${value}</strong>`}
      <span class="slide-src">${src}</span></div>`;
  }

  function contribution(c, maxAbs) {
    const v = c.contribution;
    const w = Math.min(50, (Math.abs(v) / maxAbs) * 50);
    return html`<li class="slide-crit"><span><strong>${c.name_plural}</strong> · ${DIR[c.direction]} · peso ${c.weight}
        <small>${fmt.int(c.n)} no ${unit1()} · ${c.position}º de ${d.count} neste critério</small></span>
      <span class="slide-div" aria-hidden="true"><span class="${v >= 0 ? 'is-up' : 'is-down'}" style="${v >= 0 ? 'left:50%' : `right:50%`};width:${w.toFixed(1)}%"></span></span>
      <strong class="tabular ${v >= 0 ? 'is-up' : 'is-down'}">${v > 0 ? '+' : ''}${fmt.dec(v)}</strong></li>`;
  }

  function slides() {
    const n = d.neighborhoods.length;
    const totalW = d.criteria.reduce((a, c) => a + c.weight, 0) || 1;
    const maxAbs = (50 * Math.max(...d.criteria.map((c) => c.weight))) / totalW;
    const out = [
      html`<article class="slide slide-title"><div>
          <p class="ov-eyebrow">Apresentação</p><h2>${d.city.name} – ${d.city.uf}</h2>
          <p class="slide-lead">Os ${n} ${d.unit} que mais combinam com os critérios de ${d.company.name || 'sua empresa'}</p>
          <p class="small">${d.generated_label} · código dos parâmetros ${d.params_code}</p>
          <p class="slide-badge">${d.not_advice}</p></div>
        <div class="slide-map">${map({ fill: (id) => RANK_COLOR[(d.neighborhoods.find((h) => h.id === id)?.rank || 99) - 1] || null, labels: ranks(), label: `Mapa de ${d.city.name} com as posições` })}</div></article>`,
      html`<article class="slide"><p class="ov-eyebrow">Critérios usados</p><h2>O que a empresa pediu</h2>
        <div class="slide-cols">${['attract', 'repel'].map((dir) => html`<div><h3>${dir === 'attract' ? 'Quer perto' : 'Quer longe'}</h3><ul class="slide-list">
          ${d.criteria.filter((c) => c.direction === dir).map((c) => html`<li><span>${c.name_plural}</span><strong class="tabular">peso ${c.weight}/5</strong></li>`)}
          ${d.criteria.some((c) => c.direction === dir) ? '' : html`<li class="muted">Nenhum critério.</li>`}</ul></div>`)}</div>
        <div class="slide-tiles">
          ${tile('Ramo', d.company.segment, 'perfil da empresa', 'não informado')}
          ${tile(`${d.unit} comparados`, fmt.int(d.count), 'IBGE, malha 2022')}
          ${tile('Cadastros localizados', fmt.pct(d.city_coverage.share), `CNPJ, ref. ${d.reference_dates.establishments}`)}
        </div>
        ${foot('Faixa de faturamento e sede não entram na nota. Fontes completas no último slide.')}</article>`,
      html`<article class="slide"><p class="ov-eyebrow">Resumo</p><h2>Os ${n} ${d.unit} que mais combinam com os critérios</h2>
        <div class="slide-split"><div class="slide-map">${map({ fill: (id) => RANK_COLOR[(d.neighborhoods.find((h) => h.id === id)?.rank || 99) - 1] || null, labels: ranks(), label: 'Mapa com as posições numeradas' })}</div>
        <ol class="slide-rank">${d.neighborhoods.map((h) => html`<li><span class="slide-pos" style="--c:${RANK_COLOR[h.rank - 1]}">${h.rank}</span>
          <span><strong>${h.name}</strong><small>${h.population != null ? `${fmt.int(h.population)} habitantes (IBGE, Censo 2022)` : NO_DATA('população')}</small></span>
          <strong class="tabular slide-score">${fmt.dec(h.score)}</strong></li>`)}</ol></div>
        ${foot('Nota de 0 a 100 entre os ' + d.unit + ' da cidade, pelos critérios e pesos definidos.')}</article>`,
    ];
    for (const h of d.neighborhoods) {
      const inc = h.income;
      out.push(html`<article class="slide"><header class="slide-hood"><span class="slide-pos is-big">${h.rank}</span>
          <div><p class="ov-eyebrow">Posição ${h.rank} de ${d.count}</p><h2>${h.name}</h2></div>
          <p class="slide-big tabular">${fmt.dec(h.score)}<small>nota de 0 a 100</small></p></header>
        <div class="slide-split is-wide"><div>
          <div class="slide-tiles is-5">
            ${tile('População', h.population != null ? fmt.int(h.population) : null, 'IBGE, Censo 2022', NO_DATA('população'))}
            ${tile('hab/km²', h.pop_density != null ? fmt.int(h.pop_density) : null, 'IBGE, Censo 2022', NO_DATA('densidade demográfica'))}
            ${tile(`Renda mediana${inc.approximate ? ' (aprox.)' : ''}`, inc.available ? brl(inc.median) : null, 'IBGE, Censo 2022', NO_DATA('renda'))}
            ${tile('Concorrência', h.competition ? fmt.int(h.competition.n) : null, d.competitor ? `${d.competitor.name_plural}, ref. ${d.reference_dates.establishments}` : '', d.competition_missing)}
            ${tile('Linha reta à sede', h.straight_km != null ? `${fmt.dec(h.straight_km)} km` : null, 'nossa conta (PostGIS)', d.hq ? NO_DATA('distância') : 'Sem sede cadastrada.')}
          </div>
          <p class="ov-eyebrow slide-sub">Quanto cada critério somou ou tirou da nota (pontos, a partir de 50)</p>
          <ul class="slide-crits">${h.criteria.map((c) => contribution(c, maxAbs))}</ul></div>
          <div class="slide-map is-small">${map({ highlight: h.id, labels: new Map([[h.id, String(h.rank)]]), label: `${h.name} destacado em ${d.city.name}` })}</div></div>
        ${foot(`Cobertura dos dados neste ${unit1()}: ${COVERAGE[h.coverage.level]} (${fmt.int(h.coverage.located_count)} cadastros localizados). Contagens: Receita Federal (CNPJ) e CNES, ref. ${d.reference_dates.establishments}; localização pelo texto do bairro no cadastro.`)}</article>`);
    }
    out.push(html`<article class="slide"><p class="ov-eyebrow">Método, fontes e aviso legal</p><h2>Como ler estes números</h2>
      <div class="slide-cols"><ul class="slide-bullets">
        <li>Para cada tipo escolhido, contamos estabelecimentos por km² em cada ${unit1()}.</li>
        <li>Comparamos com os outros ${d.unit} da cidade (percentil).</li>
        <li>Perto: mais densidade combina mais. Longe: menos densidade combina mais.</li>
        <li>A nota é a média ponderada pelos pesos de 1 a 5, de 0 a 100. Empate: ordem alfabética.</li>
        <li>Mesmos critérios e mesma base = mesmo ranking (código ${d.params_code}).</li></ul>
      <ul class="slide-sources">${d.sources.filter((s) => s.key !== 'ibge_malhas').map((s) => html`<li>${s.name} (ref. ${s.reference_date})</li>`)}</ul></div>
      <div class="slide-legal"><strong>${d.legal}</strong><p>${d.legal_app}</p></div></article>`);
    return out;
  }

  function show(i) {
    const all = slides();
    at = Math.max(0, Math.min(all.length - 1, i));
    const stage = root.querySelector('[data-stage]');
    if (!stage) return;
    mount(stage, all[at]);
    stage.firstElementChild?.classList.add('is-entering');
    requestAnimationFrame(() => stage.firstElementChild?.classList.remove('is-entering'));
    root.querySelector('[data-count]').textContent = `${at + 1} / ${all.length}`;
    root.querySelector('[data-prev]').disabled = at === 0;
    root.querySelector('[data-next]').disabled = at === all.length - 1;
  }

  root.addEventListener('page:ready', () => show(0), { signal: ac.signal });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-prev]')) show(at - 1);
    else if (e.target.closest('[data-next]')) show(at + 1);
    else if (e.target.closest('[data-full]')) {
      const el = root.querySelector('[data-slides]');
      if (document.fullscreenElement) document.exitFullscreen();
      else el?.requestFullscreen?.().catch(() => {});
    }
  }, { signal: ac.signal });
  document.addEventListener('keydown', (e) => {
    if (!root.querySelector('[data-slides]') || e.target.closest('input, textarea, select')) return;
    const k = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[e.key];
    if (k) {
      e.preventDefault();
      show(at + k);
    } else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(Infinity);
  }, { signal: ac.signal });
  let x0 = null;
  root.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-stage]')) x0 = e.clientX;
  }, { signal: ac.signal });
  root.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
  }, { signal: ac.signal });
  wirePdf(root, { ibge, body: () => ({ criteria }), signal: ac.signal });

  return () => {
    ac.abort();
    cleanup();
  };
}
