# Assistente de IA

Botão redondo no canto inferior direito de todas as telas do app (só para quem está logado; nunca na landing). Abre um painel lateral (gaveta no celular) que sobrevive à troca de aba. Atalho: **Alt+A** abre e fecha; **Esc** fecha.

O provedor é configurável: qualquer serviço compatível com a API do OpenAI (`/chat/completions`) funciona, trocando só as variáveis de ambiente abaixo. A lógica do assistente (contexto, filtro de saída, limites) não muda com o provedor.

## Como ligar

| Variável (servidor) | Padrão | O que faz |
|---|---|---|
| `AI_ASSISTANT_ENABLED` | `false` | Liga o assistente. Desligado, ou ligado sem chave: o botão não aparece e `/api/assistente` responde 404. |
| `AI_API_KEY` | vazio | Chave do provedor. **Só no servidor** (variável de ambiente, Secret na Vercel). Nunca no frontend nem no Git. Se vazia, usa `GROQ_API_KEY` (alternativa antiga). |
| `AI_BASE_URL` | `https://api.groq.com/openai/v1` | Base da API compatível com OpenAI (sem `/chat/completions`). |
| `AI_MODEL` | vazio (usa `GROQ_MODEL`) | Modelo do provedor (ver "Modelo" abaixo). |
| `GROQ_API_KEY`, `GROQ_MODEL` | vazio, `openai/gpt-oss-120b` | Alternativa antiga (Groq); usadas só enquanto `AI_API_KEY`/`AI_MODEL` não existirem. |
| `AI_DAILY_LIMIT` | `30` | Perguntas por conta por dia. |
| `AI_MAX_CHARS` | `600` | Tamanho máximo da pergunta. |
| `AI_TIMEOUT_SECONDS` | `10` | Tempo máximo de cada tentativa. |
| `AI_TOTAL_SECONDS` | `45` | Prazo da pergunta inteira (todas as tentativas e esperas). Fica abaixo do `maxDuration` de 60 s da função (`vercel.json`): pior caso 10 s + 0,7 s + 10 s + 10 s + 10 s = 40,7 s. |
| `AI_FALLBACK_MODEL` | `gemini-3.5-flash-lite` com `AI_BASE_URL` do Google; vazio nos outros | Segundo modelo **do provedor principal** (mesma URL e chave), tentado uma vez. Vazio desliga. |
| `AI_FALLBACK_API_KEY` | vazio | Chave do **provedor reserva** (outro serviço). Vazia: o provedor reserva fica desligado. Só no servidor. |
| `AI_FALLBACK_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` | Base da API do provedor reserva (sem `/chat/completions`). |
| `AI_FALLBACK_PROVIDER_MODEL` | `gemini-3.8-flash` | Modelo do provedor reserva. |

**Configuração atual (2026-11-19):** principal na OpenRouter (`AI_BASE_URL=https://openrouter.ai/api/v1`, `AI_API_KEY` e `AI_MODEL` da OpenRouter, `AI_FALLBACK_MODEL` opcional) e Google Gemini como provedor reserva (`AI_FALLBACK_API_KEY` do AI Studio; URL e modelo já são o padrão).

Na Vercel: **Settings > Environment Variables** do projeto, ambiente *Production* (e *Preview*, se quiser testar lá), e depois um novo deploy.

## Provedor: Google Gemini (plano gratuito do AI Studio)

