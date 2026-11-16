import json

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import credits, logos
from app.auth.deps import CurrentUser, current_user
from app.config import PRODUCT_NAME, SESSION_COOKIE
from app.db import get_db

router = APIRouter(prefix="/api/account", tags=["account"])


@router.get("/export")
def export(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    """LGPD: todos os dados que guardamos sobre a conta (sem hash de senha nem tokens)."""
    q = lambda sql: [dict(r) for r in db.execute(text(sql), {"u": user.id}).mappings()]  # noqa: E731
    data = {
        "account": q("SELECT id, name, email, email_verified, google_sub IS NOT NULL AS google_linked, terms_accepted_at, created_at FROM users WHERE id = :u")[0],
        "business_profile": (q("SELECT * FROM business_profiles WHERE user_id = :u") or [None])[0],
        "criteria": q("SELECT business_type_key, direction, weight FROM profile_criteria WHERE user_id = :u ORDER BY business_type_key"),
        "sessions": q("SELECT created_at, expires_at FROM sessions WHERE user_id = :u ORDER BY created_at"),
        "credits": {
            "balance": credits.balance(db, user.id),
            "ledger": q("SELECT delta, reason, municipality_ibge, scope_key, note, created_at FROM credit_ledger WHERE user_id = :u ORDER BY id"),
            "cities": q("SELECT municipality_ibge, unlocked_at, expires_at FROM city_unlocks WHERE user_id = :u"),
            "searches": q("SELECT scope_key, unlocked_at, expires_at FROM search_unlocks WHERE user_id = :u"),
        },
    }
    return Response(
        content=json.dumps(data, ensure_ascii=False, default=str, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{PRODUCT_NAME.lower()}-meus-dados.json"'},
    )


@router.delete("")
def delete_account(response: Response, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    # ON DELETE CASCADE apaga sessões, perfil, critérios e créditos; o arquivo da logo é apagado do disco.
    logo = db.execute(text("SELECT logo_file FROM business_profiles WHERE user_id = :u"), {"u": user.id}).scalar()
    db.execute(text("DELETE FROM users WHERE id = :u"), {"u": user.id})
    db.commit()
    logos.remove(logo)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}
