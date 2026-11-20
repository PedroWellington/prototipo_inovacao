# Capturas antes e depois (1440×900 e celular 390×844)

Geradas por `frontend/perf/screens.mjs` (usuário descartável com sede no Recife). `antes-*` = paleta verde-petróleo anterior;
`fase1-*` = paleta única (`shared/design-tokens.css`); `fase2-*`/`fase3-*` = dashboard e explorador novos.
`logo-*` = marca definitiva (ícone PNG + nome em texto) na landing, no painel escuro do login e sobre fundo claro (termos); ver docs/MARCA.md.
`holograma2-*` = holograma trocado em 2026-11-15 (maquete nova, 360 quadros de 720×720 recortados para 486×396), no desktop e no celular.
`prototipo-selo-*` = selo "Protótipo" junto da logo (html[data-prototype], vindo de GET /api/config) na landing e no login.

## Pastas (2026-11-17: tudo em WebP; gravações reencodadas a 250 kbit/s)

- `parte-a/`: landing e app depois da PARTE A (claro e escuro).
- `redesign/`: telas do redesign premium (Fases 2 a 9), claro e escuro, desktop e celular.
- `sem-cara-de-ia/`: `antes-*` e `depois-*` da limpeza "sem cara de IA".
- `tutorial-e-assistente/`: tutorial de primeira vez (passos 1 e 2) e assistente de IA (aberto, resposta, botão no explorador), claro e escuro, desktop e celular. Capturas com o servidor sem chave do Groq: a resposta mostra "Assistente indisponível no momento.", o caminho de erro; nenhuma resposta foi simulada.
- `landing/` (2026-11-20): seção do vídeo, "Do bairro ao ponto", "Dados e fontes" na nova posição, mapa do Brasil no primeiro quadro (uma cor) e com o Nordeste em destaque, claro e escuro, desktop e celular; detalhe do bairro com a comparação de renda e páginas do PDF e dos slides com renda.
- `movimento-*.webm`: tema em círculo, entrada da Visão geral, troca de página, ranking reordenando, abrir cidade, tooltip (`frontend/perf/record.mjs`).

Para gerar capturas novas já leves: `frontend/perf/screens-tema.mjs` ou `perf/assistente.mjs` numa pasta temporária e converter para WebP (qualidade 78) antes de versionar.
