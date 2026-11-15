// Blocos da conta, reaproveitados na tela inicial e no painel do explorador. Só estrutura e classes:
// o visual fica em styles/components.css (tokens), para trocar o estilo sem mexer aqui.
import { fmt, html } from '../html.js';
import { icon } from '../icons.js';
import { initials, REVENUE_LABEL } from '../lib.js';

// Foto/logo da empresa ou, sem ela, as iniciais. Tamanho fixo: nada de salto de layout quando a imagem chega.
export function avatar(profile, user, size = 56) {
  const name = profile?.company_name || user?.name || '';
  return profile?.logo_url
    ? html`<img class="avatar" src="${profile.logo_url}" width="${size}" height="${size}" alt="Logo de ${name}" decoding="async" />`
    : html`<span class="avatar avatar-initials" style="--avatar:${size}px" aria-hidden="true">${initials(name)}</span>`;
}

export function companyCard(profile, user, { compact = false } = {}) {
  const p = profile || {};
  const sede = p.has_hq ? [p.hq_city_name, p.hq_uf].filter(Boolean).join(' – ') : p.has_hq === false ? 'Ainda sem sede' : '';
  const ramo = p.segment_key === 'outro' ? p.segment_other_text : p.segment_name;
  return html`<section class="acc-card company ${compact ? 'is-compact' : ''}" aria-label="Sua empresa">
    ${avatar(p, user, compact ? 40 : 64)}
    <div class="company-info">
      <strong class="company-name" title="${p.company_name || user?.name || 'Sua empresa'}">${p.company_name || user?.name || 'Sua empresa'}</strong>
      <span class="small muted" title="${[ramo, sede].filter(Boolean).join(' · ')}">${[ramo, sede].filter(Boolean).join(' · ')}</span>
      ${compact ? '' : html`<span class="small muted">Faturamento anual: ${REVENUE_LABEL[p.revenue_band] || 'não informado'}</span>`}
    </div>
    <a class="btn btn-ghost btn-sm" href="#/onboarding">${icon('edit', 15)}<span class="${compact ? 'sr-only' : ''}">Editar</span></a>
  </section>`;
}

export function creditsCard(state, { compact = false } = {}) {
  if (!state) return html`<section class="acc-card credits skeleton-block" aria-busy="true"></section>`;
  const r = state.rules;
  return html`<section class="acc-card credits ${compact ? 'is-compact' : ''}" aria-label="Créditos">
    <span class="credits-icon">${icon('coin', compact ? 18 : 22)}</span>
    <div>
      <strong class="tabular">${state.balance === 1 ? '1 crédito' : `${fmt.int(state.balance)} créditos`}</strong>
      <span class="small muted"> · Plano ${state.plan}</span>
      ${compact
        ? ''
        : html`<p class="small muted">1 crédito = analisar 1 cidade por ${r.city_unlock_days} dias (reabrir no prazo não gasta).
            O ranking de cidades usa ${r.city_search_cost} crédito por busca (um alcance: Brasil, uma região ou um estado).</p>`}
    </div>
  </section>`;
}

export const daysText = (x) => (x.active ? (x.days_left === 1 ? 'vence em 1 dia' : `vence em ${x.days_left} dias`) : 'vencida');

export function analysesList(state, { compact = false, limit = Infinity } = {}) {
  if (!state) return html`<section class="acc-card analyses skeleton-block" aria-busy="true"></section>`;
  const items = [
    ...state.cities.map((c) => ({ ...c, kind: 'city', label: `${c.name} – ${c.uf}` })),
    ...state.searches.map((s) => ({ ...s, kind: 'search', label: `Ranking de cidades: ${s.label}` })),
  ].sort((a, b) => b.active - a.active || b.unlocked_at.localeCompare(a.unlocked_at));
  const shown = items.slice(0, limit);
  return html`<section class="acc-card analyses ${compact ? 'is-compact' : ''}" aria-label="Minhas análises">
    <h2 class="acc-title">Minhas análises</h2>
    ${shown.length
      ? html`<ul class="analyses-list">${shown.map(
          (x) => html`<li><button type="button" class="analysis ${x.active ? '' : 'is-expired'}"
              data-open-city="${x.kind === 'city' ? x.ibge : ''}" data-open-search="${x.kind === 'search' ? x.scope_key : ''}">
              <span class="analysis-icon">${icon(x.kind === 'city' ? 'map' : 'list', 16)}</span>
              <span class="analysis-name" title="${x.label}">${x.label}</span>
              <span class="analysis-days small tabular">${icon('clock', 13)} ${daysText(x)}</span>
            </button></li>`,
        )}</ul>
        ${items.length > shown.length ? html`<a class="small" href="#/home">Ver todas (${items.length})</a>` : ''}`
      : html`<p class="small muted">Nenhuma análise ainda. Abra uma cidade para começar.</p>`}
  </section>`;
}
