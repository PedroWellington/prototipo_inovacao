// Checkout do pedido (nova aba aberta por "Comprar"). Modo demo: pagamento SIMULADO, só um botão; nenhum dado de
// pagamento é pedido. Ao confirmar, o servidor credita (app/billing.confirm_demo) e a aba de origem é avisada
// (credits.announceCredits). Com um provedor real, a checkout_url passa a ser a do provedor e esta tela sai do fluxo.
import { ApiError, get, post } from '../api.js';
import { announceCredits } from '../credits.js';
import { fmt, html, mount } from '../html.js';
import { icon, logo } from '../icons.js';
import { themeButton } from '../components/topbar.js';
import { money } from './billing.js';
import '../styles/components.css';

const view = (body) =>
  html`<div class="page checkout-page"><header class="page-header"><span class="logo-link">${logo()}</span><span class="header-actions">${themeButton()}</span></header>
    <p class="checkout-sim" role="note">${icon('info', 18)}<span><strong>Pagamento simulado.</strong> Nenhuma cobrança real será feita.</span></p>
    <h1>Confirmar pagamento</h1>${body}</div>`;

const summary = (o) => html`<dl class="buy-dl checkout-dl">
    <dt>Pedido</dt><dd class="tabular">${o.number}</dd>
    <dt>Quantidade</dt><dd class="tabular">${o.quantity} ${o.quantity === 1 ? 'crédito' : 'créditos'}</dd>
    <dt>Valor total</dt><dd class="tabular checkout-total">${money(o.amount_cents)}</dd>
  </dl>`;

export async function render(root) {
  const id = location.hash.split('?')[0].split('/')[2] || '';
  let o;
  try {
    o = await get(`/api/billing/orders/${encodeURIComponent(id)}`);
  } catch (e) {
    mount(root, view(html`<p class="alert alert-error" role="alert">${e.message || 'Pedido não encontrado.'}</p><a class="btn btn-secondary" href="#/creditos">Voltar à compra</a>`));
    return;
  }

  const done = (o, balance) => {
    mount(root, view(html`${summary(o)}
      <p class="buy-ok" role="status">${icon('check', 18)} Pagamento simulado confirmado. ${o.quantity === 1 ? '1 crédito foi adicionado' : `${o.quantity} créditos foram adicionados`} ao seu saldo${balance == null ? '' : ` (agora ${fmt.int(balance)})`}.</p>
      <p class="small muted">O saldo da outra aba já foi atualizado. Esta aba pode ser fechada.</p>
      <button type="button" class="btn btn-primary" data-close>Fechar</button>`));
    root.querySelector('[data-close]').focus();
  };

  if (o.status === 'paid') return done(o, null);
  if (o.status !== 'pending') {
    mount(root, view(html`${summary(o)}<p class="alert alert-warning" role="note">${icon('info', 16)}<span>Este pedido expirou ou foi cancelado. Volte à tela de compra e faça um novo.</span></p>
      <a class="btn btn-secondary" href="#/creditos">Voltar à compra</a>`));
    return;
  }
  mount(root, view(html`${summary(o)}
    <p class="small muted">Não pedimos cartão, CPF nem nenhum dado de pagamento. O botão abaixo só simula a confirmação.</p>
    <button type="button" class="btn btn-primary btn-block" data-confirm>${icon('check', 16)} Confirmar pagamento (simulado)</button>
    <div class="alert alert-error" role="alert" aria-live="assertive" data-error></div>`));

  const ac = new AbortController();
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) {
      window.close();
      // Aba não aberta por script: o navegador não deixa fechar; volta ao app.
      setTimeout(() => (location.hash = '#/creditos'), 200);
      return;
    }
    const b = e.target.closest('[data-confirm]');
    if (!b || b.hasAttribute('aria-busy')) return;
    b.setAttribute('aria-busy', 'true');
    try {
      const r = await post(`/api/billing/orders/${o.id}/confirm`);
      announceCredits();
      done(r.order, r.balance);
    } catch (err) {
      root.querySelector('[data-error]').textContent = err instanceof ApiError ? err.message : 'Não foi possível confirmar.';
      b.removeAttribute('aria-busy');
    }
  }, { signal: ac.signal });
  return () => ac.abort();
}
