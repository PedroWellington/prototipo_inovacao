import { icon } from './icons.js';
import { html, mount } from './html.js';

// Liga um formulário: estado ocupado no botão, erro acessível (aria-live) e marcação dos campos inválidos.
export function bindForm(form, onSubmit) {
  const btn = form.querySelector('button[type=submit]');
  const errorBox = form.querySelector('[data-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (btn.getAttribute('aria-busy') === 'true') return;
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    showError(errorBox, '');
    btn.setAttribute('aria-busy', 'true');
    try {
      await onSubmit(Object.fromEntries(new FormData(form)));
    } catch (err) {
      for (const d of err.details || []) form.elements[d.field]?.setAttribute('aria-invalid', 'true');
      showError(errorBox, err.message);
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });
}

export function showError(box, message) {
  if (!box) return;
  mount(box, message ? html`${icon('alert', 16)}<span>${message}</span>` : html``);
}
