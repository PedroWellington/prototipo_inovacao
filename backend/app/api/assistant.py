"""POST /api/assistente: pergunta ao assistente com sessão e CSRF (middleware), limites por conta e por IP.
O frontend nunca fala com o Groq. Desligado (AI_ASSISTANT_ENABLED=false) ou sem chave: 404."""

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import assistant, config
from app.auth.deps import CurrentUser, current_user
from app.auth.routes import client_ip
from app.db import get_data_db, get_db

router = APIRouter(prefix="/api/assistente", tags=["assistente"])

IP_LIMIT, IP_WINDOW = 20, 60.0  # pedidos por IP por minuto
# shortcut: em memória, por processo; zera ao reiniciar e não soma entre funções da Vercel. Trocar por tabela/Redis se houver abuso.
_hits: dict[str, deque] = defaultdict(deque)
_lock = Lock()


def ip_allowed(ip: str) -> bool:
    now = time.monotonic()
    with _lock:
        q = _hits[ip]
        while q and now - q[0] > IP_WINDOW:
            q.popleft()
        if len(q) >= IP_LIMIT:
            return False
        q.append(now)
        return True


def clear_ip_limits() -> None:  # testes
    with _lock:
        _hits.clear()


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=2000)


class AskIn(BaseModel):
    message: str = Field(min_length=1)
    history: list[Turn] = Field(default_factory=list, max_length=12)
    city: int | None = None  # tela atual (o servidor confere se a cidade está liberada para a conta)
    neighborhood: int | None = None


def err(status: int, code: str, message: str):
    raise HTTPException(status, {"code": code, "message": message})


@router.post("")
def ask(body: AskIn, request: Request, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db),
        data: Session = Depends(get_data_db)):
    if not assistant.enabled():
        err(404, "not_found", "Assistente desligado.")
    question = body.message.strip()
    if len(question) > config.AI_MAX_CHARS:
        err(422, "too_long", f"A pergunta pode ter até {config.AI_MAX_CHARS} caracteres.")
    if not ip_allowed(client_ip(request)):
        err(429, "rate_limited", "Muitas perguntas em pouco tempo. Espere um minuto e tente de novo.")
    # Conta a mensagem antes de chamar (atômico); devolve se o Groq falhar.
    used = db.execute(
        text(
            "INSERT INTO assistant_usage (user_id, day, messages) VALUES (:u, current_date, 1) "
            "ON CONFLICT (user_id, day) DO UPDATE SET messages = assistant_usage.messages + 1 "
            "WHERE assistant_usage.messages < :lim RETURNING messages"
        ),
        {"u": user.id, "lim": config.AI_DAILY_LIMIT},
    ).scalar()
    db.commit()
    if used is None:
        err(429, "daily_limit", f"Você chegou ao limite de {config.AI_DAILY_LIMIT} perguntas por dia ao assistente. Ele volta amanhã.")
    try:
        context = assistant.build_context(db, data, user.id, body.city, body.neighborhood)
        reply = assistant.answer(context, [t.model_dump() for t in body.history[-8:]], question)
    except assistant.Unavailable:
        db.execute(text("UPDATE assistant_usage SET messages = messages - 1 WHERE user_id = :u AND day = current_date"), {"u": user.id})
        db.commit()
        err(503, "assistant_unavailable", "Assistente indisponível no momento.")
    return {"reply": reply, "remaining": max(0, config.AI_DAILY_LIMIT - used)}
