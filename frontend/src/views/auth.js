import { post } from '../api.js';
import { flags, flagsReady } from '../config.js';
import { bindForm, showError } from '../forms.js';
import { html, mount, raw } from '../html.js';
import { aboutLink, icon, logo } from '../icons.js';
import { themeButton } from '../components/topbar.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import '../styles/components.css'; // botão "Continuar com o Google"

// Ilustração abstrata (malha de bairros), puramente decorativa.
const ART = raw(`<svg class="auth-art" viewBox="0 0 400 400" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
  <path d="M40 120l70-40 80 30 30 70-60 60-90-10-30-50z"/><path d="M190 110l90-30 70 50-20 80-100 20-10-50z"/>
  <path d="M220 230l100-20 40 70-60 70-90-20-10-50z"/><path d="M60 230l90 10 60-60 10 50-30 100-90 10-50-60z"/>
  <circle cx="240" cy="170" r="6" fill="currentColor"/></svg>`);

function shell(title, subtitle, form) {
  return html`
    <div class="auth">
      <aside class="auth-aside">
        ${ART} <a href="#/" class="logo-link">${logo()}</a>
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
          <div class="auth-top"><a href="#/" class="logo-link">${logo()}</a>${themeButton()}</div>
          <h2>${title}</h2>
          <p>${subtitle}</p>
          ${form}
          <p class="about-row">${aboutLink()}</p>
        </div>
      </main>
    </div>`;
}

// Marca do Google (padrão visual do botão "Continuar com o Google"); aparece só com a flag google_login.
const GOOGLE_G = raw(`<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`);
const GOOGLE_ERRORS = {
  cancelado: 'O login com o Google foi cancelado.',
  email_nao_verificado: 'O Google não confirmou este e-mail. Entre com e-mail e senha ou use outra conta do Google.',
  vinculada: 'Este e-mail já está vinculado a outra conta do Google.',
  invalido: 'Não foi possível validar o login com o Google. Tente de novo.',
};

function googleBlock() {
  return html`
    <div class="auth-google" hidden>
      <div class="auth-or"><span>ou</span></div>
      <a class="btn-google" href="/api/auth/google/start">${GOOGLE_G}<span>Continuar com o Google</span></a>
      <p class="hint">Ao continuar com o Google, você aceita os <a href="#/termos" target="_blank">Termos de uso</a> e a <a href="#/privacidade" target="_blank">Política de privacidade</a>.</p>
    </div>`;
}

function showGoogle(root) {
  flagsReady.then(() => {
    if (flags.google_login) root.querySelector('.auth-google').hidden = false;
  });
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
        ${googleBlock()}
        <p class="auth-switch">Ainda não tem conta? <a href="#/register">Criar conta</a></p>
      </form>`,
    ),
  );
  showGoogle(root);
  const code = new URLSearchParams(location.hash.split('?')[1] || '').get('google');
  if (code) showError(root.querySelector('[data-error]'), GOOGLE_ERRORS[code] || GOOGLE_ERRORS.invalido);
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
        ${googleBlock()}
        <p class="auth-switch">Já tem conta? <a href="#/login">Entrar</a></p>
      </form>`,
    ),
  );
  showGoogle(root);
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
