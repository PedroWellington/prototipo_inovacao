#!/bin/sh
# Garante que nada do protótipo (dados, notas, créditos e geometria demonstrativos) entrou no produto.
#   sh design/check-leak.sh      -> sai com 1 e lista as linhas se encontrar algo
# backend/tests fica de fora: as cidades fictícias de lá são casos de teste calculados à mão (docs/SCORING.md).
PATTERN='dados-demonstrativos|geometria-demonstrativa|DEMO_GEOMETRY|Créditos ilustrativos|Local de demonstração|Perfil demo|Protótipo interativo|Ambiente de demonstração|Saldo fictício|créditos <small>fictícios|sample:\[|Loja de suplementos <i>'
if git grep -nE "$PATTERN" -- . ':!design' ':!backend/tests'; then
  echo "ERRO: conteúdo demonstrativo do protótipo encontrado no produto." >&2
  exit 1
fi
echo "OK: nenhum dado demonstrativo do protótipo no produto."
