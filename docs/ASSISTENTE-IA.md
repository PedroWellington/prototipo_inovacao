# Assistente de IA (Groq)

Botão redondo no canto inferior direito de todas as telas do app (só para quem está logado; nunca na landing). Abre um painel lateral (gaveta no celular) que sobrevive à troca de aba. Atalho: **Alt+A** abre e fecha; **Esc** fecha.

## Como ligar

| Variável (servidor) | Padrão | O que faz |
|---|---|---|
| `AI_ASSISTANT_ENABLED` | `false` | Liga o assistente. Desligado, ou ligado sem chave: o botão não aparece e `/api/assistente` responde 404. |
| `GROQ_API_KEY` | vazio | Chave do Groq. **Só no servidor** (variável de ambiente). Nunca no frontend nem no Git. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Modelo do Groq (ver "Modelo" abaixo). |
| `AI_DAILY_LIMIT` | `30` | Perguntas por conta por dia. |
| `AI_MAX_CHARS` | `600` | Tamanho máximo da pergunta. |
| `AI_TIMEOUT_SECONDS` | `20` | Tempo máximo de espera pelo Groq. |

Na Vercel: **Settings > Environment Variables** do projeto, ambiente *Production* (e *Preview*, se quiser testar lá), e depois um novo deploy. A chave sai de <https://console.groq.com/keys> ("Create API Key"); copie na hora, porque o Groq só a mostra uma vez.

## Modelo

Lista consultada em **2026-11-17** em <https://console.groq.com/docs/models> e <https://console.groq.com/docs/deprecations>:

- Produção: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` (mais `whisper-*`, só áudio).
- `llama-3.3-70b-versatile` e `llama-3.1-8b-instant` têm desligamento anunciado para 16/08/2026 (aviso por e-mail em 17/06/2026); a página de descontinuação recomenda `openai/gpt-oss-120b` no lugar. Por isso não foram escolhidos, mesmo ainda aparecendo na lista.
- Escolhido: **`openai/gpt-oss-120b`** (produção, sem aviso de descontinuação). Limites da conta gratuita publicados na data: 30 pedidos/min, 1.000/dia, 8 mil tokens/min, 200 mil tokens/dia. O contexto montado pelo servidor cabe com folga em 8 mil tokens.
- É um modelo de raciocínio: o servidor manda `include_reasoning: false` e `reasoning_effort: "low"`, para o raciocínio interno não chegar à pessoa e a resposta sair mais rápido. Trocar de modelo é só mudar `GROQ_MODEL`; para modelos que não são `openai/gpt-oss-*`, esses dois parâmetros não vão.
- Antes de trocar, consulte de novo as duas páginas acima (modelos mudam e são desligados).

## O que ele pode e não pode dizer

- As regras estão em `SYSTEM_PROMPT` (`backend/app/assistant.py`): usa só o bloco CONTEXTO; sem o dado, responde "Não tenho esse dado aqui." e aponta onde ver no site; cita fonte e data; não recomenda bairro nem cidade; não promete lucro, faturamento ou sucesso; usa "os bairros que mais combinam com os critérios que você definiu".
- **Conferido no servidor:** toda resposta passa por `violations()` (expressão em `FORBIDDEN`: "melhor bairro", "garantido", "lucro certo", "recomendo", "ideal para você", "100% preciso"…). Se aparecer algo, o servidor pede de novo uma vez lembrando a regra; se repetir, devolve uma resposta segura fixa. Por isso as respostas não são em streaming: a verificação precisa do texto inteiro antes de ele chegar à tela. Enquanto isso, o painel mostra "Consultando os dados…" sem travar o mapa nem a interface.
- Testes: `backend/tests/test_assistant.py` (frases proibidas, regras no prompt, limites, falha do Groq, flag desligada, sem e-mail no contexto) e `frontend/perf/assistente.mjs` (só logado, todas as abas, conversa que sobrevive à troca de aba, teclado, erro tratado).

## Contexto enviado (LGPD: só o necessário)

Montado no servidor (`build_context`), só do que a própria conta já pode ver: ramo, critérios e pesos, saldo de créditos, cidades abertas (nome e dias restantes), fontes com data. Se a tela atual for uma cidade **liberada para a conta**: população (IBGE), referências, cobertura, os 10 bairros que mais combinam (posição e nota) e, com um bairro aberto, os números dele por critério, a cobertura e a renda (com o mesmo texto do explorador). Cidade não liberada: só uma frase dizendo que não há números dela.

Nunca vão: nome, e-mail, senha, dados de outras contas, nome da empresa, faturamento. O conteúdo das conversas não é gravado nem vai para log; o banco guarda só **quantas** perguntas a conta fez por dia (`assistant_usage`), para o limite diário. A conversa vive só na memória da aba e some ao sair da conta.

## Limites e falhas

- Por conta: `AI_DAILY_LIMIT` por dia (contagem atômica no banco). Ao atingir: "Você chegou ao limite de 30 perguntas por dia ao assistente. Ele volta amanhã."
- Por IP: 20 pedidos por minuto (em memória, por processo; `# shortcut` no código).
- Pergunta acima de `AI_MAX_CHARS`: recusada com a mensagem do limite.
- Groq fora do ar, chave inválida ou tempo esgotado: "Assistente indisponível no momento." A pergunta não conta no limite e o resto do site segue normal.
