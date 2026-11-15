# Bairros do Recife: IBGE (Censo 2022) x Prefeitura do Recife (2023)

Gerado por `scripts/compare_bairros.py` em 2026-11-15.

**Base usada na landing e no produto:** malha de bairros do IBGE (Censo 2022), já carregada no banco.
A da Prefeitura serve só de conferência.

| Medida | IBGE 2022 | Prefeitura 2023 |
|---|---|---|
| Feições | 94 | 94 |
| Área total (km²) | 214.75 | 219.91 |

- Nomes iguais (sem acento e caixa): 93.
- Só no IBGE: Cohab.
- Só na Prefeitura: Cohab - Ibura de Cima.
- Par mais provável de cada nome sem correspondência: Cohab ↔ Cohab - Ibura de Cima (IoU 0.986).
- Sobreposição do contorno da cidade (IoU): 0.973.
- Sobreposição por bairro (IoU): mediana 0.974, mínima 0.380; 73 de 93 bairros acima de 0,95.

Leitura: as maiores diferenças ficam em bairros à beira d'água e do porto (Recife, Brasília Teimosa,
Santo Antônio, Cabanga, São José), onde a Prefeitura tem área maior. Não conferimos a causa feição por feição.

## Bairros com IoU abaixo de 0,95

| Bairro | Área IBGE (km²) | Área Prefeitura (km²) | IoU |
|---|---|---|---|
| Recife | 1.235 | 3.138 | 0.380 |
| Brasília Teimosa | 0.639 | 1.466 | 0.421 |
| Santo Antônio | 0.518 | 0.838 | 0.615 |
| Cabanga | 0.565 | 0.799 | 0.700 |
| São José | 1.775 | 2.485 | 0.709 |
| Pau Ferro | 0.437 | 0.600 | 0.711 |
| Sítio dos Pintos - São Brás | 1.660 | 2.076 | 0.799 |
| Torreão | 0.162 | 0.196 | 0.815 |
| Santo Amaro | 3.377 | 3.744 | 0.877 |
| Paissandu | 0.345 | 0.372 | 0.911 |
| Brejo da Guabiraba | 0.789 | 0.724 | 0.912 |
| Dois Irmãos | 5.994 | 5.632 | 0.916 |
| Curado | 8.013 | 8.251 | 0.926 |
| Pina | 6.368 | 6.630 | 0.929 |
| Boa Viagem | 7.762 | 8.336 | 0.929 |
| Córrego do Jenipapo | 0.608 | 0.570 | 0.930 |
| Ilha do Retiro | 0.542 | 0.528 | 0.933 |
| Derby | 0.476 | 0.482 | 0.946 |
| Apipucos | 1.304 | 1.264 | 0.948 |
| Jaqueira | 0.241 | 0.244 | 0.950 |
