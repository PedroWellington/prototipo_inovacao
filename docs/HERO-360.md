# Hero 360: mergulho do mapa ao holograma (branch `hero-360`, experimental)

## O que mudou

Só a imagem do hero da landing. O hero já era uma rolagem longa (950 vh, palco fixo): mapa em canvas do Brasil aos bairros do Recife (capítulos 1 a 5) e, nos capítulos 6 a 8, a **foto da loja dentro de um círculo que crescia**. Esse círculo e a foto saíram; no lugar, a sequência de 360 quadros do pacote `design/hero-360/`: começa na tela do VICUS com o mapa do Recife, aproxima nos bairros numerados e termina no holograma da unidade. Texto dos capítulos, botões, cabeçalho, linha de progresso do topo, mapa em canvas e as demais seções ficaram iguais. O app e o explorador não foram tocados.

- **Onde entra:** `SEQ_FROM = 0.7` em `landing/js/landing.js` (fim do capítulo 5). `KNOTS` amarra os quadros aos capítulos: 0,70 → quadro 0; 0,81 → 235 (fim da descida); 0,91 → 320 (loja estabilizando); 0,965 → 359. Trocar `SEQ_FROM` para `0` faz a cena ocupar o hero inteiro (o mapa em canvas some, mas os textos dos capítulos 1 a 4 falam de Brasil, regiões e estados).
- **É ilustração, não dado.** A camada é `aria-hidden="true"` e leva o crédito "Cena ilustrativa · mapa-base © OpenStreetMap contributors". Os rótulos do mapa ("Recife · PE · exemplo", "Boa Viagem") somem quando a cena entra, porque ela não é o mapa.

## Qual caminho venceu: vídeo, com quadros como reserva

| Caminho | Quando | Peso baixado |
|---|---|---|
| **Vídeo** WebM VP8 (`sequencia.webm`) | o navegador toca VP8 **e** passa na calibração | 2,1 MB |
| **Quadros** WebP (`f/000.webp` … `f/359.webp`) | sem VP8, vídeo não carregou, calibração reprovada, ou 3 buscas travadas (> 250 ms) durante o uso | desktop: até 7,8 MB (360); celular: ~2,6 MB (120, 1 a cada 3) |
| **Estático** (último quadro, o holograma) | movimento reduzido, economia de dados ou conexão 2G, aparelho fraco (≤ 2 GB ou ≤ 2 núcleos), sem JavaScript | 30 KB |

**Por que vídeo, e por que reencodado.** O MP4 do pacote tem só 2 quadros-chave (1 e 251): para mostrar o quadro 240 o navegador decodifica 239 quadros antes. Medido no Edge, raspando para frente, para trás e com saltos: **buscas de 40 ms (mediana) e 100 ms (p95)**, o que engasga a rolagem. Reencodado em VP8 com quadro-chave a cada 6 quadros: **11 ms (mediana) e 15 ms (p95), também com CPU 4× mais lenta**, e a decodificação acontece fora da thread principal. Com 12 quadros entre chaves: 15 e 27 ms. O peso ficou igual (2,1 MB) porque o bitrate é limitado.

**Calibração em tempo de execução** (`landing/js/hero-seq.js`): depois que a landing carrega e o navegador fica ocioso, baixa o vídeo e faz 8 buscas espalhadas (para frente e para trás). Passa se a mediana for ≤ 40 ms e a pior ≤ 160 ms; senão, quadros. Resultado no Edge (desktop e celular emulado): vídeo, buscas de 14 a 20 ms.

**Onde cada caminho fica.** Chrome, Edge e Android (Chrome): vídeo, no desktop e no celular. Firefox: VP8 é suportado, então tenta o vídeo e a calibração decide. **Safari e iOS não foram testados aqui** (não há esses navegadores neste ambiente); o código cai para os quadros se o Safari não tocar VP8 ou se as buscas forem lentas, que é o caso conhecido. Recomendo abrir a prévia num iPhone antes de publicar.

