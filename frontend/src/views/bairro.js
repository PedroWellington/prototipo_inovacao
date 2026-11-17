// Detalhe de um bairro (ref. 06): #/bairro/<id>?city=<ibge>. Nota, posição, contagens, densidades, cobertura,
// renda, fontes e datas: tudo do ranking calculado no banco com os critérios atuais. Nada é estimado aqui.
import { get, post } from '../api.js';
import { incomeBlock } from '../components/income.js';
import { miniMap } from '../components/miniMap.js';
import { metric, shapeBar, shapeMark } from '../components/metric.js';
import { appPage, legalFooter, pageHead } from '../components/page.js';
import { cityActive, loadCredits } from '../credits.js';
import { fmt, html } from '../html.js';
import { icon } from '../icons.js';
import { COVERAGE_LABEL, countText, DIRECTION_LABEL, establishmentsText } from '../lib.js';
import { growBar, skeleton } from '../motion.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const entered = { done: false };
const NO_DATA = (item) => `Não foi possível encontrar dados de ${item} desta área.`;
const sk = () => html`<div class="metric">${skeleton('11px', '40%')}${skeleton('24px', '50%')}${skeleton('12px', '80%')}</div>`;

export async function render(root) {
  const user = await loadUser();
  const id = Number(location.hash.split('?')[0].split('/')[2]);
  const ibge = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('city'));
  const cleanup = appPage(root, {
    active: 'explorer',
    user,
    entered,
    cls: 'overview bairro',
    skeleton: () => html`${pageHead({ eyebrow: 'Detalhe do bairro', title: '', meta: 'Carregando…' })}
      <div class="bd-top"><section class="ov-block" style="min-height:240px"></section><section class="ov-block" style="min-height:240px"></section></div>
      <div class="bd-metrics">${sk()}${sk()}${sk()}</div>`,
    load: async () => {
      await loadCredits();
      if (!ibge || !id) throw new Error('Bairro não encontrado. Abra uma cidade no explorador e escolha um bairro.');
      if (!cityActive(ibge)) return { locked: true };
      const status = await get(`/api/cities/${ibge}/status`);
      if (!status.has_data) return { status };
      const [rank, geo] = await Promise.all([
        get('/api/profile').then((p) => post(`/api/cities/${ibge}/rank`, { criteria: p.criteria })),
        get(`/api/cities/${ibge}/neighborhoods.geojson?v=${encodeURIComponent(status.loaded_at)}`).catch(() => null),
      ]);
      return { status, rank, geo };
    },
    body: ({ locked, status, rank: r, geo }) => {
      if (locked)
        return html`<div class="ov-empty-big" data-cx><strong>Esta cidade não está aberta</strong>
          <p>O detalhe dos bairros faz parte da análise da cidade. Abra a cidade no explorador (com confirmação do crédito, se for preciso).</p>
          <button type="button" class="btn btn-primary" data-go="/explorer?city=${ibge}">${icon('map', 16)} Abrir no explorador</button></div>`;
      if (!status.has_data) return html`<p class="ov-empty" data-cx>${NO_DATA('estabelecimentos')}</p>`;
      if (r.status !== 'ok') return html`<div class="alert alert-warning" data-cx>${icon('info', 16)}<span>${r.message}</span></div>`;
      const n = r.neighborhoods.find((x) => x.id === id);
      if (!n) return html`<p class="ov-empty" data-cx>Bairro não encontrado no ranking desta cidade.</p>`;
      dispatchEvent(new CustomEvent('screen:context', { detail: { city: ibge, neighborhood: id } }));
      const area = r.division_kind === 'area';
      const unit = area ? 'área' : 'bairro';
      const typeOf = (k) => r.criteria.find((x) => x.business_type_key === k);
      return html`
        ${pageHead({
          eyebrow: `Detalhe ${area ? 'da área' : 'do bairro'}`,
          title: n.name,
          meta: `${status.name} – ${status.uf} · ${r.count} ${area ? 'áreas' : 'bairros'} · CNPJ ref. ${r.reference_dates.establishments} · limites IBGE ${r.reference_dates.boundaries} · cobertura ${COVERAGE_LABEL[n.coverage.level]}`,
          action: html`<button type="button" class="btn btn-primary ov-cta" data-go="/explorer?city=${ibge}">${icon('back', 16)} Voltar ao mapa</button>`,
        })}

        <div class="bd-top">
          ${metric({
            primary: true,
            label: `Nota pelos seus critérios · posição ${n.rank} de ${r.count}`,
            value: n.score,
            decimals: 1,
            unit: '/100',
            shape: r.count > 1 ? shapeMark((r.count - n.rank) / (r.count - 1), `Posição ${n.rank} de ${r.count}: à direita fica a primeira posição da cidade`) : '',
            extra: html`${r.count > 1 ? html`<span class="metric-split"><span>${r.count}ª posição</span><span>1ª posição</span></span>` : ''}
              <p class="metric-note">Média ponderada, pelos seus pesos, da posição relativa da densidade de cada tipo entre ${area ? 'as áreas' : 'os bairros'} da cidade. <a href="#/como-calculamos">Como calculamos</a>.</p>
              <p class="small hd-cov hd-cov-${n.coverage.level}">Cobertura de dados ${area ? 'da área' : 'do bairro'}: <strong>${COVERAGE_LABEL[n.coverage.level]}</strong> (${establishmentsText(n.coverage.located_count)} localizados)</p>`,
          })}
          <section class="ov-block bd-mini" data-cx>
            ${geo ? miniMap(geo, { highlight: id, label: `Limites de ${status.name}, com ${n.name} em destaque` }) : html`<p class="ov-empty">${NO_DATA('limites')}</p>`}
            <p class="small muted">Limites: IBGE, ${r.reference_dates.boundaries}${area ? ' (setores censitários)' : ''}.</p>
          </section>
        </div>

        <div class="ov-section-head" data-cx><h2>Indicadores</h2><span>Receita Federal (CNPJ), ref. ${r.reference_dates.establishments}</span></div>
        <div class="bd-metrics">
          ${n.criteria.map((c) => {
            const t = typeOf(c.type);
            return metric({
              label: `${t.name_plural} · ${DIRECTION_LABEL[c.direction]}, peso ${c.weight}`,
              value: c.n,
              shape: shapeBar(c.lower_share, `Densidade maior que a de ${fmt.pct(c.lower_share)} ${area ? 'das áreas' : 'dos bairros'}`),
              note: html`${countText(c.n, c.n_cnpj, t)} · ${fmt.dec(c.density_per_km2)} por km² · ${c.comparison_text}${t.precision === 'approx' ? html`<br />${t.note}` : ''}`,
            });
          })}
        </div>

        <div class="ov-widegrid">
          <section class="ov-block" data-cx>
            <div class="ov-block-header"><h3>Comparação por critério</h3></div>
            <p class="small muted">Parte ${area ? 'das áreas' : 'dos bairros'} da cidade com densidade menor que a deste ${unit}, para cada tipo.</p>
            <ul class="bd-bars">${n.criteria.map((c) => {
              const t = typeOf(c.type);
              return html`<li><div class="cov-level-head"><span>${t.name_plural} <span class="muted">(${DIRECTION_LABEL[c.direction]})</span></span><strong class="tabular">${fmt.pct(c.lower_share)}</strong></div>
                ${growBar(c.lower_share, `${t.name_plural}: ${fmt.pct(c.lower_share)}`)}<p class="small muted">${c.comparison_text}</p></li>`;
            })}</ul>
          </section>
          <section class="ov-block" data-cx>
            <div class="ov-block-header"><h3>Fonte e contexto</h3></div>
            ${incomeBlock(n.income, `${area ? 'as áreas' : 'os bairros'} da cidade`)}
            <ul class="bd-src small">
              ${r.sources.map((s) => html`<li><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a> · ref. ${s.reference_date}</li>`)}
              <li>Cobertura da cidade: ${fmt.pct(r.city_coverage.share)} dos ${fmt.int(r.city_coverage.total_active)} cadastros localizados (ref. ${status.reference_month})</li>
            </ul>
          </section>
        </div>
        ${legalFooter()}`;
    },
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) go(b.dataset.go);
  });
  return cleanup;
}
