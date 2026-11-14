import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.security import token_hash
from app.config import SESSION_COOKIE
from app.db import get_db

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@dataclass
class CurrentUser:
    id: int
    name: str
    email: str
    csrf_token: str
    session_id: int


def current_user(request: Request, db: Session = Depends(get_db)) -> CurrentUser:
    """Exige sessão válida; em métodos que alteram estado, exige também o header X-CSRF-Token."""
    token = request.cookies.get(SESSION_COOKIE)
    row = None
    if token:
        row = db.execute(
            text(
                """
                SELECT u.id, u.name, u.email, s.csrf_token, s.id AS session_id
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = :h AND s.expires_at > now()
                """
            ),
            {"h": token_hash(token)},
        ).first()
    if not row:
        raise HTTPException(401, {"code": "unauthenticated", "message": "Faça login para continuar."})
    user = CurrentUser(*row)
    if request.method in UNSAFE_METHODS:
        sent = request.headers.get("x-csrf-token", "")
        if not secrets.compare_digest(sent, user.csrf_token):
            raise HTTPException(403, {"code": "csrf", "message": "Sessão expirada. Recarregue a página."})
    return user