**Quadros (reserva).** Baixados em ondas (1 a cada 12, depois 1 a cada 4, depois o resto), no máximo 6 ao mesmo tempo; guardados comprimidos e decodificados sob demanda numa janela de 24 quadros no desktop e 12 no celular (`createImageBitmap` e `close()` para liberar). Sem o quadro pedido, desenha o mais próximo já pronto. Um arquivo ausente (404) é ignorado.

**Nunca tela preta.** O pôster (quadro 0) é pré-carregado com prioridade baixa, sem disputar com o topo da landing. A cena só fica visível quando já tem imagem pronta; até lá o mapa em canvas continua. O vídeo só cobre o pôster depois do primeiro quadro certo, e o canvas dos quadros só aparece depois do primeiro desenho. Se nem o pôster carregar, a cena não entra e o hero termina como o mapa e os textos.

## Pesos finais

- No repositório (`frontend/public/hero-360/v1/`): **9,9 MB** (vídeo 2,1 MB + 360 quadros 7,8 MB). Os 120 quadros do celular são um subconjunto dos mesmos arquivos, sem duplicar.
- Baixado por visita: **2,1 MB** com vídeo; 2,6 MB (celular) ou até 7,8 MB (desktop) só na reserva de quadros; 30 KB no estático.
- Origem (`design/hero-360/`: quadros, MP4, prévia, 16 MB) fica fora do Git; só `LEIA-ME.txt` e `PROMPT-PARA-IA-VSCODE.md` vão.
- Cache: `/app/hero-360/` com `max-age` de 1 ano e `immutable` (nginx e `vercel.json`). Os nomes nunca mudam dentro de uma versão: trocar a sequência = pasta nova (`v2`).
- A foto antiga da loja (`landing/assets/loja-esquina-*`) não é mais usada pelo hero, mas continua na pasta (nada foi apagado).

## Medições

Em `docs/PERFORMANCE.md` ("Hero 360"). Resumo: na rolagem pela cena, ~143 fps e p95 de 7 ms, com CPU 4× mais lenta, no vídeo e nos quadros, desktop e celular. Nenhum quadro acima de 50 ms em nenhum perfil. A versão atual (`main`, foto da loja com círculo) mede 27,8 ms (desktop) e 48,6 ms (celular) no mesmo trecho.

## Como ver

- Local: `git checkout hero-360`, construir a imagem do frontend (memória do projeto: `docker build -t prototipo_inovacao-frontend --build-context landing=./landing --build-context shared=./shared --build-arg PRODUCT_NAME=... ./frontend` e `docker compose up -d --no-build`) e abrir <http://localhost:8080/>. Rolar até o capítulo 6.
- Forçar os caminhos de reserva: `http://localhost:8080/?hero=quadros` e `?hero=estatico`. Movimento reduzido: ativar "Mostrar animações" desligado no Windows (ou no DevTools, Rendering > prefers-reduced-motion).
- Gravações: `docs/visual/hero-360/rolagem-desktop.webm` e `rolagem-celular.webm`.

## Como trocar a sequência no futuro

1. Colocar os quadros novos (1280×720, `.webp` ou `.png`, em ordem alfabética) numa pasta em `design/` (fora do Git).
2. `python -I scripts/build-hero-360.py <pasta> v2` (gera `frontend/public/hero-360/v2/`; reproduz o `v1` byte a byte a partir do pacote atual).
3. Em `landing/js/hero-seq.js`, trocar `base` para `/app/hero-360/v2/` (e `count`, se o número de quadros mudou); em `landing/index.html`, os dois caminhos `/v1/`. Ajustar `KNOTS` em `landing/js/landing.js` se o ritmo da nova sequência for outro.
4. Medir: `node frontend/perf/hero-360.mjs` (fluidez, tempos, memória), `DE=0.74 node frontend/perf/hero-360.mjs` (só a cena) e `node frontend/perf/hero-360-casos.mjs` (reserva, movimento reduzido, sem JS, conexão lenta, falha, redimensionar, teclado).
5. Apagar a pasta da versão antiga só depois que a nova estiver no ar (o cache imutável continua servindo quem tem a antiga).
