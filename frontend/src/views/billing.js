// Comprar créditos: ponto único do frontend para o pagamento. O servidor decide tudo (app/billing): preço, limites,
// valor do pedido e a confirmação. Modo off: "em breve" + registro de interesse. Modo demo: pedido real com pagamento
// SIMULADO numa nova aba (#/checkout/<id>); ao confirmar, o saldo desta aba atualiza sozinho (credits.js).
// Pagamento real depois: o servidor devolve outra checkout_url (do provedor); esta tela não muda.
import { ApiError, get, post } from '../api.js';
import { confirmDialog } from '../components/dialog.js';
import { appPage, legalFooter, pageHead } from '../components/page.js';
import { loadCredits } from '../credits.js';
import { fmt, html, mount } from '../html.js';
import { icon } from '../icons.js';
import { loadUser } from '../session.js';
import { skeleton } from '../motion.js';
import '../styles/components.css';

const entered = { done: false };
const PACKS = [5, 10, 25, 50];
export const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

export async function render(root) {
  const user = await loadUser();
  let q = null;
  let qty = 10;
  let poll = 0;
  const cleanup = appPage(root, {
    active: null,
    user,
    entered,
    skeleton: () => html`${pageHead({ eyebrow: 'Créditos', title: 'Comprar créditos', meta: 'Carregando…' })}
      <div class="buy-grid"><section class="ov-block" style="min-height:320px">${skeleton('16px', '40%')}</section><section class="ov-block" style="min-height:320px"></section></div>`,
    load: () => Promise.all([get('/api/billing/quote'), loadCredits(true)]),
    body: ([quote, credits]) => {
      q = quote;
      qty = Math.min(qty, q.max_per_order);
      const demo = q.mode === 'demo';
      const r = q.rules;
      return html`
        ${pageHead({
          eyebrow: 'Créditos',
          title: 'Comprar créditos',
          meta: `1 crédito = 1 cidade por ${r.city_unlock_days} dias · o ranking de cidades usa ${r.city_search_cost} por busca`,
        })}
        <p class="buy-balance" data-cx>Saldo atual <strong data-credit-balance class="tabular">${fmt.int(credits.balance)}</strong> ${credits.balance === 1 ? 'crédito' : 'créditos'}</p>
        ${demo
          ? html`<p class="alert alert-warning buy-demo" role="note" data-cx>${icon('info', 16)}<span><strong>Modo de demonstração.</strong> O pagamento é simulado: nenhuma cobrança real é feita e nenhum dado de pagamento é pedido.</span></p>`
          : html`<p class="alert alert-warning" role="note" data-cx>${icon('info', 16)}<span><strong>Compra de créditos em breve.</strong> Escolha a quantidade e deixe seu e-mail: avisamos quando abrir.</span></p>`}
        <div class="buy-grid" data-cx>
          <section class="ov-block buy-qty" aria-labelledby="buyQ">
            <div class="ov-block-header"><h2 id="buyQ">Quantos créditos?</h2><span class="small muted">de 1 a ${q.max_per_order} por pedido</span></div>
            <div class="buy-stepper">
              <button type="button" class="btn btn-secondary buy-step" data-step="-1" aria-label="Um crédito a menos">−</button>
              <label class="sr-only" for="buyQty">Quantidade de créditos</label>
              <input class="buy-input tabular" id="buyQty" type="number" inputmode="numeric" min="1" max="${q.max_per_order}" step="1" value="${qty}" />
              <button type="button" class="btn btn-secondary buy-step" data-step="1" aria-label="Um crédito a mais">+</button>
            </div>
            <div class="buy-packs" role="group" aria-label="Atalhos de quantidade">
              ${PACKS.filter((n) => n <= q.max_per_order).map((n) => html`<button type="button" class="chip" data-pack="${n}" aria-pressed="${n === qty}">${n} créditos</button>`)}
            </div>
            <p class="small muted">Os créditos não dão direito a nenhum resultado: só abrem os dados de cidades e buscas.</p>
          </section>
          <section class="ov-block buy-sum" aria-labelledby="buyS">
            <div class="ov-block-header"><h2 id="buyS">Resumo</h2></div>
            <dl class="buy-dl">
              <dt>Preço por crédito</dt><dd class="tabular">${money(q.unit_price_cents)}</dd>
              <dt>Quantidade</dt><dd class="tabular" data-sum-qty>${qty}</dd>
            </dl>
            <p class="metric-label">Total</p>
            <p class="buy-total tabular" data-total aria-live="polite">${money(qty * q.unit_price_cents)}</p>
            <p class="small buy-note">Valor de demonstração, a definir.</p>
            <button type="button" class="btn btn-primary btn-block" data-buy>${icon('coin', 16)} ${demo ? 'Comprar' : 'Avisar-me quando abrir'}</button>
            <div class="buy-status" data-status aria-live="polite"></div>
            <div class="alert alert-error" role="alert" aria-live="assertive" data-error></div>
          </section>
        </div>
        ${legalFooter()}`;
    },
  });

  const $ = (s) => root.querySelector(s);
  function setQty(v) {
    if (!q) return;
    qty = Math.max(1, Math.min(q.max_per_order, Math.round(Number(v) || 1)));
    $('#buyQty').value = qty;
    $('[data-sum-qty]').textContent = qty;
    $('[data-total]').textContent = money(qty * q.unit_price_cents);
    for (const b of root.querySelectorAll('[data-pack]')) b.setAttribute('aria-pressed', String(Number(b.dataset.pack) === qty));
  }

  const status = (h) => mount($('[data-status]'), h);
  const watch = (order) => {
    clearInterval(poll);
    // Reserva do BroadcastChannel: consulta curta ao servidor até o pedido sair de "pendente".
    poll = setInterval(async () => {
      try {
        const o = await get(`/api/billing/orders/${order.id}`);
        if (o.status === 'pending') return;
        clearInterval(poll);
        const st = await loadCredits(true);
        status(o.status === 'paid'
          ? html`<p class="buy-ok">${icon('check', 16)} Pronto: ${o.quantity} ${o.quantity === 1 ? 'crédito adicionado' : 'créditos adicionados'}. Saldo: ${fmt.int(st.balance)}.</p>`
          : html`<p class="small muted">O pedido ${o.number} expirou sem confirmação. Faça um novo quando quiser.</p>`);
      } catch {
        /* rede: tenta na próxima */
      }
    }, 3000);
  };

  async function buy(btn) {
    $('[data-error]').textContent = '';
    if (q.mode !== 'demo') {
      const ok = await confirmDialog({ title: 'Compra de créditos em breve', message: `Avisaremos em ${user.email} quando a compra de créditos abrir.`, confirmLabel: 'Avisar neste e-mail' });
      if (!ok) return;
      try {
        await post('/api/billing/interest', { quantity: qty });
        status(html`<p class="small muted">Anotado: avisaremos em ${user.email}.</p>`);
      } catch (e) {
        $('[data-error]').textContent = e.message;
      }
      return;
    }
    // A aba nasce no clique (não é bloqueada); o endereço do checkout chega depois que o servidor cria o pedido.
    const tab = window.open('', '_blank');
    btn.setAttribute('aria-busy', 'true');
    try {
      const o = await post('/api/billing/orders', { quantity: qty });
      if (tab) tab.location.href = o.checkout_url;
      status(html`<p>Pedido <strong class="tabular">${o.number}</strong>: ${tab ? 'confirme o pagamento simulado na nova aba.' : 'o navegador bloqueou a nova aba.'}
        <a class="ov-textlink" href="${o.checkout_url}" target="_blank" rel="opener" data-open-checkout>Abrir pagamento ${icon('chevron', 14)}</a></p>`);
      watch(o);
    } catch (e) {
      tab?.close();
      $('[data-error]').textContent = e instanceof ApiError ? e.message : 'Não foi possível criar o pedido.';
    } finally {
      btn.removeAttribute('aria-busy');
    }
  }

  const ac = new AbortController();
  root.addEventListener('click', (e) => {
    const s = e.target.closest('[data-step]');
    if (s) return setQty(qty + Number(s.dataset.step));
    const p = e.target.closest('[data-pack]');
    if (p) return setQty(p.dataset.pack);
    const b = e.target.closest('[data-buy]');
    if (b && !b.hasAttribute('aria-busy')) buy(b);
  }, { signal: ac.signal });
  // Total em tempo real enquanto digita (campo vazio espera o próximo dígito); fora do intervalo, volta ao limite.
  root.addEventListener('input', (e) => e.target.id === 'buyQty' && e.target.value !== '' && setQty(e.target.value), { signal: ac.signal });
  root.addEventListener('change', (e) => e.target.id === 'buyQty' && setQty(e.target.value), { signal: ac.signal });
  return () => {
    ac.abort();
    clearInterval(poll);
    cleanup();
  };
}
