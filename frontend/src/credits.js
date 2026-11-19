// Créditos no navegador: só mostra e confirma. Quem decide e cobra é o servidor (backend/app/credits.py);
// se o estado local estiver velho, o servidor responde 402 e a tela mostra a mensagem dele.
import { ApiError, get, post } from './api.js';
import { confirmDialog } from './components/dialog.js';
import { spendText } from './lib.js';
import { countUp } from './motion.js';

let current = null;
const listeners = new Set();

function set(state) {
  current = state;
  listeners.forEach((fn) => fn(state));
  return state;
}

export const onCredits = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const creditsState = () => current;

export async function loadCredits(force = false) {
  if (current && !force) return current;
  return set(await get('/api/credits'));
}

// Saldo ao vivo: todo [data-credit-balance] (barra, Visão geral, Análises, conta) conta até o valor novo.
onCredits((st) => {
  for (const el of document.querySelectorAll('[data-credit-balance]')) countUp(el.querySelector('[data-count]') || el, st.balance);
});

// Compra confirmada em outra aba (checkout): BroadcastChannel, com o evento de storage como reserva.
const CHANNEL = 'credits';
const refresh = () => loadCredits(true).catch(() => {});
try {
  new BroadcastChannel(CHANNEL).onmessage = refresh;
} catch {
  /* navegador sem BroadcastChannel: fica o storage */
}
addEventListener('storage', (e) => e.key === 'credits-updated' && refresh());

export function announceCredits(state) {
  if (state) set(state);
  try {
    const bc = new BroadcastChannel(CHANNEL);
    bc.postMessage('updated');
    bc.close();
  } catch {
    /* sem BroadcastChannel */
  }
  try {
    localStorage.setItem('credits-updated', String(Date.now()));
  } catch {
    /* armazenamento bloqueado: a tela de compra também consulta o servidor */
  }
}

export const scopeKey = (scope) => (scope.kind === 'uf' ? scope.uf : scope.kind === 'region' ? `R${scope.id}` : 'BR');
export const cityActive = (ibge) => Boolean(current?.cities.some((c) => c.ibge === ibge && c.active));
export const searchActive = (key) => Boolean(current?.searches.some((s) => s.scope_key === key && s.active));

const NO_CREDITS = (cost, balance) =>
  `Esta análise usa ${cost === 1 ? '1 crédito' : `${cost} créditos`} e você tem ${balance}. Compre mais créditos em Minha conta para continuar.`;

async function spend({ active, cost, title, url, body }) {
  if (active) return true; // já liberada e no prazo: o servidor também não cobra
  const st = current;
  if (st.balance < cost) {
    await confirmDialog({ title: 'Sem créditos', message: NO_CREDITS(cost, st.balance), alertOnly: true });
    return false;
  }
  if (!(await confirmDialog({ title, message: spendText(cost, st.balance), confirmLabel: 'Usar crédito' }))) return false;
  try {
    const r = await post(url, body);
    set(r.state);
    return true;
  } catch (e) {
    if (!(e instanceof ApiError) || ![402, 409].includes(e.status)) throw e;
    await confirmDialog({ title: e.code === 'no_credits' ? 'Sem créditos' : 'Não foi possível abrir', message: e.message, alertOnly: true });
    await loadCredits(true);
    return false;
  }
}

export async function ensureCity(city) {
  const st = await loadCredits();
  return spend({ active: cityActive(city.id), cost: st.rules.city_unlock_cost, title: `Analisar ${city.name}?`, url: `/api/credits/cities/${city.id}` });
}

export async function ensureSearch(scope) {
  const st = await loadCredits();
  const where = scope.kind === 'uf' ? { uf: scope.uf } : scope.kind === 'region' ? { region_id: scope.id } : {};
  return spend({
    active: searchActive(scopeKey(scope)),
    cost: st.rules.city_search_cost,
    title: `Buscar cidades em ${scope.label}?`,
    url: '/api/credits/searches',
    body: where,
  });
}
