import { del, post } from '../api.js';
import { creditsCard } from '../components/account.js';
import { html, mount } from '../html.js';
import { topbar, wireTopbar } from '../components/topbar.js';
import { loadCredits } from '../credits.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { clearUser, loadUser } from '../session.js';
import '../styles/components.css';

export async function render(root) {
  const [user, credits] = await Promise.all([loadUser(), loadCredits(true).catch(() => null)]);
  mount(
    root,
    html`<div class="app-shell">${topbar({ active: null, user })}<div class="page">
      <h1>Minha conta</h1>
      <section class="card">
        <dl class="dl">
          <dt>Nome</dt><dd>${user.name}</dd>
          <dt>E-mail</dt><dd>${user.email}</dd>
        </dl>
        <div class="card-actions">
          <a class="btn btn-secondary btn-sm" href="#/onboarding">${icon('edit', 16)} Editar critérios e perfil</a>
          <a class="btn btn-ghost btn-sm" href="#/home?tutorial=1">${icon('info', 16)} Ver tutorial novamente</a>
          <button class="btn btn-ghost btn-sm" data-logout>${icon('logout', 16)} Sair</button>
        </div>
      </section>
      <section class="card">
        <h2>Créditos</h2>
        ${creditsCard(credits)}
        <div class="card-actions">
          <a class="btn btn-primary btn-sm" href="#/creditos">${icon('coin', 16)} Comprar créditos</a>
        </div>
      </section>
      <section class="card">
        <h2>Seus dados (LGPD)</h2>
        <p class="muted small">Baixe uma cópia de tudo o que guardamos sobre você, ou exclua a conta de forma definitiva.</p>
        <div class="card-actions">
          <a class="btn btn-secondary btn-sm" href="/api/account/export" download>${icon('download', 16)} Baixar meus dados</a>
          <button class="btn btn-ghost btn-sm" data-delete style="color: var(--color-danger)">${icon('trash', 16)} Excluir conta</button>
        </div>
        <div class="alert alert-error" role="alert" aria-live="assertive" data-error></div>
      </section>
    </div></div>`,
  );

  const ac = new AbortController();
  wireTopbar(root, { signal: ac.signal });
  root.querySelector('[data-logout]').addEventListener('click', async () => {
    await post('/api/auth/logout').catch(() => {});
    clearUser();
    go('/login');
  });
  root.querySelector('[data-delete]').addEventListener('click', async (e) => {
    if (!confirm('Excluir a conta apaga seu perfil, critérios e sessões. Não dá para desfazer. Continuar?')) return;
    e.currentTarget.setAttribute('aria-busy', 'true');
    try {
      await del('/api/account');
      clearUser();
      go('/register');
    } catch (err) {
      root.querySelector('[data-error]').textContent = err.message;
      e.currentTarget.removeAttribute('aria-busy');
    }
  });
  return () => ac.abort();
}
