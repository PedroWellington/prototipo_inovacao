import './styles/tokens.css';
import './styles/app.css';
import { loadFlags } from './config.js';
import { startRouter } from './router.js';

loadFlags(); // em paralelo: o selo aparece quando a resposta chegar
startRouter();
