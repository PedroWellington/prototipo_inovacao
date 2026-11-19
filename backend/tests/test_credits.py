"""Créditos: o servidor é a única autoridade. 1 crédito = 1 cidade por 30 dias; busca de cidades = 1 crédito por alcance."""
import threading

from fastapi import HTTPException
from sqlalchemy import text

from app import credits
from app.db import SessionLocal, engine
from tests.helpers import grant, login_new_user, seed_minimal_catalog

RECIFE, OLINDA, SEM_DADOS = 2611606, 2609600, 2600054
CRIT = {"criteria": [{"business_type_key": "farmacia", "direction": "attract", "weight": 3}]}


def setup_module():
    seed_minimal_catalog()
    with engine.begin() as c:
        for ibge, name in ((OLINDA, "Olinda"), (SEM_DADOS, "Abreu e Lima")):
            c.execute(text("INSERT INTO municipalities (ibge, name, name_normalized, uf) VALUES (:m, :n, norm_text(:n), 'PE') "
                           "ON CONFLICT DO NOTHING"), {"m": ibge, "n": name})
        c.execute(text("DELETE FROM city_data_status"))
        for ibge in (RECIFE, OLINDA):  # Abreu e Lima fica sem dados de propósito
            c.execute(text("INSERT INTO city_data_status VALUES (:m, now(), '2026-10', 0, 0, 0, 0, 0, '[]')"), {"m": ibge})


def teardown_module():
    with engine.begin() as c:
        c.execute(text("UPDATE credit_settings SET value = 5 WHERE key = 'signup_credits'"))


def fresh(client, email, welcome=1):
    seed_minimal_catalog()  # zera usuários (e, em cascata, créditos)
    setup_module()
    with engine.begin() as c:  # créditos de boas-vindas do cadastro (os testes de gasto partem de 1)
        c.execute(text("UPDATE credit_settings SET value = :v WHERE key = 'signup_credits'"), {"v": welcome})
    return login_new_user(client, email)


def post(client, csrf, url, json=None):
    return client.post(url, json=json, headers={"X-CSRF-Token": csrf})


def test_signup_grants_welcome_credits_once(client):
    fresh(client, "a@example.com", welcome=5)  # padrão da migration
    st = client.get("/api/credits").json()
    assert st["balance"] == 5 and "plan" not in st and st["used"] == 0
    assert st["rules"] == {"city_unlock_cost": 1, "city_unlock_days": 30, "city_search_cost": 1, "city_search_days": 30}
    assert st["cities"] == [] and st["searches"] == []
    with SessionLocal() as db:
        uid = db.execute(text("SELECT id FROM users WHERE email = 'a@example.com'")).scalar()
        credits.welcome(db, uid)  # segunda vez (ex.: repetição do cadastro): não credita de novo
        db.commit()
        rows = db.execute(text("SELECT delta, note FROM credit_ledger WHERE user_id = :u AND reason = 'signup'"), {"u": uid}).all()
        assert [tuple(r) for r in rows] == [(5, "boas-vindas")] and credits.balance(db, uid) == 5
    fresh(client, "a2@example.com", welcome=7)  # o valor vem de credit_settings
    assert client.get("/api/credits").json()["balance"] == 7


def test_unlock_spends_once_and_reopening_is_free(client):
    csrf = fresh(client, "b@example.com")
    r = post(client, csrf, f"/api/credits/cities/{RECIFE}").json()
    assert r["charged"] == 1 and r["balance"] == 0
    city = r["state"]["cities"][0]
    assert city["ibge"] == RECIFE and city["active"] and city["days_left"] == 30
    again = post(client, csrf, f"/api/credits/cities/{RECIFE}").json()
    assert again["charged"] == 0 and again["balance"] == 0  # reabrir dentro do prazo não gasta
    assert post(client, csrf, f"/api/cities/{RECIFE}/rank", CRIT).status_code == 200


def test_without_balance_nothing_is_spent(client):
    csrf = fresh(client, "c@example.com")
    post(client, csrf, f"/api/credits/cities/{RECIFE}")
    r = post(client, csrf, f"/api/credits/cities/{OLINDA}")
    assert r.status_code == 402 and r.json()["error"]["code"] == "no_credits"
    assert "restam 0" in r.json()["error"]["message"]
    st = client.get("/api/credits").json()
    assert st["balance"] == 0 and st["used"] == 1 and [c["ibge"] for c in st["cities"]] == [RECIFE]


