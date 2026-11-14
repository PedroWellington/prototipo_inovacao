import { html, mount } from '../html.js';

export function render(root) {
  mount(root, html`<div class="page"><h1>Explorador</h1><p class="muted">Em construção.</p></div>`);
}
