"""Compra de créditos: ponto único do pagamento. Modo em PAYMENTS_MODE (off | demo); preço e limites em credit_settings.

- off (padrão): a tela mostra "Compra de créditos em breve" e só registra o interesse (credit_purchase_interest).
- demo: pedido real no banco, pagamento SIMULADO (provedor "simulado"): o dono confirma num botão e os créditos entram.

Para ligar um pagamento real (Pix, Mercado Pago ou Stripe): criar um Provider com start() devolvendo a URL do
checkout do provedor, registrar em PROVIDERS e expor POST /api/billing/webhook/<nome>, que confere a assinatura
do provedor e chama mark_paid(). A tela, os pedidos, os limites e o extrato não mudam.
"""
from typing import Protocol
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text

from app import config, credits

ORDER_COLS = "id, user_id, quantity, amount_cents, status, provider, created_at, expires_at, paid_at"


class Provider(Protocol):
    name: str  # gravado em orders.provider

    def start(self, order: dict) -> str:
        """Devolve a URL do checkout do pedido (página do provedor ou a nossa, no modo demo)."""


class DemoProvider:
    name = "simulado"

    def start(self, order: dict) -> str:
        return f"/app/#/checkout/{order['id']}"


PROVIDERS: dict[str, Provider] = {"demo": DemoProvider()}


def http(status: int, code: str, message: str):
    raise HTTPException(status, {"code": code, "message": message})


def quote(db) -> dict:
    cfg = credits.settings(db)
    return {
        "mode": config.PAYMENTS_MODE,
        "unit_price_cents": cfg["credit_unit_price_cents"],
        "max_per_order": cfg["purchase_max_credits"],
        "daily_max": cfg["purchase_daily_credits"],
        "expiry_minutes": cfg["order_expiry_minutes"],
        "rules": {k: cfg[k] for k in ("city_unlock_cost", "city_unlock_days", "city_search_cost", "city_search_days")},
    }


def register_interest(db, user_id: int, quantity: int) -> None:
    """Modo off: guarda que a pessoa quer ser avisada (o e-mail já está na conta: nada é copiado)."""
    db.execute(text("INSERT INTO credit_purchase_interest (user_id, package) VALUES (:u, :p)"),
               {"u": user_id, "p": f"{quantity} créditos"})
    db.commit()


def provider() -> Provider:
    p = PROVIDERS.get(config.PAYMENTS_MODE)
    if not p:
        http(503, "payments_disabled", "Compra de créditos em breve.")
    return p


def _expire(db, user_id: int) -> None:
    db.execute(text("UPDATE orders SET status = 'canceled' WHERE user_id = :u AND status = 'pending' AND expires_at <= now()"),
               {"u": user_id})


def _bought_today(db, user_id: int, with_pending: bool) -> int:
    """Créditos pagos hoje (e, ao criar, os pendentes ainda válidos, para não abrir pedidos acima do limite)."""
    return int(db.execute(text(
        "SELECT coalesce(sum(quantity), 0) FROM orders WHERE user_id = :u AND "
        "((status = 'paid' AND paid_at >= date_trunc('day', now())) OR (:p AND status = 'pending' AND expires_at > now()))"
    ), {"u": user_id, "p": with_pending}).scalar())


def public(o, url: str | None = None) -> dict:
    out = {"id": str(o["id"]), "number": str(o["id"])[:8].upper(), "quantity": o["quantity"], "amount_cents": o["amount_cents"],
           "status": o["status"], "provider": o["provider"], "created_at": o["created_at"].isoformat(),
           "expires_at": o["expires_at"].isoformat(), "paid_at": o["paid_at"].isoformat() if o["paid_at"] else None}
    return out | ({"checkout_url": url} if url else {})


