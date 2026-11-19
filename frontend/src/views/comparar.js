// Comparar cidades (ref. 08): só cidades já abertas (sem custo), lado a lado, com indicadores do IBGE e da Receita
// com fonte e data. Nenhuma nota entre cidades nem inferência: só os números de cada uma.
// Outra cidade abre no explorador, que pede a confirmação do crédito.
import { get } from '../api.js';
import { compareRows } from '../compareRows.js';
import { metric } from '../components/metric.js';
import { miniMap } from '../components/miniMap.js';
import { appPage, legalFooter, pageHead } from '../components/page.js';
import { loadCredits } from '../credits.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { activeCities } from '../lib.js';
import { animateOnView, countNumber, growBar, skeleton } from '../motion.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const entered = { done: false };
const MAX_COLS = 3;
const NO_DATA = (item) => `Não foi possível encontrar dados de ${item} desta área.`;
const picked = []; // ibge das colunas (fica ao sair e voltar nesta sessão)
const cache = new Map(); // ibge -> { status, geo }

async function cityData(ibge) {
  if (!cache.has(ibge))
    cache.set(ibge, get(`/api/cities/${ibge}/status`).then(async (status) => ({
      status,
      geo: status.has_data ? await get(`/api/cities/${ibge}/neighborhoods.geojson?v=${encodeURIComponent(status.loaded_at)}`).catch(() => null) : null,
    })));
  return cache.get(ibge);
}

const column = ({ status: st, geo }) => html`<section class="ov-block cmp-col" data-cx>
  <div class="ov-block-header"><h3>${st.name} – ${st.uf}</h3><button type="button" class="btn btn-ghost btn-sm btn-icon" data-remove="${st.ibge}" aria-label="Tirar ${st.name} da comparação">${icon('close', 14)}</button></div>
  ${geo ? miniMap(geo, { label: `Limites dos bairros de ${st.name}` }) : ''}
  <dl class="cmp-list">
    <div><dt>População</dt><dd>${st.population != null ? countNumber(st.population) : NO_DATA('população')}<small>IBGE, Censo 2022</small></dd></div>
    <div><dt>Área</dt><dd>${st.area_km2 ? html`<span class="tabular">${fmt.dec(st.area_km2)}</span> km²` : NO_DATA('área')}<small>IBGE, Censo 2022</small></dd></div>
    ${st.has_data
      ? html`<div><dt>${st.division_kind === 'area' ? 'Áreas' : 'Bairros'}</dt><dd>${countNumber(st.neighborhoods)}<small>limites do IBGE, 2022</small></dd></div>
        <div><dt>Cadastros ativos (CNPJ)</dt><dd>${countNumber(st.coverage.total_active)}<small>Receita Federal, ref. ${st.reference_month}; só tipos do catálogo</small></dd></div>
        <div><dt>Cobertura</dt><dd><span class="tabular">${fmt.pct(st.coverage.share)}</span> localizados${growBar(st.coverage.share, `${fmt.pct(st.coverage.share)} localizados`)}<small>parte dos cadastros localizada em um bairro</small></dd></div>`
      : html`<p class="ov-empty">${NO_DATA('estabelecimentos')}</p>`}
    <div><dt>Renda mediana</dt><dd>${st.income?.available ? html`R$ <span class="tabular">${fmt.int(Math.round(st.income.median))}</span>/mês` : st.income?.message || NO_DATA('renda')}<small>${st.income?.source?.name || 'IBGE, Censo 2022'}</small></dd></div>
  </dl>
  <button type="button" class="btn btn-secondary btn-sm btn-block" data-open-city="${st.ibge}">${icon('map', 14)} Ver análise local</button>
</section>`;

// "Lado a lado": as duas primeiras cidades, uma linha por indicador. O maior valor leva o texto "maior" (não só cor).
const sideBySide = (cols) => {
  if (cols.length < 2) return '';
  const [a, b] = cols.map((c) => c.status);
  return html`<section class="ov-block cmp-side" aria-labelledby="cmpSideTitle" data-cx>
    <div class="cmp-side-head"><h2 id="cmpSideTitle">Lado a lado</h2>
      <p class="small muted">${a.name} e ${b.name}: o valor de cada cidade e a diferença entre elas.${cols.length > 2 ? ' Só as duas primeiras cidades da comparação.' : ''}</p></div>
    ${compareRows(a, b).map((r) => html`<div class="cmp-row">
      <div class="cmp-row-head"><h3>${r.label}</h3><small>${r.source}</small></div>
      ${[a, b].map((s, i) => metric({
        label: `${s.name} – ${s.uf}`,
        value: r.values[i],
        text: r.values[i] == null ? 'sem dado suficiente' : null,
        decimals: r.decimals,
        prefix: r.prefix,
        unit: r.unit,
        extra: r.max === i ? html`<span class="cmp-max">maior</span>` : '',
      }))}
      <p class="cmp-diff">${r.text}${r.ratio ? html`<small>razão calculada a partir dos valores ao lado</small>` : ''}</p>
    </div>`)}
  </section>`;
};

