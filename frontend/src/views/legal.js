import { html, mount } from '../html.js';
import { PRODUCT_NAME } from '../brand.js';
import { aboutLink, icon, logo } from '../icons.js';
import { themeButton } from '../components/topbar.js';

const DRAFT = 'Texto provisório, sujeito a revisão jurídica antes de uso real.';

function page(root, title, body, draft = true) {
  mount(
    root,
    html`${draft ? html`<div class="banner-draft" role="note">${DRAFT}</div>` : ''}
      <div class="page">
        <header class="page-header">
          <a href="#/" class="logo-link">${logo()}</a>
          <span class="header-actions">${aboutLink()}${themeButton()}<a class="btn btn-ghost btn-sm" href="#/">${icon('back', 16)} Voltar</a></span>
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
    html`<p>O ${PRODUCT_NAME} organiza dados públicos para apoiar a sua decisão sobre onde abrir um negócio. A decisão é sempre sua.</p>
      <h2>O que o ${PRODUCT_NAME} faz</h2>
      <p>Mostra e ordena bairros conforme os critérios que você define, com a fonte e a data de cada dado.</p>
      <h2>O que o ${PRODUCT_NAME} não faz</h2>
      <p>Não recomenda bairros, não promete lucro, faturamento ou sucesso e não faz projeções financeiras. As informações têm caráter informativo e não substituem análise própria ou profissional. Não constituem aconselhamento jurídico nem financeiro.</p>
      <h2>Dados ausentes</h2>
      <p>Quando um dado não existe para uma área, a plataforma informa que ele não foi encontrado, sem estimar valores.</p>
      <h2 id="avisos">Avisos legais</h2>
      <p>Informações de caráter informativo. Não substituem análise própria ou profissional. Não constituem aconselhamento jurídico nem financeiro.</p>
      <p>Todo dado mostrado traz fonte e data de referência. A nota de cada área é relativa aos demais lugares comparados: não é uma medida absoluta nem uma previsão.</p>
      <p><a class="btn btn-secondary btn-sm" href="#/como-calculamos">${icon('info', 16)} Como calculamos</a></p>`,
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

// Linkada no explorador ("Como calculamos"): o que é contado e as limitações dos dados.
export function method(root) {
  page(
    root,
    'Como calculamos',
    html`<p>O ${PRODUCT_NAME} ordena bairros e cidades pelos critérios que você define. A nota é relativa: diz como cada lugar se posiciona em relação aos outros comparados, não é uma medida absoluta nem uma previsão.</p>
      <h2>O que é contado</h2>
      <p>Para cada tipo de negócio (farmácia, hospital…) contamos <strong>estabelecimentos com atividade principal</strong> correspondente, pelo código CNAE principal dos cadastros ativos da base pública do CNPJ da Receita Federal. Atividades secundárias não entram.</p>
      <p><strong>Estabelecimento = local distinto</strong> (mesmo CEP, logradouro e número). Vários CNPJs da mesma atividade no mesmo endereço contam uma vez: um hospital que abre um CNPJ por serviço ou profissional não vira dezenas de hospitais. Por outro lado, um prédio com várias clínicas também conta como um local por tipo. Cadastros sem número ("S/N") ou sem CEP contam cada um como um local, porque não dá para provar que estão no mesmo lugar.</p>
      <p><strong>Hospitais vêm do CNES</strong>, o cadastro de estabelecimentos de saúde do Ministério da Saúde: contamos as unidades ativas do tipo hospital geral ou especializado, unidade mista, hospital-dia e pronto-socorro, e o bairro vem da coordenada da unidade, não do texto do endereço. O número de locais com CNPJ de atividade hospitalar aparece ao lado, como complemento: muitos CNPJs com essa atividade são consultórios, salas ou empresas de serviços médicos, não hospitais.</p>
      <h2>Limitações que você precisa conhecer</h2>
      <ul>
        <li><strong>CNPJ não é prédio.</strong> Um hospital pode ter vários CNPJs (matriz e filiais, serviços terceirizados) ou funcionar com um CNPJ de outra atividade. Agrupar por endereço reduz esse efeito, mas uma sala administrativa ou uma loja registrada com atividade hospitalar continua contando como local.</li>
        <li><strong>O cadastro pode estar desatualizado.</strong> Empresas que fecharam sem dar baixa continuam ativas na base; mudanças de endereço podem demorar a aparecer.</li>
        <li><strong>O bairro vem do texto do endereço.</strong> O CNPJ não traz coordenadas. Usamos o campo "bairro" escrito no cadastro e o comparamos com os nomes dos bairros na malha do IBGE. Grafias diferentes ou nomes populares podem não ser reconhecidos; esses estabelecimentos contam na cidade, mas não em nenhum bairro. Por isso mostramos a cobertura de localização.</li>
        <li><strong>Cidades sem bairros na malha do IBGE</strong> usam áreas formadas por setores censitários do IBGE (área urbana, área rural e povoados de cada distrito).</li>
      </ul>
      <h2>Nota dos bairros</h2>
      <p>Para cada critério, calculamos a densidade (estabelecimentos por km²) de cada bairro e a posição relativa dela entre os bairros da cidade (percentil). Em "quero perto", densidade maior aproxima a nota de 100; em "não quero perto", o contrário. A nota é a média ponderada pelos seus pesos. Empates são desfeitos pelo nome.</p>
      <h2>Ranking de cidades</h2>
      <p>O mesmo cálculo, por município, com a contagem dividida pela população (por 10 mil habitantes, o padrão) ou pela área (por km²), segundo o Censo 2022. Cidades abaixo da população mínima escolhida ficam fora, para que municípios muito pequenos não distorçam a comparação. Só entram cidades com dados carregados.</p>
      <h2>Renda</h2>
      <p>Usamos a mediana do rendimento nominal mensal das pessoas responsáveis pelo domicílio (Censo 2022, IBGE). Para bairros da malha do IBGE, é o valor publicado pelo IBGE para o bairro; para áreas por setor censitário, é a média das medianas dos setores, ponderada pelo número de responsáveis, e por isso aparece como "aproximado". Valores sob sigilo do IBGE aparecem como indisponíveis; nunca estimamos. Renda é um indicador e não determina preferências.</p>
      <h2>Falta de dado</h2>
      <p>Quando um dado não existe para uma área, mostramos "Não foi possível encontrar dados de [item] desta área.", sem preencher com estimativas.</p>`,
    false,
  );
}
