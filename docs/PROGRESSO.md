# Progresso (retomada à prova de interrupção)

Atualizar ao fim de cada fase e antes de qualquer pausa; commit e push logo em seguida.
Os prompts de cada etapa ficam em `design/prompts/` (fora deste repositório até hoje: ver "Pendências").

## Quadro por fase

| Etapa | Fase | Estado | Evidência |
|---|---|---|---|
| Redesign completo | 1. Paleta única (`shared/design-tokens.css`) | ✅ | `87e7a50`; `docs/visual/fase1-*` |
| Redesign completo | 2. Visão geral com dados reais | ✅ | `fab9d46`; `docs/visual/fase2-*` |
| Redesign completo | 3. Explorador em três colunas, ranking FLIP, câmera contínua | ✅ | `0f9ae09`; `docs/visual/fase3-*`; `docs/PERFORMANCE.md` |
| Redesign completo | 4. Landing na paleta única, contraste AA | ✅ | `3d3ad38`, `16605c6`; `docs/ACESSIBILIDADE.md` |
| Holograma e inclinação | Quadros WebP, camada isolada, máquina de estados, medição | ✅ | `9d77f88` a `643c96f`; `docs/HOLOGRAMA.md`; `docs/PERFORMANCE.md` (falta medir em celular real) |
| Modo escuro, logo e menu | Menu (Visão geral · Minhas análises · Dados e fontes · Explorador) | ✅ | `dd916cb`; `journey.mjs` |
| Modo escuro, logo e menu | Logo, favicon, manifesto, og:image | ✅ | `217a1bd`; `docs/MARCA.md`; `docs/visual/logo-*` |
| Modo escuro, logo e menu | Modo escuro | ❌ | só ganchos: `hologram.theme()` e conjunto por tema no manifesto do holograma; fundo previsto `#181512` (apple-touch-icon e `manifest.webmanifest`) |

## Agora

Nada em andamento sem commit. Próximo passo: **modo escuro**, assim que o prompt estiver em `design/prompts/`.

## Decisões tomadas

- Logo no produto = ícone PNG (2x/3x) + nome em texto na cor do tema; os PNGs originais ficam em `design/brand/` (versionados desde `654da32`, 5,8 MB).
- `manifest.webmanifest` servido como `application/manifest+json` por um `location` próprio no nginx.
- Build do Compose no Docker Desktop 29 (Compose v5) falha com "failed to execute bake" neste Windows; as imagens foram construídas com `docker build` direto e `docker compose up -d --no-build`.

## Pendências

- Colocar os prompts (`.md`) em `design/prompts/` e versionar: sem eles, os checklists de aceite não estão no repositório.
- Modo escuro (ver quadro). Decidir: preferência do sistema, botão, ou os dois; mapa-base OSM no escuro; conjunto escuro do holograma.
- `og:image` com URL absoluta quando houver domínio.
- Medir a transição do holograma em celular de verdade (`docs/PERFORMANCE.md`).

## Último commit

`217a1bd` Marca: ícone definitivo no app e na landing, favicons, manifesto instalável e og:image (push feito).
