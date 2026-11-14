from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import credits
from app.auth.deps import CurrentUser, current_user
from app.db import get_db

router = APIRouter(prefix="/api/credits", tags=["credits"])
PLAN = "Gratuito"  # sem pagamento nesta etapa (docs/EXTENSIONS.md)


class SearchIn(BaseModel):
    region_id: int | None = Field(default=None, ge=1, le=5)
    uf: str | None = Field(default=None, min_length=2, max_length=2)


def state(db: Session, user_id: int) -> dict:
    """Saldo, regras e "Minhas análises" (cidades e buscas, com os dias que faltam)."""
    cfg = credits.settings(db)
    cities = db.execute(
        text(
            """
            SELECT u.municipality_ibge AS ibge, m.name, m.uf, u.unlocked_at, u.expires_at, u.expires_at > now() AS active,
                   greatest(0, ceil(extract(epoch FROM u.expires_at - now()) / 86400))::int AS days_left
            FROM city_unlocks u JOIN municipalities m ON m.ibge = u.municipality_ibge
            WHERE u.user_id = :u ORDER BY u.expires_at > now() DESC, u.unlocked_at DESC
            """
        ),
        {"u": user_id},
    ).mappings().all()
    searches = db.execute(
        text(
            """
            SELECT s.scope_key, coalesce(st.name, r.name, 'Brasil') AS label, s.unlocked_at, s.expires_at,
                   s.expires_at > now() AS active,
                   greatest(0, ceil(extract(epoch FROM s.expires_at - now()) / 86400))::int AS days_left
            FROM search_unlocks s
            LEFT JOIN states st ON st.uf = s.scope_key
            LEFT JOIN regions r ON 'R' || r.id = s.scope_key
            WHERE s.user_id = :u ORDER BY s.expires_at > now() DESC, s.unlocked_at DESC
            """
        ),
        {"u": user_id},
    ).mappings().all()
    iso = lambda r: {**r, "unlocked_at": r["unlocked_at"].isoformat(), "expires_at": r["expires_at"].isoformat()}  # noqa: E731
    return {
        "balance": credits.balance(db, user_id),
        "plan": PLAN,
        "rules": {k: cfg[k] for k in ("city_unlock_cost", "city_unlock_days", "city_search_cost", "city_search_days")},
        "cities": [iso(dict(r)) for r in cities],
        "searches": [iso(dict(r)) for r in searches],
    }


@router.get("")
def get_credits(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    return state(db, user.id)


@router.post("/cities/{ibge}")
def unlock_city(ibge: int, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    """Gasta o crédito da cidade (ou não cobra, se ela já está liberada). A confirmação é mostrada antes, no frontend."""
    r = credits.unlock_city(db, user.id, ibge)
    return {**r, "state": state(db, user.id)}


@router.post("/searches")
def unlock_search(body: SearchIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    key = credits.scope_key(None if body.uf else body.region_id, body.uf)
    r = credits.unlock_search(db, user.id, key)
    return {**r, "scope_key": key, "state": state(db, user.id)}
