// Tela inicial pós-login: empresa, créditos, "Minhas análises" e o atalho para o explorador.
import { get } from '../api.js';
import { analysesList, companyCard, creditsCard } from '../components/account.js';
import { loadCredits } from '../credits.js';
import { html, mount } from '../html.js';
import { icon, logo } from '../icons.js';
import { go } from '../router.js';
import { loadUser } from '../session.js';
import '../styles/components.css';

export async function render(root) {
  // Tudo em paralelo e um único desenho: nada muda de altura depois (zero salto de layout).
  const [user, profile, credits] = await Promise.all([loadUser(), get('/api/profile'), loadCredits(true)]);
  const draw = (credits) =>
    mount(
      root,
      html`<div class="home">
        <header class="page-header home-top">
          <a href="#/home" class="logo-link" aria-label="Início">${logo()}</a>
          <a class="btn btn-ghost btn-sm" href="#/conta">${icon('user', 16)} Minha conta</a>
        </header>
        <main class="home-grid">
          <div class="home-main">
            <h1 class="home-title">Olá, ${user.name.split(' ')[0]}</h1>
            ${companyCard(profile.profile, user)}
            <a class="btn btn-primary btn-cta" href="#/explorer">${icon('map', 20)} Analisar uma cidade</a>
            <p class="small muted">Compare bairros ou veja as cidades que mais combinam com os critérios que você definiu.</p>
          </div>
          <aside class="home-side">
            ${creditsCard(credits)}
            ${analysesList(credits)}
          </aside>
        </main>
      </div>`,
    );
  draw(credits);

  const ac = new AbortController();
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-city], [data-open-search]');
    if (!b) return;
    if (b.dataset.openCity) go(`/explorer?city=${b.dataset.openCity}`);
    else if (b.dataset.openSearch) go(`/explorer?search=${b.dataset.openSearch}`);
  }, { signal: ac.signal });
  return () => ac.abort();
}
