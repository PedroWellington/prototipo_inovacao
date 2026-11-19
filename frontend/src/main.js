import './styles/tokens.css';
import './styles/app.css';
import './styles/theme-dark.css';
import { flags, flagsReady, loadFlags } from './config.js';
import { loadUser } from './session.js';
import { startRouter } from './router.js';

loadFlags(); // em paralelo: o selo aparece quando a resposta chegar
startRouter();

// Assistente de IA: só com a flag pública ligada (servidor com chave) e logado. Baixado só nesse caso; montado
// uma vez fora do roteador, para a conversa sobreviver à troca de aba.
flagsReady.then(async () => {
  if (!flags.assistant) return;
  const { syncAssistant } = await import('./components/assistant.js');
  const sync = () => loadUser().then(syncAssistant, () => {});
  addEventListener('hashchange', sync);
  sync();
});

// Sombra só no que flutua: a barra superior ganha sombra quando a página rolou (CSS: html.is-scrolled .topbar).
const onScroll = () => document.documentElement.classList.toggle('is-scrolled', scrollY > 4);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
