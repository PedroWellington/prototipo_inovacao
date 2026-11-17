# Marca: ícone, logo, favicon e manifesto

A marca vem dos PNGs originais em `design/brand/` (painel de marca, ícone sobre fundo branco/creme/escuro e logo horizontal). O produto usa só os arquivos gerados em `frontend/public/brand/`, versionados, servidos em `/app/brand/` pelo nginx do app e, no servidor de desenvolvimento da landing (`landing/scripts/serve.mjs`), pela mesma rota.

## Regenerar

```powershell
python -I scripts/build-marca.py      # ícone limpo (sem ruído, quadrado), favicons, ícones do manifesto e as duas logos SVG
node scripts/build-og.mjs             # og-image.png 1200x630 (usa o Edge para a fonte Inter real)
node scripts/build-og.mjs C:\previa   # também salva as duas logos sobre fundo claro e escuro para conferir
```

Só é preciso rodar de novo se `design/brand/` mudar. O ícone original tem quase todos os pixels levemente transparentes e ruído em volta; o script deixa o miolo opaco, apaga o ruído e preserva a borda antisserrilhada. As letras da logo horizontal original vieram com um halo sujo, por isso o nome é texto em Inter (peso 600, espaçamento 0,16 em).

## Onde cada arquivo é usado

| Arquivo | Uso |
|---|---|
| `vicus-icone-{32,64,96,128,512}.png` | ícone com fundo transparente: `logo()` em `frontend/src/icons.js` (28 px, 2x/3x) e barra da landing (34 px) |
| `favicon.ico`, `favicon-32.png` | `<link rel="icon">` em `frontend/index.html` e `landing/index.html` |
| `apple-touch-icon.png` | 180 px sobre fundo escuro `#181512` (iOS não aceita transparência) |
| `icon-192.png`, `icon-512.png` | `frontend/public/manifest.webmanifest` (instalável; `start_url` e `scope` em `/app/`) |
| `og-image.png` | `og:image` da landing e do app |
| `vicus-logo-claro.svg`, `vicus-logo-escuro.svg` | logo horizontal pronta (ícone + nome) para fundo claro e escuro; uso externo (documentos, redes) |

## Regras

- No app e na landing o nome é **texto** (`.logo-word`), não imagem: segue a cor do tema (grafite no claro, off-white sobre o grafite da barra e dos painéis escuros). O ícone é o mesmo em qualquer fundo.
- Tamanho mínimo do ícone na interface: 20 px.
- O nome do produto continua vindo só de `PRODUCT_NAME` (`src/brand.js`); as imagens não têm texto.
- Nunca usar os PNGs de `design/brand/` diretamente no produto (pesam de 0,5 a 1,7 MB cada).

## Aviso sobre a origem da marca

A logo foi criada por IA (painel e PNGs em `design/brand/`). Antes de investir em material impresso ou registrar a marca: **verificar disponibilidade no INPI** e **pedir o arquivo vetorial profissional** (as SVGs daqui são reconstruções: ícone rasterizado + nome em Inter). No app e na landing a marca segue o tema sem piscar: o ícone é o mesmo e o nome é texto, na cor do tema (grafite no claro, off-white no escuro), trocado pelo mesmo `html[data-theme]` de `public/theme.js`.

## Pendência

- `og:image` precisa de URL absoluta para os crawlers; hoje é `/app/brand/og-image.png`. Trocar quando houver domínio.
