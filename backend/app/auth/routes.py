from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import credits
from app.auth import rate_limit
from app.auth.deps import CurrentUser, current_user
from app.auth.security import hash_password, new_token, token_hash, verify_password
from app.config import IS_PRODUCTION, SESSION_COOKIE, SESSION_TTL_HOURS
from app.db import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])

# TODO(fora do escopo): verificação de e-mail, redefinição de senha e login com Google (OAuth).
# Ganchos descritos em docs/EXTENSIONS.md; a coluna users.email_verified já existe.


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=256)
    accept_terms: bool


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


def start_session(db: Session, response: Response, user_id: int) -> None:
    token = new_token()
    db.execute(
        text(
            "INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at) "
            "VALUES (:u, :h, :c, now() + :ttl)"
        ),
        {"u": user_id, "h": token_hash(token), "c": new_token(), "ttl": timedelta(hours=SESSION_TTL_HOURS)},
    )
    db.commit()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_TTL_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=IS_PRODUCTION,
        path="/",
    )


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/register", status_code=201)
def register(body: RegisterIn, response: Response, db: Session = Depends(get_db)):
    if not body.accept_terms:
        raise HTTPException(422, {"code": "terms_required", "message": "É preciso aceitar os Termos de uso e a Política de privacidade."})
    try:
        user_id = db.execute(
            text(
                "INSERT INTO users (name, email, password_hash, terms_accepted_at) "
                "VALUES (:n, :e, :p, now()) RETURNING id"
            ),
            {"n": body.name.strip(), "e": body.email.lower(), "p": hash_password(body.password)},
        ).scalar_one()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, {"code": "email_taken", "message": "Já existe uma conta com este e-mail. Tente entrar."})
    # Todo cadastro novo ganha a cidade grátis (valor em credit_settings).
    credits.grant(db, user_id, credits.settings(db)["signup_grant"], "cadastro", reason="signup")
    start_session(db, response, user_id)
    return {"ok": True}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request)
    if rate_limit.is_blocked(ip, body.email):
        raise HTTPException(429, {"code": "too_many_attempts", "message": "Muitas tentativas. Aguarde 15 minutos e tente de novo."})
    row = db.execute(
        text("SELECT id, password_hash FROM users WHERE lower(email) = lower(:e)"), {"e": body.email}
    ).first()
    if not verify_password(row.password_hash if row else None, body.password):
        rate_limit.register_failure(ip, body.email)
        # Mensagem genérica: não revela se o e-mail existe.
        raise HTTPException(401, {"code": "invalid_credentials", "message": "E-mail ou senha incorretos."})
    rate_limit.reset(ip, body.email)
    start_session(db, response, row.id)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM sessions WHERE id = :s"), {"s": user.session_id})
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    completed = db.execute(
        text("SELECT onboarding_completed_at IS NOT NULL FROM business_profiles WHERE user_id = :u"), {"u": user.id}
    ).scalar()
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "csrf_token": user.csrf_token,
        "onboarding_completed": bool(completed),
    }
