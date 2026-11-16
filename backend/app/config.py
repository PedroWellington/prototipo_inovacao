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
PROTOTYPE = flag("PROTOTYPE", False)  # selo "Protótipo" junto da logo
DEMO_MODE = flag("DEMO_MODE", False)  # cadastro sem verificação de e-mail
UPLOADS_ENABLED = flag("UPLOADS_ENABLED", True)  # logo da empresa em disco (DATA_DIR); na Vercel o disco não persiste
GOOGLE_LOGIN_ENABLED = flag("GOOGLE_LOGIN_ENABLED", False)  # app/auth/google.py; exige também as três variáveis abaixo
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")  # ex.: https://vircus-nu.vercel.app (monta o redirect do Google)
PDF_ENABLED = flag("PDF_ENABLED", False)  # ainda não implementado (docs/EXTENSIONS.md)
SESSION_COOKIE = f"{PRODUCT_NAME.lower()}_session"

IBGE_API = "https://servicodados.ibge.gov.br/api"
