// Minhas análises (ref. 07): cidades e buscas abertas, validade, créditos e plano. Tudo da conta real.
import { daysText } from '../components/account.js';
import { metric, metricGroup, metricGroupSkeleton, shapeBar } from '../components/metric.js';
import { appPage, legalFooter, pageHead } from '../components/page.js';
import { loadCredits } from '../credits.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { activeCities } from '../lib.js';
import { growBar, skeleton } from '../motion.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import { get } from '../api.js';
import { pdfButton, pdfStatus, wirePdf } from '../report.js';
import '../styles/components.css';

const entered = { done: false };

export async function render(root) {
  const user = await loadUser();
  const cleanup = appPage(root, {
    active: 'analises',
    user,
    entered,
    skeleton: () => html`${pageHead({ eyebrow: 'Análises', title: 'Minhas análises', meta: 'Carregando…' })}
      ${metricGroupSkeleton(3)}
      <div class="ov-section-head"><h2>Atividade recente</h2></div><section class="ov-block" style="min-height:220px">${skeleton('16px', '40%')}</section>`,
    load: () => loadCredits(true),
    body: (credits) => {
      const r = credits.rules;
      const items = [
        ...credits.cities.map((c) => ({ ...c, kind: 'city', label: `${c.name} – ${c.uf}` })),
        ...credits.searches.map((s) => ({ ...s, kind: 'search', label: `Ranking de cidades: ${s.label}` })),
      ].sort((a, b) => b.active - a.active || b.unlocked_at.localeCompare(a.unlocked_at));
      const active = activeCities(credits).length + credits.searches.filter((s) => s.active).length;
      return html`
        ${pageHead({
          eyebrow: 'Análises',
          title: 'Minhas análises',
          meta: `${items.length} ${items.length === 1 ? 'análise' : 'análises'} desde o cadastro · validade de ${r.city_unlock_days} dias cada · reabrir no prazo não gasta crédito`,
          action: html`<button type="button" class="btn btn-primary ov-cta" data-go="/explorer">${icon('plus', 16)} Nova análise</button>`,
        })}
        ${metricGroup(
          metric({
            primary: true,
            label: 'Análises no prazo',
            value: active,
            shape: items.length ? shapeBar(active / items.length, `${active} de ${items.length} no prazo`) : '',
            note: items.length ? `${active} de ${items.length} ${items.length === 1 ? 'análise' : 'análises'} ainda no prazo de ${r.city_unlock_days} dias.` : 'Nenhuma análise aberta ainda.',
          }),
          [
            metric({ label: 'Total de análises', value: items.length, note: 'cidades e alcances abertos até hoje' }),
            metric({ label: 'Créditos', value: credits.balance, extra: html`<a class="ov-textlink" href="#/creditos">Comprar mais créditos ${icon('chevron', 14)}</a>` }),
            metric({ label: 'Plano', text: credits.plan }),
          ],
        )}
        <div class="ov-section-head" data-cx><h2>Atividade recente</h2><span>${items.length ? `${items.length} no total` : ''}</span></div>
        <section class="ov-block" data-cx>
          ${items.length
            ? html`<ul class="ov-analyses">${items.map(
                (x) => html`<li data-pdf-scope><div class="ov-analysis ${x.active ? '' : 'is-expired'}">
                  <span class="ov-miniicon">${icon(x.kind === 'city' ? 'map' : 'list', 15)}</span>
                  <span class="ov-analysis-name">${x.label}<small class="ov-days-bar">${growBar(x.active ? x.days_left / r.city_unlock_days : 0, `${x.days_left} de ${r.city_unlock_days} dias`)}</small></span>
                  <span class="ov-analysis-days small tabular">${icon('clock', 13)} ${daysText(x)}</span>
                  <span class="ov-analysis-actions">${x.kind === 'city' && x.active ? pdfButton('report', 'btn-ghost btn-sm', x.ibge) : ''}
                  <button type="button" class="btn btn-secondary btn-sm" ${x.kind === 'city' ? html`data-open-city="${x.ibge}"` : html`data-open-search="${x.scope_key}"`}>${x.active ? 'Continuar' : 'Reabrir'}</button></span>
                </div>${x.kind === 'city' && x.active ? pdfStatus() : ''}</li>`,
              )}</ul>`
            : html`<div class="ov-empty-big"><span class="ov-miniicon">${icon('map', 20)}</span><strong>Nenhuma análise ainda</strong><p>Abra uma cidade no explorador ou peça o ranking de cidades de um alcance. Cada análise fica aqui com os dias de validade.</p></div>`}
        </section>
        <div class="ov-section-head" data-cx><h2>Sua próxima exploração</h2></div>
        <div class="ov-widegrid">
          <section class="ov-block ov-next" data-cx><h3>Explorar o mapa</h3><p>Do Brasil à região, ao estado, à cidade e ao bairro, com os critérios que você definiu.</p><button type="button" class="btn btn-primary" data-go="/explorer">${icon('map', 16)} Explorar</button></section>
          <section class="ov-block ov-next" data-cx><h3>Comparar cidades</h3><p>Veja as cidades que mais combinam com seus critérios num alcance, ou compare as que você já abriu lado a lado.</p><button type="button" class="btn btn-secondary" data-go="/comparar">${icon('list', 16)} Comparar</button></section>
        </div>
        ${legalFooter()}`;
    },
  });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-city], [data-open-search], [data-go]');
    if (!b) return;
    if (b.dataset.openCity) go(`/explorer?city=${b.dataset.openCity}`);
    else if (b.dataset.openSearch) go(`/explorer?search=${b.dataset.openSearch}`);
    else go(b.dataset.go);
  });
  // Relatório a partir daqui: critérios e pesos salvos no perfil (os mesmos que o explorador abre).
  const ac = new AbortController();
  wirePdf(root, { body: async () => ({ criteria: (await get('/api/profile')).criteria }), signal: ac.signal });
  return () => {
    ac.abort();
    cleanup();
  };
}
