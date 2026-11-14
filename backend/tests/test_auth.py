import pytest
from sqlalchemy import text

from app.auth import rate_limit

USER = {"name": "Ana", "email": "ana@example.com", "password": "senha-forte-1", "accept_terms": True}


@pytest.fixture(autouse=True)
def clean_users():
    from app.db import engine

    with engine.begin() as c:
        c.execute(text("TRUNCATE users CASCADE"))
    rate_limit.clear_all()


def register(client, **overrides):
    return client.post("/api/auth/register", json={**USER, **overrides})


def test_register_sets_httponly_cookie_and_hashes_with_argon2id(client):
    r = register(client)
    assert r.status_code == 201
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie

    from app.db import engine

    with engine.connect() as c:
        pw_hash = c.execute(text("SELECT password_hash FROM users")).scalar_one()
        token_hash = c.execute(text("SELECT token_hash FROM sessions")).scalar_one()
    assert pw_hash.startswith("$argon2id$")
    assert len(token_hash) == 64 and client.cookies["locus_session"] not in token_hash

    me = client.get("/api/auth/me").json()
    assert me["email"] == USER["email"] and me["csrf_token"] and me["onboarding_completed"] is False


def test_register_validation(client):
    assert register(client, password="curta").status_code == 422
    assert register(client, accept_terms=False).status_code == 422
    assert register(client).status_code == 201
    assert register(client, email="ANA@example.com").status_code == 409


def test_login_generic_error_and_rate_limit(client):
    register(client)
    client.cookies.clear()
    wrong = client.post("/api/auth/login", json={"email": USER["email"], "password": "errada-123"})
    unknown = client.post("/api/auth/login", json={"email": "ninguem@example.com", "password": "errada-123"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()  # não revela se o e-mail existe

    for _ in range(rate_limit.MAX_FAILURES - 1):
        client.post("/api/auth/login", json={"email": USER["email"], "password": "errada-123"})
    blocked = client.post("/api/auth/login", json={"email": USER["email"], "password": USER["password"]})
    assert blocked.status_code == 429


def test_login_then_csrf_required_for_logout(client):
    register(client)
    client.cookies.clear()
    assert client.post("/api/auth/login", json={"email": USER["email"], "password": USER["password"]}).status_code == 200
    csrf = client.get("/api/auth/me").json()["csrf_token"]
    assert client.post("/api/auth/logout").status_code == 403
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_protected_routes_require_session(client):
    assert client.get("/api/geo/regions").status_code == 401
    assert client.get("/api/account/export").status_code == 401


def test_export_and_delete_account(client):
    register(client)
    csrf = client.get("/api/auth/me").json()["csrf_token"]
    export = client.get("/api/account/export").json()
    assert export["account"]["email"] == USER["email"] and "password_hash" not in str(export)

    assert client.delete("/api/account").status_code == 403  # sem CSRF
    assert client.delete("/api/account", headers={"X-CSRF-Token": csrf}).status_code == 200
    from app.db import engine

    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM users")).scalar() == 0
        assert c.execute(text("SELECT count(*) FROM sessions")).scalar() == 0
