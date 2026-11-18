// Modo apresentação: uma narrativa curta para mostrar a sócio, banco ou investidor (não é o relatório fatiado).
// (a) capa, (b) o que buscamos, (c) visão geral, (d) um slide por bairro com a nota como número herói, (e) os 5 lado a
// lado, (f) como lemos os dados, (g) próximos passos (Roteiro de visita), (h) fontes, datas, cobertura e aviso legal.
// Dados de POST /report/data (sem Google); textos da narrativa vêm prontos do servidor (os mesmos do PDF).
// Movimento só com o que já existe: cascade (entrada), countNumber/countUp (números) e growBar (barras).
import { get, getCached, post } from '../api.js';
import { miniMap } from '../components/miniMap.js';
import { appPage, pageHead } from '../components/page.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { brl } from '../lib.js';
import { animateOnView, cascade, countNumber, growBar, skeleton } from '../motion.js';
import { pdfButton, pdfStatus, recalledCriteria, rememberCriteria, wirePdf } from '../report.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const entered = { done: false };
const RANK_COLOR = ['var(--score-5)', 'var(--score-4)', 'var(--score-3)', 'var(--score-2)', 'var(--score-1)'];
const COVERAGE = { high: 'alta', medium: 'média', low: 'baixa' };
const NO_DATA = (item) => `Não foi possível encontrar dados de ${item} desta área.`;

