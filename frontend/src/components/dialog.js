// Confirmação acessível com <dialog> nativo (foco preso, Esc fecha). Devolve Promise<boolean>.
import { html, mount } from '../html.js';

export function confirmDialog({ title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', alertOnly = false }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog';
  mount(
    dlg,
    html`<form method="dialog" class="dialog-body">
      <h2 class="dialog-title">${title}</h2>
      <p>${message}</p>
      <div class="dialog-actions">
        ${alertOnly ? '' : html`<button class="btn btn-secondary" value="cancel">${cancelLabel}</button>`}
        <button class="btn btn-primary" value="ok" autofocus>${alertOnly ? 'Entendi' : confirmLabel}</button>
      </div>
    </form>`,
  );
  document.body.append(dlg);
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok' && !alertOnly);
      dlg.remove();
    }, { once: true });
    dlg.showModal();
  });
}
