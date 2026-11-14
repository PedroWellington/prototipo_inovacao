import os
from pathlib import Path

ENV = os.getenv("ENV", "development")
IS_PRODUCTION = ENV == "production"
DATABASE_URL = os.environ["DATABASE_URL"]
DATA_DIR = Path(os.getenv("DATA_DIR", "/data"))
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "168"))
PRODUCT_NAME = os.environ["PRODUCT_NAME"]  # definido só no .env
SESSION_COOKIE = f"{PRODUCT_NAME.lower()}_session"

IBGE_API = "https://servicodados.ibge.gov.br/api"