export async function render(root) {
  const ibge = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('city'));
  const user = await loadUser();
  const ac = new AbortController();
  let d, geo, criteria, all;
  let at = 0;
  let offView = () => {};

  const cleanup = appPage(root, {
    active: 'analises',
    user,
    entered,
    skeleton: () => html`${pageHead({ eyebrow: 'Modo apresentação', title: 'Carregando…' })}<section class="ov-block">${skeleton('320px', '100%')}</section>`,
    load: async () => {
      if (!ibge) throw new Error('Abra uma cidade no explorador para apresentar.');
      criteria = recalledCriteria(ibge) || (await get('/api/profile')).criteria;
      const [data, status] = await Promise.all([post(`/api/cities/${ibge}/report/data`, { criteria }), get(`/api/cities/${ibge}/status`)]);
      d = data;
      geo = await getCached(`/api/cities/${ibge}/neighborhoods.geojson?v=${encodeURIComponent(status.loaded_at || '')}`).catch(() => null);
      all = slides();
      return d;
    },
    body: () => html`${pageHead({
        eyebrow: 'Modo apresentação',
        title: `${d.city.name} – ${d.city.uf}`,
        meta: `${all.length} telas · setas do teclado, deslize no celular ou tela cheia`,
      })}
      <section class="slides" data-slides aria-roledescription="apresentação" aria-label="Apresentação: ${d.city.name}" data-pdf-scope>
        <div class="slides-stage" data-stage aria-live="polite">${all[0]}</div>
        <div class="slides-bar">
          <button type="button" class="btn btn-secondary btn-sm" data-prev aria-label="Tela anterior">${icon('back', 16)}</button>
          <span class="tabular small" data-count>1 / ${all.length}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-next aria-label="Próxima tela">${icon('chevron', 16)}</button>
          <span class="slides-gap"></span>
          <button type="button" class="btn btn-ghost btn-sm" data-full>${icon('layers', 15)} Tela cheia</button>
          ${pdfButton('slides', 'btn-secondary btn-sm')}
        </div>
        ${pdfStatus()}
      </section>`,
  });

  const unit1 = () => (d.unit === 'bairros' ? 'bairro' : 'área');
  const ref = () => d.reference_dates.establishments;
  const rankFill = (id) => RANK_COLOR[(d.neighborhoods.find((h) => h.id === id)?.rank || 99) - 1] || null;
  const ranks = () => new Map(d.neighborhoods.map((h) => [h.id, String(h.rank)]));
  const map = (opts) => (geo ? miniMap(geo, opts) : html`<p class="small muted">${NO_DATA('limites')}</p>`);
  const foot = (txt) => html`<p class="slide-foot" data-cx>${txt}</p>`;
  const kicker = (k, t) => html`<p class="ov-eyebrow" data-cx>${k}</p><h2 data-cx>${t}</h2>`;

  function stat(label, value, src, missing) {
    return html`<div class="slide-tile" data-cx><span class="slide-label">${label}</span>
      ${value == null ? html`<span class="small muted">${missing}</span>` : html`<strong>${value}</strong>`}
      <span class="slide-src">${src}</span></div>`;
  }

  function hoodSlide(h) {
    const comp = h.competition;
    const third = d.hq
      ? stat('Linha reta à sede', h.straight_km != null ? `${fmt.dec(h.straight_km)} km` : null, 'nossa conta (PostGIS)', NO_DATA('distância'))
      : stat('Renda mediana', h.income.available ? brl(h.income.median) : null, 'IBGE, Censo 2022', NO_DATA('renda'));
    return html`<article class="slide slide-hood">
      <div class="slide-main">
        <p class="ov-eyebrow" data-cx>${h.rank}º de ${d.count} · ${unit1()}</p><h2 data-cx>${h.name}</h2>
        <p class="slide-hero" data-cx>${countNumber(h.score, { decimals: 1 })}<small>de 100</small></p>
        <p class="slide-reading" data-cx>${d.readings[h.id]}</p>
        <div class="slide-tiles">
          ${stat('Moradores', h.population != null ? fmt.int(h.population) : null, 'IBGE, Censo 2022', NO_DATA('população'))}
          ${stat('Mesmo ramo', comp ? fmt.int(comp.n) : null, `CNPJ, ref. ${ref()}`, d.competition_missing)}
          ${third}
        </div>
      </div>
      <div class="slide-map is-small" data-cx>${map({ highlight: h.id, labels: new Map([[h.id, String(h.rank)]]), label: `${h.name} destacado no mapa da cidade` })}</div>
      ${foot(`Nota de 0 a 100 entre os ${d.count} ${d.unit} da cidade. Cobertura dos dados neste ${unit1()}: ${COVERAGE[h.coverage.level]} (${fmt.int(h.coverage.located_count)} cadastros localizados).`)}
    </article>`;
  }

  function slides() {
    const n = d.neighborhoods.length;
    const cc = d.city_coverage;
    const sem = (v, f) => (v == null ? 'sem dado¹' : f(v));
    const missing = d.neighborhoods.some((h) => h.population == null || !h.competition || !h.income.available || (d.hq && h.straight_km == null));
    return [
      // (a) capa
      html`<article class="slide slide-title"><div>
          <p class="ov-eyebrow" data-cx>${d.company.segment || 'Análise de localização'}</p><h2 data-cx>${d.city.name} – ${d.city.uf}</h2>
          <p class="slide-lead" data-cx>Os ${n} ${d.unit} que mais combinam com os critérios de ${d.company.name || 'sua empresa'}</p>
          <p class="small" data-cx>${d.generated_label} · código dos parâmetros ${d.params_code}</p>
          <p class="slide-badge" data-cx>${d.not_advice}</p></div>
        <div class="slide-map" data-cx>${map({ fill: rankFill, labels: ranks(), label: `Mapa de ${d.city.name} com as posições` })}</div></article>`,
      // (b) o que buscamos
      html`<article class="slide">${kicker('O que buscamos', 'O que a empresa quer por perto e longe')}
        <ul class="slide-wants">${d.wants.map((w) => html`<li class="${w.direction === 'attract' ? 'is-near' : 'is-far'}" data-cx>
          <strong>${w.text}</strong><span>${w.importance}</span><small>peso ${w.weight} de 5</small></li>`)}</ul>
        ${foot(`${d.more_criteria ? `Mais ${d.more_criteria} critério(s) no relatório completo. ` : ''}A faixa de faturamento e a sede não entram na nota.`)}</article>`,
      // (c) visão geral
      html`<article class="slide">${kicker('Visão geral', `Os ${n} ${d.unit} que mais combinam, no mapa`)}
        <div class="slide-split"><div class="slide-map" data-cx>${map({ fill: rankFill, labels: ranks(), label: 'Mapa com as posições numeradas' })}</div>
        <ol class="slide-rank">${d.neighborhoods.map((h) => html`<li data-cx><span class="slide-pos" style="--c:${RANK_COLOR[h.rank - 1]}">${h.rank}</span>
          <strong>${h.name}</strong><span class="slide-score">${countNumber(h.score, { decimals: 1 })}</span></li>`)}</ol></div>
        ${foot(`Número no mapa = posição; nota de 0 a 100 pelos critérios e pesos definidos. Limites: IBGE, 2022. Estabelecimentos: CNPJ, ref. ${ref()}.`)}</article>`,
      // (d) um por bairro
      ...d.neighborhoods.map(hoodSlide),
      // (e) comparação
      html`<article class="slide">${kicker('Comparação', `Os ${n} lado a lado`)}
        <div class="slide-cmp">${d.neighborhoods.map((h) => html`<div class="slide-cmp-col" data-cx>
          <p class="slide-cmp-head"><span class="slide-pos">${h.rank}</span><strong>${h.name}</strong></p>
          <p class="slide-cmp-score">${countNumber(h.score, { decimals: 1 })}</p>${growBar(h.score / 100, `Nota ${fmt.dec(h.score)} de 100`)}
          <dl><dt>Moradores</dt><dd>${sem(h.population, fmt.int)}</dd>
            <dt>Mesmo ramo</dt><dd>${h.competition ? fmt.int(h.competition.n) : 'sem dado¹'}</dd>
            <dt>Renda mediana</dt><dd>${h.income.available ? brl(h.income.median) : 'sem dado¹'}</dd>
            <dt>Linha reta à sede</dt><dd>${d.hq ? sem(h.straight_km, (v) => `${fmt.dec(v)} km`) : 'sem sede'}</dd></dl></div>`)}</div>
        ${foot(`Nota de 0 a 100 (barra). Moradores e renda: IBGE, Censo 2022. Mesmo ramo: CNPJ, ref. ${ref()}. Linha reta: nossa conta.${missing ? ` ¹ ${NO_DATA('[item]')}` : ''}`)}</article>`,
      // (f) como lemos os dados
      html`<article class="slide">${kicker('Como lemos os dados', 'Três ideias para ler as notas')}
        <ol class="slide-ideas">
          <li data-cx><strong>Contamos</strong><span>estabelecimentos de cada tipo escolhido em cada ${unit1()}, por km².</span></li>
          <li data-cx><strong>Comparamos</strong><span>cada ${unit1()} com os outros da mesma cidade: a nota é relativa, de 0 a 100.</span></li>
          <li data-cx><strong>Pesamos</strong><span>pelo que a empresa quer perto ou longe e pela importância de cada critério.</span></li></ol>
        ${foot(`Mesmos critérios e mesma base = mesmo ranking (código ${d.params_code}). Método completo no relatório em PDF.`)}</article>`,
      // (g) próximos passos
      html`<article class="slide">${kicker('Próximos passos', `Conhecer os ${d.unit} de perto`)}
        <ol class="slide-steps">
          <li data-cx>Monte o Roteiro de visita: escolha 3 ${d.unit} e receba a ordem sugerida.</li>
          <li data-cx>Vá em dias e horários parecidos com os do seu negócio.</li>
          <li data-cx>Anote no checklist de campo: movimento de pessoas, estacionamento, concorrentes visíveis.</li>
          <li data-cx>Decida com o que você viu e com os números deste material.</li></ol>
        <p data-cx><button type="button" class="btn btn-primary" data-roteiro>${icon('pin', 16)} Montar roteiro de visita</button></p></article>`,
      // (h) fontes, datas, cobertura e aviso legal
      html`<article class="slide">${kicker('Fontes, datas e cobertura', 'De onde vêm os números')}
        <div class="slide-split"><ul class="slide-sources" data-cx>${d.sources.filter((s) => s.key !== 'ibge_malhas').map((s) => html`<li>${s.name} (ref. ${s.reference_date})</li>`)}</ul>
          <div class="slide-tile" data-cx><span class="slide-label">Cobertura na cidade</span><strong class="slide-cmp-score">${countNumber(Math.round(cc.share * 100))}%</strong>
            <span class="slide-src">dos ${fmt.int(cc.total_active)} cadastros ativos do CNPJ (ref. ${ref()}) localizados em ${d.unit}</span></div></div>
        <div class="slide-legal" data-cx><strong>${d.legal}</strong><p>${d.legal_app}</p></div></article>`,
    ];
  }

  function show(i) {
    at = Math.max(0, Math.min(all.length - 1, i));
    const stage = root.querySelector('[data-stage]');
    if (!stage) return;
    offView();
    mount(stage, all[at]);
    cascade(stage);
    offView = animateOnView(stage);
    root.querySelector('[data-count]').textContent = `${at + 1} / ${all.length}`;
    root.querySelector('[data-prev]').disabled = at === 0;
    root.querySelector('[data-next]').disabled = at === all.length - 1;
  }

  root.addEventListener('page:ready', () => show(0), { signal: ac.signal });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-prev]')) show(at - 1);
    else if (e.target.closest('[data-next]')) show(at + 1);
    else if (e.target.closest('[data-roteiro]')) {
      if (document.fullscreenElement) document.exitFullscreen();
      rememberCriteria(ibge, criteria);
      location.hash = `/roteiro?city=${ibge}`;
    } else if (e.target.closest('[data-full]')) {
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
    offView();
    cleanup();
  };
}
