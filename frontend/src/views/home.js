// Visão geral (ref. 01): tudo com dados reais da conta. Esqueleto primeiro, cascata na primeira exibição,
// números que contam. O que é ilustração diz que é.
import { get, getCached } from '../api.js';
import { companyCard, daysText } from '../components/account.js';
import { metric, metricGroup, metricGroupSkeleton, shapeBar } from '../components/metric.js';
import { appPage, legalFooter, pageHead } from '../components/page.js';
import { loadCredits } from '../credits.js';
import { html } from '../html.js';
import { icon } from '../icons.js';
import { activeCities, firstName, lastCity } from '../lib.js';
import { growBar, skeleton } from '../motion.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const DIRECTION = { attract: 'Quero perto', repel: 'Não quero perto' };
const entered = { done: false }; // cascata só na primeira exibição da sessão

// Desenho abstrato (não é mapa de lugar nenhum): só ilustra a ideia de aproximar um bairro.
const ART = html`<svg viewBox="0 0 480 340" aria-hidden="true" focusable="false">
  <defs><pattern id="ovGrid" patternUnits="userSpaceOnUse" width="30" height="30" patternTransform="rotate(7)"><path d="M30 0H0V30" class="ov-art-grid"/></pattern></defs>
  <rect x="10" y="10" width="460" height="320" rx="22" fill="url(#ovGrid)" class="ov-art-frame"/>
  <path class="ov-art-land" d="M40 90 120 52 182 74 214 30 292 52 352 26 440 92 410 150 454 210 380 252 360 306 252 314 196 266 116 290 36 196Z"/>
  <path class="ov-art-road" d="M-10 186C96 140 150 204 256 150S420 128 490 48M-10 262C124 188 222 240 300 220S438 200 492 168M66-10C122 140 172 262 226 350M290-10C214 118 312 212 378 350"/>
  <path class="ov-art-pick" d="M250 132 314 114 352 164 330 220 274 232 228 196Z"/>
  <circle cx="290" cy="174" r="24" class="ov-art-ring"/><circle cx="290" cy="174" r="8" class="ov-art-dot"/>
</svg>`;

const updated = () => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());

