// Assistente de IA flutuante: botão redondo no canto inferior direito e painel lateral (gaveta no celular).
// Montado uma vez no <body>, fora do roteador: a conversa sobrevive à troca de aba e nada é remontado.
// Só aparece logado e com a flag pública "assistant" (servidor com AI_ASSISTANT_ENABLED e chave). O navegador só
// fala com /api/assistente; quem fala com o Groq é o servidor. Atalho: Alt+A abre e fecha; Esc fecha.
import { ApiError, post } from '../api.js';
import { html, mount } from '../html.js';
import { icon } from '../icons.js';

const MAX = 600; // o mesmo AI_MAX_CHARS do servidor (o servidor confere de novo)
const s = { open: false, busy: false, turns: [], remaining: null, screen: {}, userId: null };
let el = null;

// Tela atual (cidade e bairro): o explorador e o detalhe do bairro avisam por evento; o servidor confere o acesso.
addEventListener('screen:context', (e) => (s.screen = e.detail || {}));

export function syncAssistant(user) {
  if (!user) return unmountAssistant();
  if (s.userId !== user.id) Object.assign(s, { turns: [], remaining: null, userId: user.id }); // outra conta: conversa nova
  if (!el) mountAssistant();
}

function unmountAssistant() {
  el?.remove();
  el = null;
  Object.assign(s, { open: false, turns: [], remaining: null, userId: null });
  document.documentElement.classList.remove('has-ai');
}

function mountAssistant() {
  el = document.createElement('div');
  el.className = 'ai';
  mount(
    el,
    html`<button type="button" class="ai-fab" aria-label="Assistente de IA" title="Assistente de IA" aria-keyshortcuts="Alt+A" aria-expanded="false" aria-controls="aiPanel">${icon('chat', 22)}<span class="ai-fab-label" aria-hidden="true">Assistente de IA</span></button>
      <section class="ai-panel" id="aiPanel" role="dialog" aria-modal="false" aria-labelledby="aiTitle" hidden>
        <header class="ai-head"><div><h2 id="aiTitle">Assistente de IA</h2>
          <p>Responde com base nos dados da sua análise. Não é recomendação nem promessa de resultado.</p></div>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" data-ai-close aria-label="Fechar o assistente">${icon('close', 16)}</button></header>
        <div class="ai-log" aria-live="polite" aria-relevant="additions" data-ai-log></div>
        <form class="ai-form" data-ai-form>
          <label class="sr-only" for="aiInput">Sua pergunta</label>
          <textarea id="aiInput" rows="2" maxlength="${MAX}" placeholder="Pergunte sobre o método, a cobertura ou seus critérios"></textarea>
          <div class="ai-form-foot"><span class="small muted tabular" data-ai-count></span>
            <button type="submit" class="btn btn-primary btn-sm" data-ai-send>Enviar</button></div>
        </form>
      </section>`,
  );
  document.body.append(el);
  document.documentElement.classList.add('has-ai');
  const fab = el.querySelector('.ai-fab');
  const input = el.querySelector('#aiInput');
  fab.addEventListener('click', () => toggle(!s.open));
  el.querySelector('[data-ai-close]').addEventListener('click', () => toggle(false));
  input.addEventListener('input', paintCount);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  el.querySelector('[data-ai-form]').addEventListener('submit', (e) => (e.preventDefault(), send()));
  paintLog();
  paintCount();
}

addEventListener('keydown', (e) => {
  if (!el) return;
  if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    toggle(!s.open);
  } else if (e.key === 'Escape' && s.open && !document.querySelector('.tour, dialog[open]')) toggle(false);
});

function toggle(open) {
  if (!el) return;
  s.open = open;
  const panel = el.querySelector('.ai-panel');
  const fab = el.querySelector('.ai-fab');
  fab.setAttribute('aria-expanded', String(open));
  if (open) {
    panel.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-open'));
    el.querySelector('#aiInput').focus();
  } else {
    el.classList.remove('is-open');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => !s.open && (panel.hidden = true), reduced ? 0 : 220); // espera a saída (transform/opacity)
    if (panel.contains(document.activeElement)) fab.focus();
  }
}

function paintCount() {
  const n = el.querySelector('#aiInput').value.length;
  const left = s.remaining != null ? ` · ${s.remaining} ${s.remaining === 1 ? 'pergunta restante' : 'perguntas restantes'} hoje` : '';
  el.querySelector('[data-ai-count]').textContent = `${n}/${MAX}${left}`;
}

function paintLog() {
  const log = el.querySelector('[data-ai-log]');
  mount(
    log,
    html`${s.turns.length
      ? ''
      : html`<p class="ai-hint">Exemplos: "Como a nota é calculada?", "O que é cobertura?", "Como ajusto o peso de um critério?"</p>`}
      ${s.turns.map((t) => html`<div class="ai-msg ai-${t.role}"><span class="sr-only">${t.role === 'user' ? 'Você:' : t.role === 'assistant' ? 'Assistente:' : ''}</span>${t.content}</div>`)}
      ${s.busy ? html`<div class="ai-msg ai-wait" role="status"><span class="ai-dots" aria-hidden="true"><i></i><i></i><i></i></span> Consultando os dados…</div>` : ''}`,
  );
  log.scrollTop = log.scrollHeight;
}

async function send() {
  const input = el.querySelector('#aiInput');
  const message = input.value.trim();
  if (!message || s.busy) return;
  const history = s.turns.filter((t) => t.role !== 'error').slice(-8);
  s.turns.push({ role: 'user', content: message });
  s.busy = true;
  input.value = '';
  el.querySelector('[data-ai-send]').disabled = true;
  paintLog();
  paintCount();
  try {
    const r = await post('/api/assistente', { message, history, city: s.screen.city ?? null, neighborhood: s.screen.neighborhood ?? null });
    s.turns.push({ role: 'assistant', content: r.reply });
    s.remaining = r.remaining;
  } catch (e) {
    const msg = e instanceof ApiError && e.status !== 0 && e.status !== 500 ? e.message : 'Assistente indisponível no momento.';
    s.turns.push({ role: 'error', content: msg });
  } finally {
    s.busy = false;
    if (el) {
      el.querySelector('[data-ai-send]').disabled = false;
      paintLog();
      paintCount();
    }
  }
}
