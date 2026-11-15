import { post } from '../api.js';
import { bindForm } from '../forms.js';
import { html, mount, raw } from '../html.js';
import { aboutLink, icon, logo } from '../icons.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';

// Ilustração abstrata (malha de bairros), puramente decorativa.
const ART = raw(`<svg class="auth-art" viewBox="0 0 400 400" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
  <path d="M40 120l70-40 80 30 30 70-60 60-90-10-30-50z"/><path d="M190 110l90-30 70 50-20 80-100 20-10-50z"/>
  <path d="M220 230l100-20 40 70-60 70-90-20-10-50z"/><path d="M60 230l90 10 60-60 10 50-30 100-90 10-50-60z"/>
  <circle cx="240" cy="170" r="6" fill="currentColor"/></svg>`);

function shell(title, subtitle, form) {
  return html`
    <div class="auth">
      <aside class="auth-aside">
        ${ART} <a href="#/" class="logo-link" aria-label="Início">${logo()}</a>
        <div>
          <h1>Compare bairros pelos critérios que você define.</h1>
          <ul>
            <li>${icon('sliders')}<span>Você escolhe o que quer perto e o que não quer perto do seu negócio, e o peso de cada critério.</span></li>
            <li>${icon('info')}<span>Cada número mostra a fonte e a data de referência, a partir de dados públicos.</span></li>
            <li>${icon('alert')}<span>Quando um dado não existe, mostramos que ele não existe. Nada é estimado para preencher vazio.</span></li>
          </ul>
        </div>
        <small>As informações têm caráter informativo e não substituem análise própria ou profissional.</small>
      </aside>
      <main class="auth-main">
        <div class="auth-card">
          <a href="#/" class="logo-link" aria-label="Início">${logo()}</a>
          <h2>${title}</h2>
          <p>${subtitle}</p>
          ${form}
          <p class="about-row">${aboutLink()}</p>
        </div>
      </main>
    </div>`;
}

async function enter() {
  await loadUser(true);
  go('/'); // o roteador decide: onboarding (primeiro acesso) ou tela inicial
}

export function login(root) {
  mount(
    root,
    shell(
      'Entrar',
      'Acesse sua conta para continuar explorando.',
      html`<form novalidate>
        <div class="alert alert-error" role="alert" aria-live="assertive" data-error></div>
        <div class="field">
          <label class="label" for="email">E-mail</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email" required autofocus />
        </div>
        <div class="field">
          <label class="label" for="password">Senha</label>
          <input class="input" id="password" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary btn-block" type="submit">Entrar</button>
        <p class="auth-switch">Ainda não tem conta? <a href="#/register">Criar conta</a></p>
      </form>`,
    ),
  );
  bindForm(root.querySelector('form'), async (data) => {
    await post('/api/auth/login', { email: data.email.trim(), password: data.password });
    await enter();
  });
}

export function register(root) {
  mount(
    root,
    shell(
      'Criar conta',
      'Leva menos de um minuto. Depois, algumas perguntas rápidas sobre o seu negócio.',
      html`<form novalidate>
        <div class="alert alert-error" role="alert" aria-live="assertive" data-error></div>
        <div class="field">
          <label class="label" for="name">Nome</label>
          <input class="input" id="name" name="name" autocomplete="name" required maxlength="120" autofocus />
        </div>
        <div class="field">
          <label class="label" for="email">E-mail</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email" required />
        </div>
        <div class="field">
          <label class="label" for="password">Senha</label>
          <input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="8" required aria-describedby="pw-hint" />
          <span class="hint" id="pw-hint">Pelo menos 8 caracteres.</span>
        </div>
        <label class="check">
          <input type="checkbox" name="accept_terms" required />
          <span>Li e aceito os <a href="#/termos" target="_blank">Termos de uso</a> e a <a href="#/privacidade" target="_blank">Política de privacidade</a>.</span>
        </label>
        <button class="btn btn-primary btn-block" type="submit">Criar conta</button>
        <p class="auth-switch">Já tem conta? <a href="#/login">Entrar</a></p>
      </form>`,
    ),
  );
  bindForm(root.querySelector('form'), async (data) => {
    // Validação no cliente só para retorno imediato; o servidor valida de novo.
    if ((data.password || '').length < 8) throw { message: 'A senha precisa ter pelo menos 8 caracteres.', details: [{ field: 'password' }] };
    if (!data.accept_terms) throw { message: 'É preciso aceitar os Termos de uso e a Política de privacidade.', details: [{ field: 'accept_terms' }] };
    await post('/api/auth/register', {
      name: data.name.trim(),
      email: data.email.trim(),
      password: data.password,
      accept_terms: true,
    });
    await enter();
  });
}
