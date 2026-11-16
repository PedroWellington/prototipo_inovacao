"""Comprar mais créditos: planos reais, PAYMENTS_ENABLED=false por padrão e registro do interesse."""
from sqlalchemy import text

from app.db import engine
from tests.helpers import login_new_user, seed_minimal_catalog


def test_packages_are_the_product_plans_and_payments_are_off(client):
    seed_minimal_catalog()
    login_new_user(client, "b@example.com")
    r = client.get("/api/billing/packages")
    assert r.status_code == 200
    data = r.json()
    assert data["payments_enabled"] is False
    assert [p["key"] for p in data["packages"]] == ["essencial", "profissional", "rede"]
    assert all(p["credits"] > 0 for p in data["packages"])
    assert data["rules"]["city_unlock_days"] == 30


def test_interest_is_recorded_once_per_click_and_checkout_is_closed(client):
    seed_minimal_catalog()
    csrf = login_new_user(client, "c@example.com")
    h = {"X-CSRF-Token": csrf}
    assert client.post("/api/billing/interest", json={"package": "rede"}, headers=h).status_code == 201
    assert client.post("/api/billing/interest", json={"package": "inexistente"}, headers=h).status_code == 404
    with engine.begin() as c:
        rows = c.execute(text("SELECT package FROM credit_purchase_interest i JOIN users u ON u.id = i.user_id "
                              "WHERE u.email = 'c@example.com'")).scalars().all()
    assert rows == ["rede"]
    r = client.post("/api/billing/checkout", json={"package": "rede"}, headers=h)
    assert r.status_code == 503 and r.json()["error"]["code"] == "payments_disabled"


def test_billing_requires_login(client):
    assert client.get("/api/billing/packages").status_code == 401