export async function render(root) {
  const user = await loadUser();
  let open = [];
  const cleanup = appPage(root, {
    active: 'compare',
    user,
    entered,
    skeleton: () => html`${pageHead({ eyebrow: 'Comparar', title: 'Comparar cidades', meta: 'Carregando…' })}
      <div class="cmp-grid"><section class="ov-block" style="min-height:420px"></section><section class="ov-block" style="min-height:420px"></section></div>`,
    load: async () => {
      open = activeCities(await loadCredits(true));
      for (const i of [...picked]) if (!open.some((c) => c.ibge === i)) picked.splice(picked.indexOf(i), 1);
      for (const c of open) if (picked.length < 2 && !picked.includes(c.ibge)) picked.push(c.ibge);
      return Promise.all(picked.map(cityData));
    },
    body: (cols) => html`
      ${pageHead({
        eyebrow: 'Comparar',
        title: 'Comparar cidades',
        meta: `${open.length} ${open.length === 1 ? 'cidade aberta' : 'cidades abertas'} · IBGE, Censo 2022 · Receita Federal (CNPJ) · sem nota entre cidades`,
        action: html`<p>As cidades que você já abriu, lado a lado, com os números de cada uma e a fonte. Para ordenar cidades pelos seus critérios, use o ranking de cidades.</p>`,
        aside: html`<button type="button" class="btn btn-secondary ov-cta" data-go="/explorer?compare=1">${icon('list', 16)} Ranking de cidades</button>`,
      })}
      ${open.length < 2
        ? html`<div class="ov-empty-big" data-cx><span class="ov-miniicon">${icon('map', 20)}</span><strong>${open.length ? 'Abra mais uma cidade para comparar' : 'Nenhuma cidade aberta'}</strong>
            <p>A comparação usa só cidades já abertas, sem custo. Abrir uma cidade nova no explorador usa 1 crédito, com confirmação antes.</p>
            <button type="button" class="btn btn-primary" data-go="/explorer">${icon('map', 16)} Abrir uma cidade</button></div>`
        : ''}
      <div class="cmp-grid" data-cols>${cols.map(column)}${addSlot()}</div>
      <div data-side>${sideBySide(cols)}</div>
      ${legalFooter()}`,
  });

  function addSlot() {
    const rest = open.filter((c) => !picked.includes(c.ibge));
    if (picked.length >= MAX_COLS || (!rest.length && open.length < 2)) return '';
    return html`<section class="ov-block cmp-add" data-cx><h3>Adicionar cidade</h3>
      ${rest.length
        ? html`<label class="small" for="cmpAdd">Cidades abertas (sem custo)</label><select id="cmpAdd" data-add><option value="">Escolha</option>${rest.map((c) => html`<option value="${c.ibge}">${c.name} – ${c.uf}</option>`)}</select>`
        : html`<p class="small muted">Todas as cidades abertas já estão aqui.</p>`}
      <p class="small muted">Outra cidade: abra no explorador (usa 1 crédito, com confirmação).</p>
      <button type="button" class="btn btn-ghost btn-sm" data-go="/explorer">${icon('plus', 14)} Abrir outra cidade</button></section>`;
  }

  async function repaint() {
    const el = root.querySelector('[data-cols]');
    const cols = await Promise.all(picked.map(cityData));
    mount(el, html`${cols.map(column)}${addSlot()}`);
    const side = root.querySelector('[data-side]');
    mount(side, sideBySide(cols));
    animateOnView(el);
    animateOnView(side);
  }
  root.addEventListener('change', (e) => {
    if (!e.target.matches('[data-add]') || !e.target.value) return;
    picked.push(Number(e.target.value));
    repaint();
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-city], [data-go], [data-remove]');
    if (!b) return;
    if (b.dataset.remove) {
      picked.splice(picked.indexOf(Number(b.dataset.remove)), 1);
      return repaint();
    }
    go(b.dataset.openCity ? `/explorer?city=${b.dataset.openCity}` : b.dataset.go);
  });
  return cleanup;
}