- `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai` (endpoint compatível com OpenAI; confirmado em <https://ai.google.dev/gemini-api/docs/openai>, redireciona para <https://aistudio.google.com/docs/openai>).
- `AI_MODEL=gemini-3.8-flash`: modelo Flash estável e principal, com preço "gratuito" na tabela de preços consultada em **2026-11-17** em <https://ai.google.dev/gemini-api/docs/pricing> (redireciona para <https://aistudio.google.com/docs/pricing>) e listado como estável em <https://aistudio.google.com/docs/models>. `gemini-2.5-flash`, usado antes, está descontinuado (passa a responder como `gemini-3.5-flash-lite` a partir de 01/12/2026).
- `AI_API_KEY`: chave criada em <https://aistudio.google.com/apikey> ("Create API key"), plano gratuito. Só no servidor.
- **Privacidade do plano gratuito:** a mesma página de preços e os termos (<https://ai.google.dev/gemini-api/terms>, seção "How Google Uses Your Data") confirmam que, no plano gratuito ("Unpaid Services"), o conteúdo enviado pode ser usado para melhorar os produtos do Google e pode ser lido por revisores humanos. Por isso o contexto montado pelo servidor (`build_context`) manda só dados abertos agregados e a pergunta da pessoa — nunca e-mail, nome, senha ou qualquer dado pessoal da conta (conferido em `test_context_is_real_and_private`). O aviso para quem usa o assistente fica nos Termos de uso, seção "Avisos legais".
- Antes de trocar de modelo, consulte de novo as páginas acima (modelos do Gemini mudam e são descontinuados com frequência).

## Trocando de provedor

Qualquer serviço com endpoint `/chat/completions` no formato OpenAI serve: ajuste `AI_BASE_URL`, `AI_API_KEY` e `AI_MODEL`. O parâmetro `reasoning_effort`/`include_reasoning` só é enviado quando `AI_MODEL` começa com `openai/gpt-oss` (específico do Groq); para outros modelos (Gemini incluído) esses campos não vão.

## O que ele pode e não pode dizer

- As regras estão em `SYSTEM_PROMPT` (`backend/app/assistant.py`): usa só o bloco CONTEXTO; sem o dado, responde "Não tenho esse dado aqui." e aponta onde ver no site; cita fonte e data; não recomenda bairro nem cidade; não promete lucro, faturamento ou sucesso; usa "os bairros que mais combinam com os critérios que você definiu".
- **Conferido no servidor:** toda resposta passa por `violations()` (expressão em `FORBIDDEN`: "melhor bairro", "garantido", "lucro certo", "recomendo", "ideal para você", "100% preciso"…). Se aparecer algo, o servidor pede de novo uma vez lembrando a regra; se repetir, devolve uma resposta segura fixa. Por isso as respostas não são em streaming: a verificação precisa do texto inteiro antes de ele chegar à tela. Enquanto isso, o painel mostra "Consultando os dados…" sem travar o mapa nem a interface.
- Testes: `backend/tests/test_assistant.py` (frases proibidas, regras no prompt, limites, falha do provedor, provedor simulado sem rede de verdade, flag desligada, sem e-mail no contexto) e `frontend/perf/assistente.mjs` (só logado, todas as abas, conversa que sobrevive à troca de aba, teclado, erro tratado).

## Contexto enviado (LGPD: só o necessário)

Montado no servidor (`build_context`), só do que a própria conta já pode ver: ramo, critérios e pesos, saldo de créditos, cidades abertas (nome e dias restantes), fontes com data. Se a tela atual for uma cidade **liberada para a conta**: população (IBGE), referências, cobertura, os 10 bairros que mais combinam (posição e nota) e, com um bairro aberto, os números dele por critério, a cobertura e a renda (com o mesmo texto do explorador). Cidade não liberada: só uma frase dizendo que não há números dela.

Nunca vão: nome, e-mail, senha, dados de outras contas, nome da empresa, faturamento. O conteúdo das conversas não é gravado nem vai para log; o banco guarda só **quantas** perguntas a conta fez por dia (`assistant_usage`), para o limite diário. A conversa vive só na memória da aba e some ao sair da conta.

## Limites e falhas

- Por conta: `AI_DAILY_LIMIT` por dia (contagem atômica no banco). Ao atingir: "Você chegou ao limite de 30 perguntas por dia ao assistente. Ele volta amanhã."
- Por IP: 20 pedidos por minuto (em memória, por processo; `# shortcut` no código).
- Pergunta acima de `AI_MAX_CHARS`: recusada com a mensagem do limite.
- **Ordem das tentativas** (tudo dentro de `AI_TOTAL_SECONDS`; `call_model` em `backend/app/assistant.py`):
  1. principal com `AI_MODEL`; em 500, 502, 503, 504 ou tempo esgotado, **uma** nova tentativa (espera de 0,7 s);
  2. principal com `AI_FALLBACK_MODEL`, uma vez (se existir);
  3. provedor reserva (`AI_FALLBACK_API_KEY`, `AI_FALLBACK_BASE_URL`, `AI_FALLBACK_PROVIDER_MODEL`), uma vez (se a chave existir).

  Em 429 do principal (limite da OpenRouter) vai **direto** ao reserva, sem repetir. Em 400, 401, 403, 404, falha de conexão ou resposta inválida, não tenta de novo no principal, mas tenta o reserva. A pergunta conta **uma vez** em `AI_DAILY_LIMIT`, qualquer que seja o número de tentativas (e não conta se tudo falhar). A tela mostra o código do **último** erro.
  O log registra cada falha (`assistente falhou: tentativa=N provedor=P modelo=M código=C classe=Exceção`) e quem respondeu (`assistente respondeu: provedor=P modelo=M tentativas=N`), sem conteúdo, chave nem URL. Reserva escolhida: `gemini-3.5-flash-lite`, estável e "Free of charge" no plano gratuito (<https://aistudio.google.com/docs/models> e <https://aistudio.google.com/docs/pricing>, consultadas em 2026-11-19).
- Provedor fora do ar, chave inválida, limite do plano gratuito (429) ou tempo esgotado: "Assistente indisponível no momento (código: X)." A pergunta não conta no limite e o resto do site segue normal.
  Códigos (os mesmos no log do servidor, junto com o modelo: `assistente indisponível: código=X modelo=Y`): `sem-chave`;
  `provedor-400`/`provedor-404` (modelo errado ou inexistente); `provedor-401`/`provedor-403` (chave inválida ou sem
  permissão); `limite` (429, cota do plano gratuito); `rede-timeout` (tempo esgotado); `rede-conexao` (falha de conexão; a classe da exceção vai para o log); `resposta-invalida`;
  qualquer outro status vira `provedor-<status>`. Em `provedor-503` a mensagem acrescenta "O serviço de IA está com muita demanda. Tente de novo em instantes.". Nunca entram a chave, a URL nem o corpo da resposta.
