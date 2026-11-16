"""Login com Google sem rede: a troca do código e a chave de assinatura são substituídas; o resto é o fluxo real."""
import time
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text

from app import config, credits
from app.auth import google
from app.db import engine

KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
OTHER_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC_PEM = KEY.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
CLIENT_ID = "123-teste.apps.googleusercontent.com"


def make_token(nonce, key=KEY, **over):
    claims = {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "sub-ana-1", "email": "ana@example.com",
              "email_verified": True, "name": "Ana Lima", "nonce": nonce, "iat": int(time.time()), "exp": int(time.time()) + 300}
    claims.update(over)
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "k1"})


@pytest.fixture(autouse=True)
def google_on(monkeypatch):
    with engine.begin() as c:
        c.execute(text("TRUNCATE users CASCADE"))
    monkeypatch.setattr(config, "GOOGLE_LOGIN_ENABLED", True)
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "segredo")
    monkeypatch.setattr(config, "PUBLIC_BASE_URL", "https://vircus-nu.vercel.app/")
    monkeypatch.setattr(google, "signing_key", lambda token: PUBLIC_PEM)


def start(client):
    r = client.get("/api/auth/google/start", follow_redirects=False)
    assert r.status_code == 302
    q = parse_qs(urlparse(r.headers["location"]).query)
    state, nonce, _verifier = client.cookies[google.OAUTH_COOKIE].split(".")
    assert q["state"] == [state] and q["nonce"] == [nonce] and q["code_challenge_method"] == ["S256"]
    assert q["redirect_uri"] == ["https://vircus-nu.vercel.app/api/auth/google/callback"]
    return state, nonce


def finish(client, monkeypatch, token_for_nonce, state=None):
    s, nonce = start(client)
    monkeypatch.setattr(google, "exchange_code", lambda code, verifier: token_for_nonce(nonce))
    return client.get("/api/auth/google/callback", params={"code": "abc", "state": state or s}, follow_redirects=False)


def users():
    with engine.connect() as c:
        return [dict(r) for r in c.execute(text("SELECT id, email, google_sub, password_hash, email_verified FROM users")).mappings()]


def balance(email):
    with engine.connect() as c:
        return credits.balance(c, c.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email}).scalar())


def test_disabled_without_keys(client, monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_CLIENT_SECRET", "")
    assert client.get("/api/config").json()["google_login"] is False
    assert client.get("/api/auth/google/start", follow_redirects=False).status_code == 404


def test_new_account_gets_session_and_one_credit_once(client, monkeypatch):
    assert client.get("/api/config").json()["google_login"] is True
    r = finish(client, monkeypatch, make_token)
    assert r.status_code == 303 and r.headers["location"] == "/app/#/"
    assert "httponly" in r.headers["set-cookie"].lower()
    me = client.get("/api/auth/me").json()
    assert me["email"] == "ana@example.com" and me["name"] == "Ana Lima" and me["csrf_token"]
    [u] = users()
    assert u["google_sub"] == "sub-ana-1" and u["password_hash"] is None and u["email_verified"] is True
    assert balance("ana@example.com") == 1
    # Entrar de novo: mesma conta, nenhum crédito a mais; e a senha vazia não entra pelo login normal.
    r = finish(client, monkeypatch, make_token)
    assert r.status_code == 303 and len(users()) == 1 and balance("ana@example.com") == 1
    assert client.post("/api/auth/login", json={"email": "ana@example.com", "password": "qualquer-coisa"}).status_code == 401


def test_invalid_signature_is_refused(client, monkeypatch):
    r = finish(client, monkeypatch, lambda n: make_token(n, key=OTHER_KEY))
    assert r.status_code == 303 and r.headers["location"].endswith("?google=invalido") and users() == []


def test_wrong_nonce_wrong_audience_and_state_are_refused(client, monkeypatch):
    assert finish(client, monkeypatch, lambda n: make_token("outro-nonce")).headers["location"].endswith("?google=invalido")
    assert finish(client, monkeypatch, lambda n: make_token(n, aud="outro-cliente")).headers["location"].endswith("?google=invalido")
    assert finish(client, monkeypatch, lambda n: make_token(n, exp=int(time.time()) - 10)).headers["location"].endswith("?google=invalido")
    assert finish(client, monkeypatch, make_token, state="state-forjado").headers["location"].endswith("?google=invalido")
    assert users() == [] and client.get("/api/auth/me").status_code == 401


def test_existing_password_account_links_only_with_verified_email(client, monkeypatch):
    client.post("/api/auth/register", json={"name": "Ana", "email": "ana@example.com", "password": "senha-forte-1", "accept_terms": True})
    client.post("/api/auth/logout", headers={"X-CSRF-Token": client.get("/api/auth/me").json()["csrf_token"]})
    r = finish(client, monkeypatch, lambda n: make_token(n, email_verified=False))
    assert r.headers["location"].endswith("?google=email_nao_verificado")
    [u] = users()
    assert u["google_sub"] is None and client.get("/api/auth/me").status_code == 401
    r = finish(client, monkeypatch, make_token)
    assert r.status_code == 303 and r.headers["location"] == "/app/#/"
    [u] = users()
    assert u["google_sub"] == "sub-ana-1" and u["password_hash"].startswith("$argon2id$")
    assert balance("ana@example.com") == 1  # o crédito do cadastro não é dado de novo ao vincular


def test_email_already_linked_to_another_google_account(client, monkeypatch):
    finish(client, monkeypatch, make_token)
    client.post("/api/auth/logout", headers={"X-CSRF-Token": client.get("/api/auth/me").json()["csrf_token"]})
    r = finish(client, monkeypatch, lambda n: make_token(n, sub="sub-outra-pessoa"))
    assert r.headers["location"].endswith("?google=vinculada") and len(users()) == 1


def test_cancel_and_lgpd_for_google_account(client, monkeypatch):
    start(client)
    r = client.get("/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert r.headers["location"].endswith("?google=cancelado")
    finish(client, monkeypatch, make_token)
    csrf = client.get("/api/auth/me").json()["csrf_token"]
    exported = client.get("/api/account/export").json()
    assert exported["account"]["google_linked"] is True and exported["credits"]["balance"] == 1
    assert client.delete("/api/account", headers={"X-CSRF-Token": csrf}).status_code == 200
    assert users() == []
