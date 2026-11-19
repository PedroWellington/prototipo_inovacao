import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app import billing
from app.auth.deps import CurrentUser, current_user
from app.auth.routes import client_ip
from app.db import get_db

router = APIRouter(prefix="/api/billing", tags=["billing"])

# Pedidos por minuto por IP (por processo, como o limite do assistente e do relatório).
IP_LIMIT, IP_WINDOW = 10, 60
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


class QuantityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")  # o cliente manda só a quantidade: nada de valor nem saldo
    quantity: int = Field(ge=1, le=1000)


@router.get("/quote")
def quote(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    return billing.quote(db)


@router.post("/interest", status_code=201)
def interest(body: QuantityIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    billing.register_interest(db, user.id, body.quantity)
    return {"ok": True}


@router.post("/orders", status_code=201)
def create_order(body: QuantityIn, request: Request, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    if not ip_allowed(client_ip(request)):
        raise HTTPException(429, {"code": "rate_limited", "message": "Muitos pedidos em pouco tempo. Espere um minuto e tente de novo."})
    return billing.create_order(db, user.id, body.quantity)


@router.get("/orders/{order_id}")
def get_order(order_id: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    return billing.get_order(db, user.id, order_id)


@router.post("/orders/{order_id}/confirm")
def confirm(order_id: str, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    return billing.confirm_demo(db, user.id, order_id)
