# Holograma da unidade: como trocar a imagem

O holograma que sobe sobre o bairro clicado é uma **visualização conceitual** (uma loja genérica). Ele não representa endereço, imóvel nem estabelecimento real, e o rótulo "Visualização conceitual da unidade" aparece sempre junto dele.

A lógica fica em `frontend/src/map/hologram.js`: giro, subida, âncora no bairro e janela de decodificação. Ela **não muda** quando você troca a imagem. Tudo o que depende da imagem está num único arquivo: `frontend/public/holograma/manifest.json`.

## 1. Requisitos da imagem

- **PNG com fundo transparente** (RGBA), **quadrado**, com **640 px ou mais** de lado.
- **Uma sequência de quadros** cobrindo **360°** de giro, com nomes em ordem (`loja-000.png`, `loja-001.png`…). Pode ser qualquer quantidade: 36, 120 ou 360. Mais quadros deixam o giro mais suave, mas pesam mais.
- **O objeto deve estar centralizado e com a mesma linha de base** em todos os quadros, sem "pular".
- **A luz deve vir sempre da mesma direção**, presa ao objeto e não à câmera, para o giro parecer natural.
- **Também serve uma imagem única**: fica parada, sem giro.

## 2. Gerar os arquivos

```powershell
python -I scripts/build-holograma.py C:\caminho\para\os\png          # tema claro (padrão)
python -I scripts/build-holograma.py C:\caminho\outros\png --tema escuro   # opcional: um conjunto só para o modo escuro
python -I scripts/build-holograma.py C:\caminho\loja.png               # imagem única (sem giro)
```

O script faz o seguinte:
- **Recorte:** corta o espaço vazio pela união das caixas de conteúdo, então todos os quadros ficam alinhados.
- **Conversão:** gera WebP com transparência em `frontend/public/holograma/<tema>/`.
- **Manifesto:** escreve o `manifest.json`, mesclando com o outro tema se ele já existir.
- **Relatório:** mostra o peso e a memória estimada, e **avisa se passar de 6 MB ou 80 MB**.

Opções:

| Opção | Para quê | Padrão |
|---|---|---|
| `--volta 12` | Segundos por volta completa. A velocidade vem daqui, nunca do número de quadros. | 12 |
| `--rotulo "..."` | Texto do rótulo (nunca fica vazio) | Visualização conceitual da unidade |
| `--base 0.05` | Fração da altura abaixo da base do objeto, para ele "pousar" na ponta do cone | 0 |
| `--escala 1.2` | Multiplica o tamanho exibido (desktop 230 px, celular de 130 a 200 px) | 1 |
| `--quality 82` | Qualidade do WebP. Baixe se passar de 6 MB. | 82 |

Sem o conjunto `escuro`, o modo escuro usa o `claro`.

## 3. Conferir

```powershell
python -I scripts/build-holograma.py --autoteste   # conjuntos falsos de 36 e 120 quadros, imagem única e dois temas
cd frontend; npx vitest run                         # mesma velocidade de giro com qualquer N; janela e memória
cd frontend; npx vite --port 5179                   # e abra http://localhost:5179/app/holo-lab.html
docker compose up -d --build; cd frontend; node perf/holo-fps.mjs   # fluidez no explorador (docs/PERFORMANCE.md)
```

No explorador, clique num bairro e confira três coisas:
- o objeto pousa no cone (ajuste `--base`);
- o rótulo aparece;
- o giro leva o tempo de `--volta`.

Os PNGs brutos não vão para o Git: ficam em `design/`, que é ignorado.