export async function render(root) {
  const user = await loadUser();
  const cleanup = appPage(root, {
    active: 'home',
    user,
    entered,
    skeleton: () => html`
      ${pageHead({ eyebrow: 'Visão geral', greeting: `Olá, ${firstName(user.name)}.`, title: 'Seus créditos e análises', meta: 'Carregando os dados da sua conta…' })}
      ${metricGroupSkeleton(3)}
      <div class="ov-section-head"><h2>Continue de onde parou</h2></div>
      <div class="ov-widegrid"><section class="ov-block" style="min-height:260px">${skeleton('16px', '40%')}</section><section class="ov-block" style="min-height:260px">${skeleton('16px', '40%')}</section></div>
      <div class="ov-topgrid ov-topgrid-low"><section class="ov-hero"></section><div class="ov-sidestack"><div class="ov-sidelarge"></div><div class="ov-quick"></div></div></div>`,
    load: () => Promise.all([get('/api/profile'), loadCredits(true), getCached('/api/catalog/business-types')]),
    body: ([profile, credits, types]) => {
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
      return html`
        ${pageHead({
          eyebrow: 'Visão geral',
          greeting: `Olá, ${firstName(user.name)}.`,
          title: 'Seus créditos e análises',
          meta: `Atualizado em ${updated()} · dados da sua conta`,
          action: html`<button type="button" class="btn btn-primary ov-cta" data-go="/explorer">${icon('map', 16)} Analisar uma cidade</button>`,
          aside: companyCard(p, user, { compact: true }),
        })}
        ${metricGroup(
          metric({
            primary: true,
            label: 'Créditos disponíveis',
            value: credits.balance,
            shape: credits.used + credits.balance > 0 ? shapeBar(credits.balance / (credits.used + credits.balance), `${credits.balance} restantes de ${credits.used + credits.balance}`) : '',
            extra: credits.used + credits.balance > 0 ? html`<span class="metric-split"><span>${credits.used} ${credits.used === 1 ? 'usado' : 'usados'}</span><span>${credits.balance} ${credits.balance === 1 ? 'restante' : 'restantes'}</span></span>` : '',
            note: html`1 crédito = 1 cidade por ${r.city_unlock_days} dias. O ranking de cidades usa ${r.city_search_cost} por busca. <a href="#/creditos">Comprar mais créditos</a>`,
          }),
          [
            metric({ label: 'Análises ativas', value: active.length, note: active.length === 1 ? 'cidade aberta e no prazo' : 'cidades abertas e no prazo' }),
            ...(hq ? [metric({ label: 'Cidade de referência', text: hq, note: 'A sede não entra no cálculo.' })] : []),
          ],
        )}

        <div class="ov-section-head" data-cx><h2>Continue de onde parou</h2><span>Você tem o controle</span></div>
        <div class="ov-widegrid">
          <section class="ov-block" id="analises" aria-labelledby="ovAn" data-cx>
            <div class="ov-block-header"><h3 id="ovAn">Minhas análises</h3>
              <a class="ov-textlink" href="#/analises">Ver todas ${icon('chevron', 14)}</a></div>
            ${items.length
              ? html`<ul class="ov-analyses">${items.slice(0, 3).map(
                  (x) => html`<li><button type="button" class="ov-analysis ${x.active ? '' : 'is-expired'}"
                      ${x.kind === 'city' ? html`data-open-city="${x.ibge}"` : html`data-open-search="${x.scope_key}"`}>
                    <span class="ov-miniicon">${icon(x.kind === 'city' ? 'map' : 'list', 15)}</span>
                    <span class="ov-analysis-name">${x.label}</span>
                    <span class="ov-analysis-days small tabular">${icon('clock', 13)} ${daysText(x)}</span>
                  </button></li>`,
                )}</ul>`
              : html`<p class="ov-empty">Nenhuma análise ainda. Abra uma cidade para começar: cada análise fica aqui com os dias de validade.</p>`}
          </section>
          <section class="ov-block" aria-labelledby="ovCrit" data-cx>
            <div class="ov-block-header"><h3 id="ovCrit">O que você escolhe</h3>
              <a class="ov-textlink" href="#/criterios">Editar ${icon('chevron', 14)}</a></div>
            ${profile.criteria.length
              ? html`<ol class="ov-criteria">${profile.criteria.map(
                  (c, i) => html`<li class="ov-criterion">
                    <span class="ov-criterion-num tabular">${String(i + 1).padStart(2, '0')}</span>
                    <div><strong>${typeName[c.business_type_key] || c.business_type_key}</strong><small>${DIRECTION[c.direction]}</small>${growBar(c.weight / 5, `Peso ${c.weight} de 5`)}</div>
                    <span class="ov-weight tabular">Peso ${c.weight}</span>
                  </li>`,
                )}</ol>`
              : html`<p class="ov-empty">Nenhum critério ainda. Defina o que você quer perto e o que não quer perto do seu negócio.</p>`}
          </section>
        </div>
        <div class="ov-topgrid ov-topgrid-low">
          <section class="ov-hero" aria-labelledby="ovHeroTitle" data-cx>
            <div class="ov-hero-copy">
              <div class="ov-hero-tag">Comece pelo território</div>
              <h2 id="ovHeroTitle">Do Brasil ao bairro.<br />No seu ritmo.</h2>
              <p>Navegue da região à cidade em uma câmera contínua e compare bairros com os critérios que você definiu.</p>
              <div class="ov-hero-actions">
                <button type="button" class="ov-btn" data-go="/explorer">${icon('map', 16)} Abrir explorador</button>
                <a class="ov-btn ov-btn-ghost" href="/#como-funciona">Como funciona</a>
              </div>
            </div>
            <div class="ov-hero-art">${ART}</div>
            <span class="ov-art-label">Ilustração</span>
          </section>
          <div class="ov-sidestack">
            <div class="ov-sidelarge" data-cx>
              <div class="ov-kicker">01 / Seu negócio</div>
              <h3>Você escolhe<br />os critérios.</h3>
              <p>A plataforma ordena áreas conforme as preferências do seu negócio, sem promessas de resultado.</p>
              <div class="ov-orbit" aria-hidden="true"></div>
            </div>
            <div class="ov-quick" data-cx>
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

        ${legalFooter()}`;
    },
  });

  // Tutorial: na primeira entrada da conta (o servidor guarda) ou sob demanda (#/home?tutorial=1, Minha conta).
  const replay = new URLSearchParams(location.hash.split('?')[1] || '').get('tutorial') === '1';
  if (replay) history.replaceState(null, '', '#/home');
  if (replay || !user.tutorial_done)
    root.addEventListener('page:ready', (e) => {
      const credits = e.detail[1];
      import('../components/tutorial.js').then(({ startTutorial }) =>
        startTutorial({ days: credits.rules.city_unlock_days, replay, onDone: () => (user.tutorial_done = true) }),
      );
    }, { once: true });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-city], [data-open-search], [data-go]');
    if (!b) return;
    if (b.dataset.openCity) go(`/explorer?city=${b.dataset.openCity}`);
    else if (b.dataset.openSearch) go(`/explorer?search=${b.dataset.openSearch}`);
    else go(b.dataset.go);
  });
  return cleanup;
}
