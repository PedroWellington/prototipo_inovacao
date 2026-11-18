// Relatório em PDF, roteiro e apresentação: o servidor gera tudo (ranking, números, Google); aqui só se pede e baixa.
// A geração roda no servidor fora do laço principal; aqui é um fetch assíncrono: o mapa e a tela seguem livres.
import { postFile } from './api.js';
import { html, mount } from './html.js';
import { icon } from './icons.js';

const KEY = (ibge) => `report-criteria:${ibge}`;
let lastUrl = null;

// Critérios da tela atual para as telas de roteiro e apresentação (abertas a partir do explorador).
export function rememberCriteria(ibge, criteria) {
  try {
    sessionStorage.setItem(KEY(ibge), JSON.stringify(criteria));
  } catch {
    /* sem armazenamento: as telas usam os critérios salvos no perfil */
  }
}

export function recalledCriteria(ibge) {
  try {
    return JSON.parse(sessionStorage.getItem(KEY(ibge)) || 'null');
  } catch {
    return null;
  }
}

export async function downloadPdf(ibge, body) {
  const { blob, name } = await postFile(`/api/cities/${ibge}/report`, body);
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: lastUrl, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  return { url: lastUrl, name };
}

const LABELS = { report: 'Gerar relatório', route: 'Baixar roteiro em PDF', slides: 'Baixar slides em PDF' };
const BUSY = { report: 'Gerando relatório…', route: 'Gerando roteiro…', slides: 'Gerando slides…' };

export const pdfButton = (kind, cls = 'btn-primary', city = '') =>
  html`<button type="button" class="btn ${cls} report-btn" data-pdf="${kind}" ${city ? html`data-city="${city}"` : ''}>${icon('download', 16)}<span>${LABELS[kind]}</span></button>`;

export const pdfStatus = () => html`<div class="report-status small" data-pdf-status role="status" aria-live="polite"></div>`;

// Liga os botões [data-pdf] dentro de root. body(kind) devolve (ou promete) o corpo do pedido (critérios, bairros...).
// A cidade vem do data-city do botão ou de ibge.
export function wirePdf(root, { ibge, body, signal }) {
  root.addEventListener(
    'click',
    async (e) => {
      const btn = e.target.closest('[data-pdf]');
      if (!btn || btn.disabled) return;
      const kind = btn.dataset.pdf;
      const status = btn.closest('[data-pdf-scope]')?.querySelector('[data-pdf-status]') || root.querySelector('[data-pdf-status]');
      const label = btn.querySelector('span');
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.classList.add('is-busy');
      label.textContent = BUSY[kind];
      if (status) mount(status, html``);
      try {
        const city = btn.dataset.city || (typeof ibge === 'function' ? ibge() : ibge);
        const { url, name } = await downloadPdf(city, { ...(await body(kind)), kind });
        if (status)
          mount(status, html`<span class="report-ok">${icon('check', 14)} ${name} baixado.</span>
            <a href="${url}" target="_blank" rel="noopener">Abrir em nova aba</a>`);
      } catch (err) {
        if (status) mount(status, html`<span class="alert alert-error" role="alert">${icon('alert', 14)}<span>${err.message}</span></span>`);
      } finally {
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.classList.remove('is-busy');
        label.textContent = LABELS[kind];
      }
    },
    { signal },
  );
}
