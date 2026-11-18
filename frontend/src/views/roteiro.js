// Roteiro de visita: a pessoa marca 3 bairros do ranking e o servidor sugere a ordem (tempo de carro do Google,
// dentro da cota, ou distância em linha reta). O checklist é um guia de campo em branco: marcações e anotações ficam
// só neste aparelho (localStorage) e nunca vão para o servidor.
import { get, post } from '../api.js';
import { appPage, legalFooter, pageHead } from '../components/page.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { recalledCriteria, pdfButton, pdfStatus, wirePdf } from '../report.js';
import { skeleton } from '../motion.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const entered = { done: false };
const PICK = 3;
const LIST = 15;
const NOTES = (ibge, id) => `roteiro:${ibge}:${id}`;
const DIR = { attract: 'quer perto', repel: 'quer longe' };

function readNotes(ibge, id) {
  try {
    return JSON.parse(localStorage.getItem(NOTES(ibge, id)) || '{}');
  } catch {
    return {};
  }
}
function writeNotes(ibge, id, v) {
  try {
    localStorage.setItem(NOTES(ibge, id), JSON.stringify(v));
  } catch {
    /* sem armazenamento: as marcações valem até sair da tela */
  }
}

export async function render(root) {
  const ibge = Number(new URLSearchParams(location.hash.split('?')[1] || '').get('city'));
  const user = await loadUser();
  const ac = new AbortController();
  const st = { picked: [], showAll: false, plan: null, busy: false, error: null };
  let criteria, rank;

  const cleanup = appPage(root, {
    active: 'analises',
    user,
    entered,
    skeleton: () => html`${pageHead({ eyebrow: 'Roteiro de visita', title: 'Carregando…' })}<section class="ov-block">${skeleton('16px', '50%')}</section>`,
    load: async () => {
      if (!ibge) throw new Error('Abra uma cidade no explorador para montar o roteiro.');
      criteria = recalledCriteria(ibge) || (await get('/api/profile')).criteria;
      rank = await post(`/api/cities/${ibge}/rank`, { criteria });
      if (rank.status !== 'ok') throw new Error(rank.message);
      return rank;
    },
    body: () => html`${pageHead({
        eyebrow: 'Roteiro de visita',
        title: `Conhecer ${rank.city.name} de perto`,
        meta: `Marque ${PICK} ${rank.division_kind === 'area' ? 'áreas' : 'bairros'} do ranking. Sugerimos a ordem da visita e um checklist de campo em branco para você preencher no local.`,
      })}
      <div data-route-body>${content()}</div>
      ${legalFooter()}`,
  });

  function content() {
    return st.plan ? planView() : pickView();
  }

  function pickView() {
    const list = st.showAll ? rank.neighborhoods : rank.neighborhoods.slice(0, LIST);
    const n = st.picked.length;
    return html`<section class="ov-block route-pick" data-cx>
      <div class="section-head"><h2>Escolha ${PICK}</h2><span class="small muted tabular" aria-live="polite">${n} de ${PICK} marcados</span></div>
      <ol class="route-list">${list.map((h) => {
        const on = st.picked.includes(h.id);
        return html`<li><label class="route-option ${on ? 'is-on' : ''}">
          <input type="checkbox" value="${h.id}" data-pick ${on ? 'checked' : ''} ${!on && n >= PICK ? 'disabled' : ''} />
          <span class="rank-pos tabular">${h.rank}</span><span class="route-name">${h.name}</span>
          <span class="tabular small">nota ${fmt.dec(h.score)}</span></label></li>`;
      })}</ol>
      ${rank.count > LIST ? html`<button type="button" class="btn btn-ghost btn-sm" data-all>${st.showAll ? `Mostrar só os ${LIST} primeiros` : `Ver todos (${rank.count})`}</button>` : ''}
      ${st.error ? html`<div class="alert alert-error" role="alert">${icon('alert', 16)}<span>${st.error}</span></div>` : ''}
      <button type="button" class="btn btn-primary" data-plan ${n === PICK && !st.busy ? '' : 'disabled'} ${st.busy ? 'aria-busy="true"' : ''}>
        ${icon('pin', 16)} ${st.busy ? 'Montando o roteiro…' : 'Montar roteiro'}</button>
    </section>`;
  }

  function legView(leg, p) {
    if (!leg) return html`<p class="small muted">Primeira parada.</p>`;
    return html`<p class="small">Saindo de ${leg.from}: <strong class="tabular">${fmt.dec(leg.straight_km)} km</strong> em linha reta</p>
      ${leg.car_min != null
        ? html`<p class="route-google small">De carro: <strong class="tabular">${leg.car_min} min · ${fmt.dec(leg.car_km)} km</strong><span class="route-attr">Google Maps</span></p>`
        : html`<p class="small muted">${p.unavailable || 'Tempo de deslocamento indisponível.'}</p>`}`;
  }

  function planView() {
    const p = st.plan;
    return html`<section class="ov-block" data-cx>
        <div class="section-head"><h2>Ordem sugerida</h2><button type="button" class="btn btn-ghost btn-sm" data-repick>${icon('edit', 15)} Trocar a escolha</button></div>
        <p class="small muted">Pela menor soma de ${p.basis}${p.hq ? ', saindo da sede' : ''}. É só uma sugestão de trajeto.</p>
        ${p.google_ok ? html`<p class="small muted">Tempos de carro: Google Maps, consultados em ${p.generated_label}, sem trânsito em tempo real. Não são guardados.</p>` : ''}
      </section>
      ${p.stops.map((x) => {
        const saved = readNotes(ibge, x.id);
        return html`<section class="ov-block route-stop" data-cx data-stop="${x.id}">
          <header class="route-stop-head"><span class="route-order" aria-hidden="true">${x.order}</span>
            <div><p class="ov-eyebrow">Parada ${x.order} de 3 · posição ${x.rank} no ranking</p><h2>${x.name}</h2>
            <p class="small muted">Nota ${fmt.dec(x.score)} de 100</p></div></header>
          ${legView(x.leg, p)}
          <ul class="route-facts small">
            <li>População: ${x.population != null ? html`<strong class="tabular">${fmt.int(x.population)}</strong> (IBGE, Censo 2022)` : 'Não foi possível encontrar dados de população desta área.'}</li>
            ${x.competition && !x.criteria.some((c) => c.type === p.competitor.key) ? html`<li>${p.competitor.name_plural} (mesmo ramo): <strong class="tabular">${fmt.int(x.competition.n)}</strong></li>` : ''}
            ${x.criteria.map((c) => html`<li>${c.name_plural} (${DIR[c.direction]}): <strong class="tabular">${fmt.int(c.n)}</strong></li>`)}
          </ul>
          <p class="small muted">Contagens: Receita Federal (CNPJ) e CNES, ref. ${p.reference_dates.establishments}.</p>
          <fieldset class="route-check"><legend>Checklist de campo</legend>
            ${p.checklist.map((c, i) => html`<label class="route-check-item"><input type="checkbox" data-check="${i}" ${saved.checks?.[i] ? 'checked' : ''} />
              <span><strong>${c.title}</strong><span class="small muted">${c.hint}</span></span></label>`)}
            <label class="field small">Anotações livres<textarea class="input" rows="4" data-notes>${saved.notes || ''}</textarea></label>
            <p class="small muted">Marcações e anotações ficam só neste aparelho.</p>
          </fieldset>
        </section>`;
      })}
      <section class="ov-block report-actions" data-cx data-pdf-scope>
        <div class="section-head"><h2>Para imprimir</h2></div>
        <p class="small muted">Uma página por bairro, com o checklist em branco.</p>
        ${pdfButton('route')}${pdfStatus()}
        <p class="small">${p.legal} ${p.legal_app}</p>
      </section>`;
  }

  const redraw = () => mount(root.querySelector('[data-route-body]'), content());

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-pick]')) {
      const id = Number(t.value);
      st.picked = t.checked ? [...st.picked, id].slice(0, PICK) : st.picked.filter((x) => x !== id);
      st.error = null;
      redraw();
      return root.querySelector(`[data-pick][value="${id}"]`)?.focus(); // o foco fica na mesma caixa (teclado)
    }
    const stop = t.closest('[data-stop]');
    if (stop && t.matches('[data-check]')) {
      const v = readNotes(ibge, stop.dataset.stop);
      writeNotes(ibge, stop.dataset.stop, { ...v, checks: { ...v.checks, [t.dataset.check]: t.checked } });
    }
  }, { signal: ac.signal });
  root.addEventListener('input', (e) => {
    const stop = e.target.closest('[data-stop]');
    if (stop && e.target.matches('[data-notes]')) writeNotes(ibge, stop.dataset.stop, { ...readNotes(ibge, stop.dataset.stop), notes: e.target.value });
  }, { signal: ac.signal });
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-all]')) {
      st.showAll = !st.showAll;
      return redraw();
    }
    if (e.target.closest('[data-repick]')) {
      st.plan = null;
      return redraw();
    }
    if (e.target.closest('[data-plan]') && st.picked.length === PICK && !st.busy) {
      st.busy = true;
      redraw();
      try {
        st.plan = await post(`/api/cities/${ibge}/route`, { criteria, neighborhoods: st.picked }, { signal: ac.signal });
      } catch (err) {
        if (err.name === 'AbortError') return;
        st.error = err.message;
      }
      st.busy = false;
      redraw();
    }
  }, { signal: ac.signal });
  wirePdf(root, { ibge, body: () => ({ criteria, neighborhoods: st.picked }), signal: ac.signal });

  return () => {
    ac.abort();
    cleanup();
  };
}