def create_order(db, user_id: int, quantity: int) -> dict:
    p = provider()
    cfg = credits.settings(db)
    if not 1 <= quantity <= cfg["purchase_max_credits"]:
        http(422, "invalid_quantity", f"Escolha de 1 a {cfg['purchase_max_credits']} créditos por pedido.")
    db.execute(text("SELECT 1 FROM users WHERE id = :u FOR UPDATE"), {"u": user_id})  # dois cliques não furam o limite
    _expire(db, user_id)
    if _bought_today(db, user_id, with_pending=True) + quantity > cfg["purchase_daily_credits"]:
        http(429, "daily_limit", f"O limite é de {cfg['purchase_daily_credits']} créditos comprados por dia. Ele volta amanhã.")
    o = db.execute(text(
        f"INSERT INTO orders (user_id, quantity, amount_cents, provider, expires_at) "
        f"VALUES (:u, :q, :amount, :prov, now() + make_interval(mins => :mins)) RETURNING {ORDER_COLS}"
    ), {"u": user_id, "q": quantity, "amount": quantity * cfg["credit_unit_price_cents"], "prov": p.name,
        "mins": cfg["order_expiry_minutes"]}).mappings().one()
    db.commit()
    return public(o, p.start(o))


def _owned(db, user_id: int, order_id: str, lock: bool = False):
    try:
        UUID(order_id)
    except ValueError:
        http(404, "not_found", "Pedido não encontrado.")
    o = db.execute(text(f"SELECT {ORDER_COLS} FROM orders WHERE id = :o{' FOR UPDATE' if lock else ''}"),
                   {"o": order_id}).mappings().first()
    if not o or o["user_id"] != user_id:  # pedido de outra conta: mesma resposta de inexistente
        http(404, "not_found", "Pedido não encontrado.")
    return o


def get_order(db, user_id: int, order_id: str) -> dict:
    _expire(db, user_id)
    db.commit()
    return public(_owned(db, user_id, order_id))


def mark_paid(db, order) -> bool:
    """Credita um pedido pendente (chamado pela confirmação simulada ou, no futuro, pelo webhook do provedor).
    Idempotente: pedido já pago não credita de novo (e o índice credit_ledger_order_once garante no banco)."""
    if order["status"] == "paid":
        return False
    db.execute(text("UPDATE orders SET status = 'paid', paid_at = now() WHERE id = :o"), {"o": order["id"]})
    db.execute(text("INSERT INTO credit_ledger (user_id, delta, reason, note, order_id) "
                    "VALUES (:u, :d, 'purchase', :n, :o)"),
               {"u": order["user_id"], "d": order["quantity"], "n": f"compra, pedido {str(order['id'])[:8].upper()}", "o": order["id"]})
    return True


def confirm_demo(db, user_id: int, order_id: str) -> dict:
    """Confirmação do pagamento SIMULADO: só o dono, só pedido pendente e válido; tudo numa transação."""
    if config.PAYMENTS_MODE != "demo":
        http(503, "payments_disabled", "Compra de créditos em breve.")
    db.execute(text("SELECT 1 FROM users WHERE id = :u FOR UPDATE"), {"u": user_id})
    o = _owned(db, user_id, order_id, lock=True)
    if o["status"] == "pending" and o["expires_at"] <= db.execute(text("SELECT now()")).scalar():
        db.execute(text("UPDATE orders SET status = 'canceled' WHERE id = :o"), {"o": o["id"]})
        db.commit()
        http(410, "order_expired", "Este pedido expirou. Volte à tela de compra e faça um novo.")
    if o["status"] == "canceled":
        http(409, "order_canceled", "Este pedido foi cancelado. Volte à tela de compra e faça um novo.")
    cfg = credits.settings(db)
    if o["status"] == "pending" and _bought_today(db, user_id, with_pending=False) + o["quantity"] > cfg["purchase_daily_credits"]:
        http(429, "daily_limit", f"O limite é de {cfg['purchase_daily_credits']} créditos comprados por dia. Ele volta amanhã.")
    credited = mark_paid(db, o)
    db.commit()
    return {"order": public(_owned(db, user_id, order_id)), "credited": credited, "balance": credits.balance(db, user_id)}
