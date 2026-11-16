"""Cobrança: ponto único para plugar um gateway (Stripe ou Mercado Pago) depois.

Hoje PAYMENTS_ENABLED=false: a tela "Comprar mais créditos" lista os planos e guarda o interesse em
credit_purchase_interest. Quando o gateway entrar, só checkout() e o webhook mudam; o webhook concede
os créditos com credits.grant(reason="grant", note=<id do pagamento>), como docs/EXTENSIONS.md descreve.

Planos: os do PDF do produto (seção 8), preços previstos, a validar com clientes. Não há pacote avulso de
créditos definido ainda.
"""
from fastapi import HTTPException
from sqlalchemy import text

from app import config, credits

PACKAGES = [
    {"key": "essencial", "name": "Essencial", "credits": 5, "price_brl": 89, "period": "mês", "note": "Ranking de bairros."},
    {"key": "profissional", "name": "Profissional", "credits": 20, "price_brl": 249, "period": "mês", "note": "Ranking de bairros e de cidades."},
    {"key": "rede", "name": "Rede", "credits": 100, "price_brl": 790, "period": "mês", "note": "Ranking de bairros e de cidades."},
]
KEYS = {p["key"] for p in PACKAGES}


def packages(db) -> dict:
    cfg = credits.settings(db)
    return {
        "payments_enabled": config.PAYMENTS_ENABLED,
        "packages": PACKAGES,
        "rules": {k: cfg[k] for k in ("city_unlock_cost", "city_unlock_days", "city_search_cost", "city_search_days")},
    }


def check_package(key: str) -> None:
    if key not in KEYS:
        raise HTTPException(404, {"code": "not_found", "message": "Plano não encontrado."})


def register_interest(db, user_id: int, package: str) -> None:
    """Guarda que a pessoa quer ser avisada (o e-mail já está na conta: nada é copiado)."""
    check_package(package)
    db.execute(text("INSERT INTO credit_purchase_interest (user_id, package) VALUES (:u, :p)"), {"u": user_id, "p": package})
    db.commit()


def checkout(db, user_id: int, package: str) -> dict:
    """Gancho do gateway: devolve {"url": ...} da sessão de pagamento. Sem gateway configurado, 501."""
    check_package(package)
    if not config.PAYMENTS_ENABLED:
        raise HTTPException(503, {"code": "payments_disabled", "message": "Pagamento ainda não disponível."})
    raise HTTPException(501, {"code": "gateway_missing", "message": "Gateway de pagamento ainda não configurado."})
