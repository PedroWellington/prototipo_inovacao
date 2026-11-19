"""Login com Google: OpenID Connect (authorization code + PKCE), ID token validado aqui, nunca no navegador.

Ligado só com GOOGLE_LOGIN_ENABLED=true e GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e PUBLIC_BASE_URL definidos.
Redirect URI a cadastrar no Google Cloud Console: <PUBLIC_BASE_URL>/api/auth/google/callback.
"""
import base64
import hashlib
import secrets
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import config, credits
from app.auth.routes import start_session
from app.db import get_db

router = APIRouter(prefix="/api/auth/google", tags=["auth"])

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
OAUTH_COOKIE = f"{config.PRODUCT_NAME.lower()}_oauth"
COOKIE_PATH = "/api/auth/google"
LOGIN_PAGE = "/app/#/login"
_jwks = jwt.PyJWKClient(JWKS_URL, cache_keys=True)


def enabled() -> bool:
    return config.GOOGLE_LOGIN_ENABLED and bool(config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET and config.PUBLIC_BASE_URL)


def redirect_uri() -> str:
    return config.PUBLIC_BASE_URL.rstrip("/") + "/api/auth/google/callback"


def exchange_code(code: str, verifier: str) -> str:
    """Troca o código pelo ID token no servidor do Google (o segredo do cliente só passa por aqui)."""
    r = httpx.post(TOKEN_URL, data={
        "code": code, "client_id": config.GOOGLE_CLIENT_ID, "client_secret": config.GOOGLE_CLIENT_SECRET,
        "redirect_uri": redirect_uri(), "grant_type": "authorization_code", "code_verifier": verifier,
    }, timeout=10)
    r.raise_for_status()
    return r.json()["id_token"]


def signing_key(token: str):
    return _jwks.get_signing_key_from_jwt(token).key


def verify_id_token(token: str, nonce: str) -> dict:
    """Assinatura (JWKS do Google), aud, exp e campos obrigatórios pelo PyJWT; iss e nonce conferidos aqui."""
    try:
        claims = jwt.decode(token, signing_key(token), algorithms=["RS256"], audience=config.GOOGLE_CLIENT_ID,
                            options={"require": ["exp", "iss", "sub", "aud", "email"]})
    except (jwt.PyJWTError, ValueError) as e:
        raise ValueError(f"token: {e}") from e
    if claims["iss"] not in ISSUERS:
        raise ValueError("iss")
    if not claims.get("nonce") or not secrets.compare_digest(claims["nonce"], nonce):
        raise ValueError("nonce")
    return claims


def fail(code: str) -> RedirectResponse:
    r = RedirectResponse(f"{LOGIN_PAGE}?google={code}", status_code=303)
    r.delete_cookie(OAUTH_COOKIE, path=COOKIE_PATH)
    return r


def account_for(db: Session, claims: dict) -> int:
    """Conta já vinculada entra; e-mail existente só vincula se o Google confirmou o e-mail; senão cria a conta."""
    sub, email = claims["sub"], claims["email"].lower()
    uid = db.execute(text("SELECT id FROM users WHERE google_sub = :s"), {"s": sub}).scalar()
    if uid:
        return uid
    if not claims.get("email_verified"):
        raise ValueError("email_nao_verificado")
    row = db.execute(text("SELECT id, google_sub FROM users WHERE lower(email) = :e"), {"e": email}).first()
    if row:
        if row.google_sub:
            raise ValueError("vinculada")
        db.execute(text("UPDATE users SET google_sub = :s, email_verified = true WHERE id = :u"), {"s": sub, "u": row.id})
        return row.id
    name = (claims.get("name") or email.split("@")[0]).strip()[:120]
    uid = db.execute(
        text("INSERT INTO users (name, email, password_hash, email_verified, terms_accepted_at, google_sub) "
             "VALUES (:n, :e, NULL, true, now(), :s) RETURNING id"), {"n": name, "e": email, "s": sub},
    ).scalar_one()
    credits.welcome(db, uid)  # o mesmo do cadastro normal
    return uid


@router.get("/start")
def start():
    if not enabled():
        raise HTTPException(404, {"code": "google_login_disabled", "message": "Login com o Google indisponível."})
    state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    url = AUTH_URL + "?" + urlencode({
        "client_id": config.GOOGLE_CLIENT_ID, "redirect_uri": redirect_uri(), "response_type": "code",
        "scope": "openid email profile", "state": state, "nonce": nonce,
        "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account",
    })
    r = RedirectResponse(url, status_code=302)
    # Só este navegador tem state, nonce e verifier; valem 10 minutos e só para o callback.
    r.set_cookie(OAUTH_COOKIE, ".".join([state, nonce, verifier]), max_age=600, httponly=True, samesite="lax",
                 secure=config.IS_PRODUCTION, path=COOKIE_PATH)
    return r


@router.get("/callback")
def callback(request: Request, db: Session = Depends(get_db), code: str | None = None, state: str | None = None,
             error: str | None = None):
    if not enabled():
        raise HTTPException(404, {"code": "google_login_disabled", "message": "Login com o Google indisponível."})
    if error or not code:
        return fail("cancelado")
    parts = (request.cookies.get(OAUTH_COOKIE) or "").split(".")  # token_urlsafe nunca contém "."
    if len(parts) != 3:
        return fail("invalido")
    saved_state, nonce, verifier = parts
    if not state or not secrets.compare_digest(state, saved_state):
        return fail("invalido")
    try:
        claims = verify_id_token(exchange_code(code, verifier), nonce)
        uid = account_for(db, claims)
    except ValueError as e:
        db.rollback()
        return fail(str(e) if str(e) in ("email_nao_verificado", "vinculada") else "invalido")
    except httpx.HTTPError:
        return fail("invalido")
    r = RedirectResponse("/app/#/", status_code=303)
    r.delete_cookie(OAUTH_COOKIE, path=COOKIE_PATH)
    start_session(db, r, uid)
    return r
