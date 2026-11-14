import { html, mount } from '../html.js';
import { icon, logo } from '../icons.js';

const DRAFT = 'Texto provisório, sujeito a revisão jurídica antes de uso real.';

function page(root, title, body) {
  mount(
    root,
    html`<div class="banner-draft" role="note">${DRAFT}</div>
      <div class="page">
        <header class="page-header">
          <a href="#/" class="logo-link" aria-label="Início">${logo()}</a>
          <a class="btn btn-ghost btn-sm" href="#/">${icon('back', 16)} Voltar</a>
        </header>
        <h1>${title}</h1>
        ${body}
      </div>`,
  );
}

export function terms(root) {
  page(
    root,
    'Termos de uso',
    html`<p>O LOCUS organiza dados públicos para apoiar a sua decisão sobre onde abrir um negócio. A decisão é sempre sua.</p>
      <h2>O que o LOCUS faz</h2>
      <p>Mostra e ordena bairros conforme os critérios que você define, com a fonte e a data de cada dado.</p>
      <h2>O que o LOCUS não faz</h2>
      <p>Não recomenda bairros, não promete lucro, faturamento ou sucesso e não faz projeções financeiras. As informações têm caráter informativo e não substituem análise própria ou profissional. Não constituem aconselhamento jurídico nem financeiro.</p>
      <h2>Dados ausentes</h2>
      <p>Quando um dado não existe para uma área, a plataforma informa que ele não foi encontrado, sem estimar valores.</p>`,
  );
}

export function privacy(root) {
  page(
    root,
    'Política de privacidade',
    html`<p>Guardamos apenas o necessário para a sua conta funcionar: nome, e-mail, senha (somente em forma de hash), respostas do cadastro inicial e seus critérios.</p>
      <h2>Seus direitos (LGPD)</h2>
      <p>Na tela Minha conta você pode baixar todos os seus dados em JSON e excluir a conta, o que apaga também sessões, perfil e critérios.</p>
      <h2>Dados de terceiros</h2>
      <p>Os dados de estabelecimentos vêm da base pública do CNPJ. Não guardamos nem exibimos razão social, nome fantasia, telefone, e-mail ou dados de sócios.</p>
      <h2>Cookies</h2>
      <p>Usamos um único cookie de sessão, necessário para manter você conectado.</p>`,
  );
}
