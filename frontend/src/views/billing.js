// Comprar mais créditos: ponto único do frontend para o pagamento. Hoje PAYMENTS_ENABLED=false no servidor:
// a tela mostra os planos e registra o interesse (e-mail da conta). Ao plugar um gateway (Stripe ou Mercado
// Pago), só o ramo "enabled" de buy() muda: POST /api/billing/checkout devolve a URL do pagamento.
import { ApiError, get, post } from '../api.js';
import { confirmDialog } from '../components/dialog.js';
import { topbar, wireTopbar } from '../components/topbar.js';
import { brl } from '../lib.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

export async function render(root) {
  const [user, data] = await Promise.all([loadUser(), get('/api/billing/packages')]);
  const r = data.rules;
  mount(
    root,
    html`<div class="app-shell">${topbar({ active: null, user })}<div class="page page-wide">
      <a class="btn btn-ghost btn-sm" href="#/conta">${icon('back', 16)} Minha conta</a>
      <h1>Comprar mais créditos</h1>
      <p class="muted">1 crédito = 1 cidade por ${r.city_unlock_days} dias; reabrir dentro do prazo não gasta outro.
        O ranking de cidades de um alcance usa ${r.city_search_cost} crédito por busca. Os créditos não dão direito a nenhum resultado: só abrem os dados.</p>
      ${data.payments_enabled ? '' : html`<p class="alert alert-warning" role="note">${icon('info', 16)}<span>Pagamento ainda não disponível. Escolha um plano e deixe seu e-mail: avisamos quando abrir.</span></p>`}
      <div class="plans-grid">
        ${data.packages.map(
          (p) => html`<article class="card plan-card">
            <h2>${p.name}</h2>
            <p class="plan-price">${p.price_brl == null ? html`<b>Em breve</b>` : html`<b>${brl(p.price_brl)}</b> <span class="small muted">por ${p.period}</span>`}</p>
            <p><strong class="tabular">${fmt.int(p.credits)} créditos</strong> por ${p.period}</p>
            <p class="small muted">${p.note || ''}</p>
            <button type="button" class="btn btn-primary" data-buy="${p.key}">${icon('coin', 16)} Comprar</button>
          </article>`,
        )}
      </div>
      <p class="small muted">Valores previstos, sujeitos a alteração. Sem renovação automática nesta etapa.</p>
      <div class="alert alert-error" role="alert" aria-live="assertive" data-error></div>
    </div></div>`,
  );

  const ac = new AbortController();
  wireTopbar(root, { signal: ac.signal });

  async function buy(key, btn) {
    const name = data.packages.find((p) => p.key === key)?.name || key;
    if (!data.payments_enabled) {
      const ok = await confirmDialog({
        title: 'Pagamento ainda não disponível',
        message: `Deixe seu e-mail para avisarmos quando o plano ${name} abrir: ${user.email}`,
        confirmLabel: 'Avisar neste e-mail',
      });
      if (!ok) return;
      btn.setAttribute('aria-busy', 'true');
      try {
        await post('/api/billing/interest', { package: key });
        await confirmDialog({ title: 'Anotado', message: `Avisaremos em ${user.email} quando o pagamento estiver disponível.`, alertOnly: true });
      } catch (e) {
        root.querySelector('[data-error]').textContent = e.message;
      } finally {
        btn.removeAttribute('aria-busy');
      }
      return;
    }
    // Gateway ligado: o servidor cria a sessão de pagamento e devolve a URL (billing/ no backend).
    btn.setAttribute('aria-busy', 'true');
    try {
      const r = await post('/api/billing/checkout', { package: key });
      location.assign(r.url);
    } catch (e) {
      root.querySelector('[data-error]').textContent = e instanceof ApiError ? e.message : 'Não foi possível iniciar o pagamento.';
      btn.removeAttribute('aria-busy');
    }
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-buy]');
    if (b) buy(b.dataset.buy, b);
  }, { signal: ac.signal });
  return () => ac.abort();
}
