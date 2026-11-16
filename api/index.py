"""Função Python da Vercel: toda a API FastAPI (/api/*) numa função só, mesmo domínio do site. Ver docs/DEPLOY.md.

A Vercel reescreve /api/:path* para esta função (vercel.json) e expõe o objeto ASGI `app`.
O código fica em backend/app; as dependências de produção estão no requirements.txt da raiz.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.main import app  # noqa: E402, F401
