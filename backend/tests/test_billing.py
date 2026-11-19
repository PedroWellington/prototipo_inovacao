"""Compra de créditos: modo off (só interesse) e demo (pedido real, pagamento SIMULADO). Nenhum serviço externo."""
import pytest
from sqlalchemy import text

from app import config
from app.billing import routes
from app.db import engine
from tests.helpers import login_new_user, seed_minimal_catalog

PRICE = 1780


@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setattr(config, "PAYMENTS_MODE", "demo")
    routes.clear_ip_limits()
    yield
    routes.clear_ip_limits()


def user(client, email):
    seed_minimal_catalog()  # zera usuários (e, em cascata, pedidos e créditos)
    return {"X-CSRF-Token": login_new_user(client, email)}


def balance(client):
    return client.get("/api/credits").json()["balance"]


def order(client, h, quantity, **extra):
    return client.post("/api/billing/orders", json={"quantity": quantity, **extra}, headers=h)


def test_off_by_default_registers_interest_only(client):
    assert config.PAYMENTS_MODE == "off"
    h = user(client, "c@example.com")
    q = client.get("/api/billing/quote").json()
    assert q["mode"] == "off" and q["unit_price_cents"] == PRICE and q["max_per_order"] == 50 and q["daily_max"] == 200
    assert client.get("/api/config").json()["payments_mode"] == "off"
    assert client.post("/api/billing/interest", json={"quantity": 10}, headers=h).status_code == 201
    with engine.begin() as c:
        assert c.execute(text("SELECT package FROM credit_purchase_interest")).scalars().all() == ["10 créditos"]
    r = order(client, h, 5)
    assert r.status_code == 503 and r.json()["error"]["code"] == "payments_disabled"


def test_create_and_confirm_credits_once(client, demo):
    h = user(client, "d@example.com")
    start = balance(client)
    r = order(client, h, 10)
    assert r.status_code == 201
    o = r.json()
    assert o["status"] == "pending" and o["amount_cents"] == 10 * PRICE and o["provider"] == "simulado"
    assert o["checkout_url"] == f"/app/#/checkout/{o['id']}" and len(o["number"]) == 8
    assert balance(client) == start  # pendente não credita
    c1 = client.post(f"/api/billing/orders/{o['id']}/confirm", headers=h).json()
    assert c1["credited"] is True and c1["order"]["status"] == "paid" and c1["balance"] == start + 10
    c2 = client.post(f"/api/billing/orders/{o['id']}/confirm", headers=h).json()  # idempotente
    assert c2["credited"] is False and c2["balance"] == start + 10 and balance(client) == start + 10
    with engine.begin() as c:
        rows = c.execute(text("SELECT delta, reason, order_id::text FROM credit_ledger WHERE reason = 'purchase'")).all()
    assert [tuple(x) for x in rows] == [(10, "purchase", o["id"])]


def test_other_account_cannot_see_or_confirm(client, demo):
    h = user(client, "dono@example.com")
    o = order(client, h, 3).json()
    client.post("/api/auth/logout", headers=h)
    h2 = {"X-CSRF-Token": login_new_user(client, "outra@example.com")}
    assert client.get(f"/api/billing/orders/{o['id']}").status_code == 404
    r = client.post(f"/api/billing/orders/{o['id']}/confirm", headers=h2)
    assert r.status_code == 404 and balance(client) == 5
    assert client.post("/api/billing/orders/nao-e-uuid/confirm", headers=h2).status_code == 404
    with engine.begin() as c:
        assert c.execute(text("SELECT status FROM orders")).scalar() == "pending"


def test_expired_order_is_canceled_and_not_credited(client, demo):
    h = user(client, "e@example.com")
    o = order(client, h, 4).json()
    with engine.begin() as c:
        c.execute(text("UPDATE orders SET expires_at = now() - interval '1 minute'"))
    r = client.post(f"/api/billing/orders/{o['id']}/confirm", headers=h)
    assert r.status_code == 410 and r.json()["error"]["code"] == "order_expired" and balance(client) == 5
    assert client.get(f"/api/billing/orders/{o['id']}").json()["status"] == "canceled"
    assert client.post(f"/api/billing/orders/{o['id']}/confirm", headers=h).status_code == 409


def test_limits_per_order_per_day_and_per_ip(client, demo, monkeypatch):
    h = user(client, "f@example.com")
    assert order(client, h, 0).status_code == 422
    assert order(client, h, 51).json()["error"]["code"] == "invalid_quantity"
    for _ in range(4):  # 4 x 50 = 200: o limite do dia
        o = order(client, h, 50).json()
        assert client.post(f"/api/billing/orders/{o['id']}/confirm", headers=h).status_code == 200
    r = order(client, h, 1)
    assert r.status_code == 429 and r.json()["error"]["code"] == "daily_limit"
    monkeypatch.setattr(routes, "IP_LIMIT", 2)
    routes.clear_ip_limits()
    codes = [order(client, h, 1).json()["error"]["code"] for _ in range(3)]
    assert codes == ["daily_limit", "daily_limit", "rate_limited"]


def test_pending_orders_count_toward_daily_limit(client, demo):
    h = user(client, "g@example.com")
    for _ in range(4):
        assert order(client, h, 50).status_code == 201
    assert order(client, h, 1).status_code == 429


def test_client_cannot_set_price_or_balance(client, demo):
    h = user(client, "h@example.com")
    r = order(client, h, 2, amount_cents=1)
    assert r.status_code == 422  # campo extra recusado: o valor é do servidor
    o = order(client, h, 2).json()
    assert o["amount_cents"] == 2 * PRICE
    assert client.patch("/api/credits", json={"balance": 999}, headers=h).status_code == 405
    assert client.post("/api/credits", json={"balance": 999}, headers=h).status_code == 405
    assert client.post(f"/api/billing/orders/{o['id']}/confirm", json={"quantity": 50}, headers=h).json()["balance"] == 7


def test_billing_requires_login_and_csrf(client, demo):
    assert client.get("/api/billing/quote").status_code == 401
    h = user(client, "i@example.com")
    assert order(client, {}, 1).status_code == 403
    assert order(client, h, 1).status_code == 201
