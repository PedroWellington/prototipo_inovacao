// Editor de critérios (ref. 04): 01 Setor e objetivo · 02 Quero perto · 03 Não quero perto · 04 Pesos · 05 Resumo.
// Só tipos do catálogo real. A prévia à direita usa a última cidade aberta e o ranking calculado no banco
// com o rascunho (o frontend não calcula nota: só pinta a miniatura com a nota que voltou).
import { get, getCached, post, put } from '../api.js';
import { miniMap } from '../components/miniMap.js';
import { appPage, legalFooter } from '../components/page.js';
import { cityActive, loadCredits } from '../credits.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { debounce, lastCity, scoreColor } from '../lib.js';
import { skeleton } from '../motion.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

const entered = { done: false };
const MAX = 3; // por direção (o mesmo limite do servidor: MAX_PER_DIRECTION)
const STEPS = ['Setor e objetivo', 'Quero perto', 'Não quero perto', 'Pesos', 'Resumo'];
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function render(root) {
  const user = await loadUser();
  const s = { step: 0, list: [], saved: '', msg: '', preview: null, city: null, geo: null };
  let types, segments, profile;

  const cleanup = appPage(root, {
    active: null,
    user,
    entered,
    skeleton: () => html`<div class="ov-head"><div><div class="ov-eyebrow">Critérios</div><h1>O que você quer perto</h1>${skeleton('14px', '50%')}</div></div>
      <div class="cr-grid"><section class="ov-block" style="min-height:380px">${skeleton('16px', '40%')}</section><aside class="ov-block" style="min-height:380px"></aside></div>`,
    load: async () => {
      [types, segments, profile] = await Promise.all([getCached('/api/catalog/business-types'), getCached('/api/catalog/segments'), get('/api/profile')]);
      s.list = profile.criteria.map((c) => ({ ...c }));
      s.saved = JSON.stringify(s.list);
      const last = lastCity(await loadCredits());
      if (last && cityActive(last.ibge)) {
        const st = await get(`/api/cities/${last.ibge}/status`).catch(() => null);
        if (st?.has_data) {
          s.city = st;
          s.geo = await get(`/api/cities/${st.ibge}/neighborhoods.geojson?v=${encodeURIComponent(st.loaded_at)}`).catch(() => null);
        }
      }
    },
    body: () => html`
      <div class="ov-head" data-cx><div>
        <div class="ov-eyebrow">Critérios</div>
        <h1>O que você quer perto</h1>
        <p>Até ${MAX} tipos que você quer perto e ${MAX} que não quer perto, com peso de 1 a 5. Os bairros são ordenados por eles.</p>
      </div></div>
      <ol class="cr-steps" data-cx>${STEPS.map((t, i) => html`<li><button type="button" data-step="${i}">${String(i + 1).padStart(2, '0')} <span>${t}</span></button></li>`)}</ol>
      <div class="cr-grid">
        <section class="ov-block cr-body" data-cx data-body></section>
        <aside class="ov-block cr-preview" data-cx aria-labelledby="crPrev"><h3 id="crPrev">Prévia</h3><div data-preview></div></aside>
      </div>
      ${legalFooter()}`,
  });

  const typeOf = (k) => types.find((t) => t.key === k);
  const of = (dir) => s.list.filter((c) => c.direction === dir);

  function stepBody() {
    const p = profile.profile || {};
    if (s.step === 0) {
      const seg = p.segment_key === 'outro' ? `Outro: ${p.segment_other_text}` : segments.find((x) => x.key === p.segment_key)?.name || 'Não informado';
      return html`<h2>01 · Setor e objetivo</h2>
        <p class="small muted">Seu ramo: <strong>${seg}</strong>. Ele só sugere critérios; quem decide é você. <a href="#/onboarding">Mudar o ramo</a>.</p>
        ${p.segment_key && p.segment_key !== 'outro' ? html`<button type="button" class="btn btn-secondary btn-sm" data-defaults>${icon('list', 14)} Usar as sugestões do ramo</button>` : ''}
        <p class="small muted">O objetivo é ordenar os bairros de uma cidade pelos tipos de estabelecimento que você escolher a seguir.</p>`;
    }
    if (s.step === 1 || s.step === 2) {
      const dir = s.step === 1 ? 'attract' : 'repel';
      const other = dir === 'attract' ? 'repel' : 'attract';
      const mine = of(dir).map((c) => c.business_type_key);
      const theirs = of(other).map((c) => c.business_type_key);
      return html`<h2>${s.step === 1 ? '02 · Quero perto' : '03 · Não quero perto'}</h2>
        <p class="ob-count small" aria-live="polite"><strong>${mine.length}</strong> de ${MAX} selecionados</p>
        <div class="chips">${types.map((t) => {
          const on = mine.includes(t.key), blocked = theirs.includes(t.key), full = !on && mine.length >= MAX;
          return html`<button type="button" class="chip" aria-pressed="${String(on)}" data-toggle="${dir}" data-value="${t.key}" ${blocked || full ? 'disabled' : ''}
            title="${blocked ? 'Já está na outra lista' : t.precision === 'approx' ? t.note : ''}">${on ? icon('check', 14) : icon('plus', 14)} ${t.name}${t.precision === 'approx' ? ' (aprox.)' : ''}</button>`;
        })}</div>`;
    }
    if (s.step === 3)
      return html`<h2>04 · Pesos</h2>${s.list.length
        ? html`<ul class="cr-weights">${s.list.map((c, i) => html`<li><span>${typeOf(c.business_type_key)?.name} <span class="muted small">(${c.direction === 'attract' ? 'perto' : 'longe'})</span></span>
            <input type="range" min="1" max="5" step="1" value="${c.weight}" data-weight="${i}" aria-label="Peso de ${typeOf(c.business_type_key)?.name}" />
            <output class="tabular" data-weight-out="${i}">${c.weight}</output></li>`)}</ul>`
        : html`<p class="ov-empty">Escolha pelo menos um tipo nos passos 02 ou 03.</p>`}`;
    return html`<h2>05 · Resumo</h2>
      ${['attract', 'repel'].map((d) => html`<h3 class="small">${d === 'attract' ? 'Quero perto' : 'Não quero perto'}</h3>
        <p>${of(d).map((c) => `${typeOf(c.business_type_key)?.name} (peso ${c.weight})`).join(', ') || 'Nenhum'}</p>`)}
      <button type="button" class="btn btn-primary" data-save ${JSON.stringify(s.list) === s.saved ? 'disabled' : ''}>${icon('check', 16)} Salvar critérios</button>
      <p class="small" role="status">${s.msg}</p>`;
  }

  function paint() {
    const body = root.querySelector('[data-body]');
    if (!body) return;
    root.querySelectorAll('[data-step]').forEach((b) => b.setAttribute('aria-current', String(Number(b.dataset.step) === s.step)));
    mount(body, html`${stepBody()}<div class="cr-nav">
      <button type="button" class="btn btn-ghost btn-sm" data-move="-1" ${s.step === 0 ? 'disabled' : ''}>Voltar</button>
      ${s.step < 4 ? html`<button type="button" class="btn btn-secondary btn-sm" data-move="1">Continuar ${icon('chevron', 14)}</button>` : ''}</div>`);
    paintPreview();
  }

  function paintPreview() {
    const el = root.querySelector('[data-preview]');
    if (!el) return;
    if (!s.city) return mount(el, html`<p class="small muted">Abra uma cidade no explorador para ver aqui como os bairros dela ficam com estes critérios.</p>`);
    const r = s.preview;
    const ok = r?.status === 'ok';
    const stops = [1, 2, 3, 4, 5].map((i) => css(`--score-${i}`));
    const score = ok ? new Map(r.neighborhoods.map((n) => [n.id, n.score])) : new Map();
    mount(el, html`<p class="small muted">${s.city.name} – ${s.city.uf}, com o rascunho (ainda não salvo).</p>
      ${s.geo ? miniMap(s.geo, { fill: (id) => (score.has(id) ? scoreColor(score.get(id), stops) : null), label: `Bairros de ${s.city.name} pela nota do rascunho` }) : ''}
      ${!r ? skeleton('60px') : ok
        ? html`<ol class="cr-top">${r.neighborhoods.slice(0, 3).map((n) => html`<li><span class="tabular">${n.rank}</span> ${n.name} <strong class="tabular">${fmt.dec(n.score)}</strong></li>`)}</ol>`
        : html`<p class="small muted">${r.message}</p>`}`);
  }

  const refreshPreview = debounce(async () => {
    if (!s.city) return;
    s.preview = null;
    paintPreview();
    s.preview = await post(`/api/cities/${s.city.ibge}/rank`, { criteria: s.list }).catch((e) => ({ status: 'error', message: e.message }));
    paintPreview();
  }, 400);

  root.addEventListener('page:ready', () => (paint(), refreshPreview()));
  document.documentElement.addEventListener('themechange', paintPreview);
  root.addEventListener('input', (e) => {
    const i = e.target.dataset.weight;
    if (i === undefined) return;
    s.list[i].weight = Number(e.target.value);
    root.querySelector(`[data-weight-out="${i}"]`).textContent = e.target.value;
    refreshPreview();
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-step], [data-move], [data-toggle], [data-defaults], [data-save]');
    if (!b || b.disabled) return;
    if (b.dataset.step) s.step = Number(b.dataset.step);
    else if (b.dataset.move) s.step = Math.max(0, Math.min(4, s.step + Number(b.dataset.move)));
    else if (b.dataset.toggle) {
      const k = b.dataset.value, i = s.list.findIndex((c) => c.business_type_key === k);
      if (i >= 0) s.list.splice(i, 1);
      else s.list.push({ business_type_key: k, direction: b.dataset.toggle, weight: 3 });
      refreshPreview();
    } else if (b.dataset.defaults) {
      const d = await getCached(`/api/catalog/segments/${profile.profile.segment_key}/defaults`);
      s.list = d.map((x) => ({ business_type_key: x.business_type_key, direction: x.direction, weight: x.weight }));
      refreshPreview();
    } else if (b.dataset.save) {
      try {
        await put('/api/profile/criteria', { criteria: s.list });
        s.saved = JSON.stringify(s.list);
        s.msg = 'Critérios salvos. O explorador já usa estes critérios.';
        window.dispatchEvent(new CustomEvent('criteria:saved', { detail: s.list }));
      } catch (err) {
        s.msg = err.message;
      }
    }
    paint();
  });
  return () => {
    cleanup();
    document.documentElement.removeEventListener('themechange', paintPreview);
  };
}
