import './styles/tokens.css';
import './styles/app.css';
import { loadFlags } from './config.js';
import { startRouter } from './router.js';

loadFlags(); // em paralelo: o selo aparece quando a resposta chegar
startRouter();

// Sombra só no que flutua: a barra superior ganha sombra quando a página rolou (CSS: html.is-scrolled .topbar).
const onScroll = () => document.documentElement.classList.toggle('is-scrolled', scrollY > 4);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