def test_validity_is_30_days_then_charges_again(client):
    csrf = fresh(client, "d@example.com")
    post(client, csrf, f"/api/credits/cities/{RECIFE}")
    with engine.begin() as c:  # simula 31 dias depois
        c.execute(text("UPDATE city_unlocks SET unlocked_at = now() - interval '31 days', expires_at = now() - interval '1 day'"))
    assert post(client, csrf, f"/api/cities/{RECIFE}/rank", CRIT).status_code == 402
    assert client.get("/api/credits").json()["cities"][0]["active"] is False
    assert post(client, csrf, f"/api/credits/cities/{RECIFE}").status_code == 402  # vencida e sem saldo
    grant("d@example.com", 1)
    r = post(client, csrf, f"/api/credits/cities/{RECIFE}").json()
    assert r["charged"] == 1 and r["state"]["cities"][0]["days_left"] == 30


def test_frontend_cannot_bypass(client):
    csrf = fresh(client, "e@example.com")
    # sem liberar: ranking e mapa de bairros recusados no servidor, mesmo chamando a API direto
    assert post(client, csrf, f"/api/cities/{RECIFE}/rank", CRIT).status_code == 402
    assert client.get(f"/api/cities/{RECIFE}/neighborhoods.geojson").status_code == 402
    assert post(client, csrf, "/api/cities/rank", {**CRIT, "uf": "PE"}).status_code == 402
    # campos inventados no corpo não mudam o preço
    r = post(client, csrf, f"/api/credits/cities/{RECIFE}", {"cost": 0, "charged": 0, "balance": 99}).json()
    assert r["charged"] == 1 and r["balance"] == 0
    # cidade sem dados não cobra
    grant("e@example.com", 1)
    r = post(client, csrf, f"/api/credits/cities/{SEM_DADOS}")
    assert r.status_code == 409 and client.get("/api/credits").json()["balance"] == 1
    # sem CSRF não gasta
    assert client.post(f"/api/credits/cities/{OLINDA}").status_code == 403
    assert client.get("/api/credits").json()["balance"] == 1


def test_city_search_costs_one_per_scope(client):
    csrf = fresh(client, "f@example.com")
    grant("f@example.com", 1)
    r = post(client, csrf, "/api/credits/searches", {"uf": "pe"}).json()
    assert r["charged"] == 1 and r["scope_key"] == "PE" and r["balance"] == 1
    assert post(client, csrf, "/api/credits/searches", {"uf": "PE"}).json()["charged"] == 0  # mesma busca, de graça
    assert post(client, csrf, "/api/cities/rank", {**CRIT, "uf": "PE", "min_population": 0}).status_code == 200
    assert post(client, csrf, "/api/cities/rank", {**CRIT, "region_id": 2}).status_code == 402  # outro alcance
    r = post(client, csrf, "/api/credits/searches", {"region_id": 2}).json()
    assert r["charged"] == 1 and r["balance"] == 0 and r["scope_key"] == "R2"
    labels = {s["scope_key"]: s["label"] for s in r["state"]["searches"]}
    assert labels == {"PE": "Pernambuco", "R2": "Nordeste"}


def test_simultaneous_clicks_spend_only_once():
    seed_minimal_catalog()
    setup_module()
    with engine.begin() as c:
        uid = c.execute(text("INSERT INTO users (name, email, password_hash, terms_accepted_at) "
                             "VALUES ('X', 'x@example.com', 'x', now()) RETURNING id")).scalar()
        credits.grant(c, uid, 1, "teste")
    results = []

    def spend(ibge):
        with SessionLocal() as db:
            try:
                results.append(credits.unlock_city(db, uid, ibge)["charged"])
            except HTTPException as e:
                results.append(e.status_code)

    threads = [threading.Thread(target=spend, args=(m,)) for m in (RECIFE, OLINDA)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [1, 402]  # um gasta, o outro encontra saldo 0
    with engine.connect() as c:
        assert credits.balance(c, uid) == 0
