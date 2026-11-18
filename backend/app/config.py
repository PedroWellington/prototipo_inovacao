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
PAYMENTS_ENABLED = flag("PAYMENTS_ENABLED", False)  # gateway de pagamento (app/billing); desligado = só registra interesse

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
AI_TIMEOUT_SECONDS = float(os.getenv("AI_TIMEOUT_SECONDS", "20"))
SESSION_COOKIE = f"{PRODUCT_NAME.lower()}_session"

IBGE_API = "https://servicodados.ibge.gov.br/api"
