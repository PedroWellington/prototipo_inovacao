import { del, get, getCached, put } from '../api.js';
import { avatar } from '../components/account.js';
import '../styles/components.css';
import { showError } from '../forms.js';
import { html, mount } from '../html.js';
import { aboutLink, icon, logo } from '../icons.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import { initials } from '../lib.js';
import { REVENUE } from '../lib.js';

const MAX = 3;
const STEPS = 6;
const DEFAULT_WEIGHT = 3;

export async function render(root) {
  const [segments, types, current] = await Promise.all([
    getCached('/api/catalog/segments'),
    getCached('/api/catalog/business-types'),
    get('/api/profile'),
  ]);
  const typeName = Object.fromEntries(types.map((t) => [t.key, t.name]));
  const p = current.profile;
  const s = {
    step: p?.onboarding_completed_at ? STEPS : 1, // quem já fez o onboarding começa pelo resumo
    returnToSummary: Boolean(p?.onboarding_completed_at),
    company_name: p?.company_name || '',
    logo_url: p?.logo_url || null,
    logoError: '',
    logoBusy: false,
    segment_key: p?.segment_key || '',
    segment_other_text: p?.segment_other_text || '',
    revenue_band: p?.revenue_band || '',
    has_hq: p ? p.has_hq : null,
    hq_uf: p?.hq_uf || '',
    hq_municipality_ibge: p?.hq_municipality_ibge || '',
    hq_neighborhood_text: p?.hq_neighborhood_text || '',
    attract: current.criteria.filter((c) => c.direction === 'attract').map((c) => c.business_type_key),
    repel: current.criteria.filter((c) => c.direction === 'repel').map((c) => c.business_type_key),
    weights: Object.fromEntries(current.criteria.map((c) => [c.business_type_key, c.weight])),
    prefilledFor: p?.segment_key || null,
    states: null,
    cities: {},
  };

  const valid = {
    1: () => s.segment_key && (s.segment_key !== 'outro' || s.segment_other_text.trim()),
    2: () => s.revenue_band,
    3: () => s.has_hq === false || (s.has_hq === true && s.hq_uf && s.hq_municipality_ibge),
    4: () => true,
    5: () => true,
    6: () => true,
  };

  async function prefillFromSegment() {
    if (!s.segment_key || s.prefilledFor === s.segment_key) return;
    const defaults = await getCached(`/api/catalog/segments/${s.segment_key}/defaults`);
    s.attract = defaults.filter((d) => d.direction === 'attract').map((d) => d.business_type_key);
    s.repel = defaults.filter((d) => d.direction === 'repel').map((d) => d.business_type_key);
    for (const d of defaults) s.weights[d.business_type_key] = d.weight;
    s.prefilledFor = s.segment_key;
  }

  async function loadStates() {
    s.states ||= await get('/api/geo/states');
  }
  async function loadCities(uf) {
    if (uf && !s.cities[uf]) s.cities[uf] = await get(`/api/geo/municipalities?uf=${uf}`);
  }

  // ---------- Telas ----------
  const tiles = (name, options, selected) =>
    html`<div class="tiles" role="radiogroup">
      ${options.map(
        ([value, label]) =>
          html`<button type="button" class="tile" role="radio" aria-checked="${String(selected === value)}" data-set="${name}" data-value="${value}">
            <span class="tile-dot" aria-hidden="true"></span>${label}
          </button>`,
      )}
    </div>`;

  function pickerStep(direction) {
    const list = s[direction];
    const other = direction === 'attract' ? s.repel : s.attract;
    const otherLabel = direction === 'attract' ? 'não quero perto' : 'quero perto';
    return html`<p class="ob-count small" aria-live="polite"><strong>${list.length}</strong> de ${MAX} selecionados</p>
      <div class="chips">
        ${types.map((t) => {
          const on = list.includes(t.key);
          const blocked = other.includes(t.key);
          const full = !on && list.length >= MAX;
          return html`<button type="button" class="chip" aria-pressed="${String(on)}" data-toggle="${direction}" data-value="${t.key}"
            ${blocked || full ? 'disabled' : ''} title="${blocked ? `Já está em "${otherLabel}"` : t.precision === 'approx' ? t.note : ''}">
            ${on ? icon('check', 14) : icon('plus', 14)} ${t.name}${t.precision === 'approx' ? ' (aprox.)' : ''}
          </button>`;
        })}
      </div>
      ${list.some((k) => types.find((t) => t.key === k)?.precision === 'approx')
        ? html`<p class="alert alert-warning ob-note">${icon('info', 16)}<span>Loja de suplementos é aproximada pelo CNAE; não distingue suplementos de outros produtos.</span></p>`
        : ''}`;
  }

  const summaryValue = {
    1: () => (s.segment_key === 'outro' ? `Outro: ${s.segment_other_text}` : segments.find((x) => x.key === s.segment_key)?.name),
    2: () => REVENUE.find(([v]) => v === s.revenue_band)?.[1],
    3: () => {
      if (!s.has_hq) return 'Ainda não tenho sede';
      const city = (s.cities[s.hq_uf] || []).find((c) => c.id === Number(s.hq_municipality_ibge));
      return [s.hq_neighborhood_text, city?.name, s.hq_uf].filter(Boolean).join(', ');
    },
    4: () => s.attract.map((k) => typeName[k]).join(', ') || 'Nenhum',
    5: () => s.repel.map((k) => typeName[k]).join(', ') || 'Nenhum',
  };

  // Nome e logo da empresa (opcionais). A imagem é validada e recodificada no servidor; aqui só um aviso rápido.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
  function identity() {
    return html`<section class="identity" aria-label="Sua empresa">
      <div class="identity-avatar" data-avatar>${avatar({ logo_url: s.logo_url, company_name: s.company_name }, null, 72)}</div>
      <div class="identity-fields">
        <div class="field"><label class="label" for="company">Nome da empresa <span class="muted">(opcional)</span></label>
          <input class="input" id="company" data-input="company_name" value="${s.company_name}" maxlength="80" autocomplete="organization" /></div>
        <div class="identity-actions">
          <label class="btn btn-secondary btn-sm file-btn" ${s.logoBusy ? 'aria-busy="true"' : ''}>${icon('image', 15)} ${s.logo_url ? 'Trocar foto ou logo' : 'Enviar foto ou logo'}
            <input type="file" class="sr-only" accept="${ACCEPT.join(',')}" data-logo /></label>
          ${s.logo_url ? html`<button type="button" class="btn btn-ghost btn-sm" data-remove-logo>Remover</button>` : ''}
        </div>
        <p class="small muted">PNG, JPG ou WebP, até 2 MB. Opcional: sem imagem, mostramos as iniciais (${initials(s.company_name)}).</p>
        ${s.logoError ? html`<p class="small field-error" role="alert">${s.logoError}</p>` : ''}
      </div>
    </section>`;
  }

  async function uploadLogo(file) {
    s.logoError = '';
    if (!ACCEPT.includes(file.type)) s.logoError = 'Envie uma imagem PNG, JPG ou WebP (SVG não é aceito).';
    else if (file.size > 2 * 1024 * 1024) s.logoError = 'A imagem pode ter no máximo 2 MB.';
    if (s.logoError) return draw();
    s.logoBusy = true;
    draw();
    try {
      s.logo_url = (await put('/api/profile/logo', file)).profile.logo_url;
    } catch (e) {
      s.logoError = e.message; // a palavra final é do servidor (conteúdo real do arquivo)
    }
    s.logoBusy = false;
    draw();
  }

  const SCREENS = {
    1: () => ({
      title: 'Qual é o ramo da sua empresa?',
      help: 'Usamos o ramo para sugerir critérios iniciais. Você pode mudar tudo depois.',
      body: html`${tiles('segment_key', segments.map((x) => [x.key, x.name]), s.segment_key)}
        ${s.segment_key === 'outro'
          ? html`<div class="field ob-extra"><label class="label" for="other">Qual ramo?</label>
              <input class="input" id="other" data-input="segment_other_text" value="${s.segment_other_text}" maxlength="120" autofocus /></div>`
          : ''}`,
    }),
    2: () => ({
      title: 'Qual é o faturamento anual aproximado?',
      help: 'Esta informação fica só no seu perfil. Ela não entra no cálculo dos bairros.',
      body: tiles('revenue_band', REVENUE, s.revenue_band),
    }),
    3: () => ({
      title: 'Você já tem sede?',
      help: 'Se tiver, abrimos o mapa já no seu estado e na sua cidade. A sede não entra no cálculo.',
      body: html`${tiles('has_hq', [['true', 'Sim'], ['false', 'Ainda não tenho']], s.has_hq === null ? '' : String(s.has_hq))}
        ${s.has_hq
          ? html`<div class="ob-extra ob-grid">
              <div class="field"><label class="label" for="uf">Estado</label>
                <select class="select" id="uf" data-input="hq_uf">
                  <option value="">Selecione</option>
                  ${(s.states || []).map((x) => html`<option value="${x.uf}" ${x.uf === s.hq_uf ? 'selected' : ''}>${x.name}</option>`)}
                </select></div>
              <div class="field"><label class="label" for="city">Cidade</label>
                <select class="select" id="city" data-input="hq_municipality_ibge" ${s.hq_uf ? '' : 'disabled'}>
                  <option value="">${s.hq_uf ? 'Selecione' : 'Escolha o estado primeiro'}</option>
                  ${(s.cities[s.hq_uf] || []).map((c) => html`<option value="${c.id}" ${c.id === Number(s.hq_municipality_ibge) ? 'selected' : ''}>${c.name}</option>`)}
                </select></div>
              <div class="field ob-span"><label class="label" for="hood">Bairro <span class="muted">(opcional)</span></label>
                <input class="input" id="hood" data-input="hq_neighborhood_text" value="${s.hq_neighborhood_text}" maxlength="120" /></div>
            </div>`
          : ''}`,
    }),
    4: () => ({
      title: 'O que você quer perto do seu negócio?',
      help: `Escolha até ${MAX} tipos de estabelecimento. Sugerimos alguns pelo seu ramo; ajuste à vontade.`,
      body: pickerStep('attract'),
      skippable: true,
    }),
    5: () => ({
      title: 'O que você NÃO quer perto?',
      help: `Escolha até ${MAX} tipos. Em geral, concorrentes diretos.`,
      body: pickerStep('repel'),
      skippable: true,
    }),
    6: () => ({
      title: 'Confira suas respostas',
      help: 'Todos os critérios começam com o mesmo peso. No mapa, você ajusta a importância de cada um.',
      body: html`${identity()}<ul class="summary">
          ${[1, 2, 3, 4, 5].map(
            (n) => html`<li>
              <div><span class="summary-label">${['Ramo', 'Faturamento anual', 'Sede', 'Quero perto', 'Não quero perto'][n - 1]}</span>
              <span class="summary-value">${summaryValue[n]()}</span></div>
              <button type="button" class="btn btn-ghost btn-sm" data-edit="${n}">${icon('edit', 15)} Editar</button>
            </li>`,
          )}
        </ul>
        ${s.attract.length + s.repel.length === 0
          ? html`<p class="alert alert-warning ob-note">${icon('info', 16)}<span>Sem critérios, o mapa não consegue ordenar os bairros. Você pode adicioná-los depois, no próprio mapa.</span></p>`
          : ''}`,
      final: true,
    }),
  };

  // ---------- Render ----------
  function draw() {
    const scr = SCREENS[s.step]();
    const focusKey = document.activeElement?.dataset?.value ?? document.activeElement?.id;
    mount(
      root,
      html`<div class="ob">
        <header class="ob-top">
          <a href="#/home" class="logo-link" aria-label="Início">${logo()}</a>
          <div class="ob-progress" role="progressbar" aria-label="Progresso" aria-valuemin="1" aria-valuemax="${STEPS}" aria-valuenow="${s.step}">
            <span style="transform: scaleX(${s.step / STEPS})"></span>
          </div>
          <span class="small muted tabular">${s.step} de ${STEPS}</span>
        </header>
        <form class="ob-card" novalidate>
          <h1 tabindex="-1">${scr.title}</h1>
          <p class="muted">${scr.help}</p>
          <div class="ob-body">${scr.body}</div>
          <div class="alert alert-error" role="alert" aria-live="assertive" data-error></div>
          <div class="ob-actions">
            ${s.step > 1 ? html`<button type="button" class="btn btn-ghost" data-back>${icon('back', 16)} Voltar</button>` : html`<span></span>`}
            <div class="ob-actions-right">
              ${scr.skippable ? html`<button type="button" class="btn btn-secondary" data-skip>Pular</button>` : ''}
              <button type="submit" class="btn btn-primary" ${valid[s.step]() ? '' : 'disabled'}>
                ${scr.final ? html`Salvar e continuar ${icon('chevron', 16)}` : s.returnToSummary ? 'Voltar ao resumo' : 'Continuar'}
              </button>
            </div>
          </div>
        </form>
        <p class="about-row">${aboutLink()}</p>
      </div>`,
    );
    // Mantém o foco onde estava (troca de chip/opção re-renderiza a tela).
    if (focusKey) (root.querySelector(`[data-value="${CSS.escape(focusKey)}"]`) || root.querySelector('#' + CSS.escape(focusKey)))?.focus();
  }

  async function goTo(step) {
    s.step = step;
    if (step === 3 && s.has_hq) await Promise.all([loadStates(), loadCities(s.hq_uf)]);
    if (step === 4) await prefillFromSegment();
    if (step === STEPS) {
      if (s.has_hq) await loadCities(s.hq_uf);
      import('./explorer.js'); // pré-carrega o mapa enquanto o usuário confere o resumo
    }
    draw();
    root.querySelector('h1')?.focus();
  }

  async function submit() {
    const criteria = [
      ...s.attract.map((k) => ({ business_type_key: k, direction: 'attract', weight: s.weights[k] || DEFAULT_WEIGHT })),
      ...s.repel.map((k) => ({ business_type_key: k, direction: 'repel', weight: s.weights[k] || DEFAULT_WEIGHT })),
    ];
    await put('/api/profile', {
      company_name: s.company_name.trim() || null,
      segment_key: s.segment_key,
      segment_other_text: s.segment_key === 'outro' ? s.segment_other_text.trim() : null,
      revenue_band: s.revenue_band,
      has_hq: s.has_hq,
      hq_uf: s.has_hq ? s.hq_uf : null,
      hq_municipality_ibge: s.has_hq ? Number(s.hq_municipality_ibge) : null,
      hq_neighborhood_text: s.has_hq ? s.hq_neighborhood_text.trim() || null : null,
      criteria,
    });
    await loadUser(true);
    go('/home');
  }

  // ---------- Eventos (delegados; removidos ao sair da tela) ----------
  const ac = new AbortController();
  const opts = { signal: ac.signal };
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.set) {
      const { set, value } = t.dataset;
      s[set] = set === 'has_hq' ? value === 'true' : value;
      if (set === 'has_hq' && s.has_hq) await loadStates();
      draw();
    } else if (t.dataset.toggle) {
      const list = s[t.dataset.toggle];
      const i = list.indexOf(t.dataset.value);
      if (i >= 0) list.splice(i, 1);
      else if (list.length < MAX) list.push(t.dataset.value);
      draw();
    } else if (t.dataset.back !== undefined) {
      goTo(s.returnToSummary ? STEPS : s.step - 1);
    } else if (t.dataset.skip !== undefined) {
      s[s.step === 4 ? 'attract' : 'repel'] = [];
      goTo(s.returnToSummary ? STEPS : s.step + 1);
    } else if (t.dataset.removeLogo !== undefined) {
      s.logo_url = (await del('/api/profile/logo')).profile.logo_url;
      draw();
    } else if (t.dataset.edit) {
      s.returnToSummary = true;
      goTo(Number(t.dataset.edit));
    }
  }, opts);

  root.addEventListener('input', (e) => {
    const key = e.target.dataset.input;
    if (!key) return;
    s[key] = e.target.value;
    const btn = root.querySelector('button[type=submit]');
    if (btn) btn.disabled = !valid[s.step]();
  }, opts);

  root.addEventListener('change', async (e) => {
    if (e.target.dataset.logo !== undefined && e.target.files[0]) return uploadLogo(e.target.files[0]);
    if (e.target.dataset.input === 'hq_uf') {
      s.hq_municipality_ibge = '';
      await loadCities(s.hq_uf);
      draw();
    }
  }, opts);

  root.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!valid[s.step]()) return;
    const btn = root.querySelector('button[type=submit]');
    if (s.step < STEPS) return goTo(s.returnToSummary ? STEPS : s.step + 1);
    btn.setAttribute('aria-busy', 'true');
    try {
      await submit();
    } catch (err) {
      btn.removeAttribute('aria-busy');
      showError(root.querySelector('[data-error]'), err.message);
    }
  }, opts);

  if (s.step === STEPS) await goTo(STEPS);
  else draw();
  return () => ac.abort();
}
