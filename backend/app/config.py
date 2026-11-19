import os
from pathlib import Path

ENV = os.getenv("ENV", "development")
IS_PRODUCTION = ENV == "production"
DATABASE_URL = os.environ["DATABASE_URL"]  # contas: usuários, sessões, créditos, perfil
# Dados de leitura (cidades, bairros, contagens, geometria). Vazio = o mesmo banco das contas (desenvolvimento e testes).
DATA_DATABASE_URL = os.getenv("DATA_DATABASE_URL") or DATABASE_URL
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "168"))
PRODUCT_NAME = os.environ["PRODUCT_NAME"]  # definido só no .env

def flag(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "sim")


# Protótipo (docs/DEPLOY.md). O frontend lê tudo isto em GET /api/config.
PROTOTYPE = flag("PROTOTYPE", False)  # flag interna (sem texto visível ao usuário)
DEMO_MODE = flag("DEMO_MODE", False)  # cadastro sem verificação de e-mail
UPLOADS_ENABLED = flag("UPLOADS_ENABLED", True)  # logo da empresa em disco (DATA_DIR); na Vercel o disco não persiste
GOOGLE_LOGIN_ENABLED = flag("GOOGLE_LOGIN_ENABLED", False)  # app/auth/google.py; exige também as três variáveis abaixo
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")  # ex.: https://vicus-inovacao.vercel.app (monta o redirect do Google)
PDF_ENABLED = flag("PDF_ENABLED", True)  # relatório em PDF, roteiro e modo apresentação (app/report)
REPORT_DAILY_LIMIT = int(os.getenv("REPORT_DAILY_LIMIT", "10"))  # relatórios/roteiros em PDF por conta por dia
REPORT_MAX_CONCURRENT = int(os.getenv("REPORT_MAX_CONCURRENT", "2"))  # geradores simultâneos por processo
# Google Maps Platform, Routes API (docs/GOOGLE-MAPS.md). Sem chave: desligado; o relatório usa a distância em linha reta.
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")  # só no servidor; nunca no frontend nem no Git
GOOGLE_ROUTES_MONTHLY_FREE = int(os.getenv("GOOGLE_ROUTES_MONTHLY_FREE", "10000"))  # cota grátis do SKU (elementos/mês)
GOOGLE_ROUTES_CAP_SHARE = float(os.getenv("GOOGLE_ROUTES_CAP_SHARE", "0.8"))  # trava: fração da cota grátis
GOOGLE_ROUTES_TIMEOUT_SECONDS = float(os.getenv("GOOGLE_ROUTES_TIMEOUT_SECONDS", "4"))
# Compra de créditos (app/billing): off = só registra interesse; demo = pedido real com pagamento SIMULADO.
PAYMENTS_MODE = os.getenv("PAYMENTS_MODE", "off").strip().lower()
if PAYMENTS_MODE not in ("off", "demo"):
    PAYMENTS_MODE = "off"

# Assistente de IA (app/assistant.py; docs/ASSISTENTE-IA.md). Desligado ou sem chave: o botão não aparece.
AI_ASSISTANT_ENABLED = flag("AI_ASSISTANT_ENABLED", False)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")  # alternativa antiga; usada só se AI_API_KEY não existir
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
# Provedor compatível com OpenAI (/chat/completions). Padrão: Groq, mantido pelas duas variáveis acima.
AI_API_KEY = os.getenv("AI_API_KEY") or GROQ_API_KEY  # só no servidor; nunca no frontend nem no Git
AI_BASE_URL = os.getenv("AI_BASE_URL", "https://api.groq.com/openai/v1")
AI_MODEL = os.getenv("AI_MODEL") or GROQ_MODEL
AI_DAILY_LIMIT = int(os.getenv("AI_DAILY_LIMIT", "30"))  # mensagens por conta por dia
AI_MAX_CHARS = int(os.getenv("AI_MAX_CHARS", "600"))  # tamanho máximo da pergunta
# Por tentativa; o total da pergunta (todas as tentativas + reserva) fica em AI_TOTAL_SECONDS, abaixo do
# maxDuration de 60 s da função na Vercel (vercel.json): 3 x 10 s + esperas + 10 s da reserva = 42 s < 45 s.
AI_TIMEOUT_SECONDS = float(os.getenv("AI_TIMEOUT_SECONDS", "10"))
AI_TOTAL_SECONDS = float(os.getenv("AI_TOTAL_SECONDS", "45"))
# Segundo modelo do provedor principal (mesma URL e chave), tentado uma vez depois do AI_MODEL. Vazio desliga.
AI_FALLBACK_MODEL = os.getenv(
    "AI_FALLBACK_MODEL", "gemini-3.5-flash-lite" if "googleapis.com" in AI_BASE_URL else ""
).strip()
# Provedor reserva (outra chave, URL e modelo), tentado uma vez no fim. Sem AI_FALLBACK_API_KEY fica desligado.
AI_FALLBACK_API_KEY = os.getenv("AI_FALLBACK_API_KEY", "").strip()
AI_FALLBACK_BASE_URL = os.getenv("AI_FALLBACK_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai").strip()
AI_FALLBACK_PROVIDER_MODEL = os.getenv("AI_FALLBACK_PROVIDER_MODEL", "gemini-3.8-flash").strip()
SESSION_COOKIE = f"{PRODUCT_NAME.lower()}_session"

IBGE_API = "https://servicodados.ibge.gov.br/api"
