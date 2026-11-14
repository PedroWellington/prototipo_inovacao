from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.http_cache import cached
from app.db import get_db

router = APIRouter(prefix="/api/catalog", tags=["catalog"])


@router.get("/segments")
def segments(request: Request, db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT key, name FROM segments ORDER BY sort")).mappings().all()
    return cached(request, [dict(r) for r in rows])


@router.get("/business-types")
def business_types(request: Request, db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            """
            SELECT t.key, t.name, t.name_plural, t.precision, t.note,
                   coalesce(json_agg(json_build_object('cnae', c.cnae, 'description', c.description, 'verified', c.verified)
                                     ORDER BY c.cnae) FILTER (WHERE c.cnae IS NOT NULL), '[]') AS cnaes
            FROM business_types t LEFT JOIN business_type_cnae c ON c.business_type_key = t.key
            WHERE t.selectable
            GROUP BY t.key ORDER BY t.name
            """
        )
    ).mappings().all()
    return cached(request, [dict(r) for r in rows])


@router.get("/segments/{key}/defaults")
def segment_defaults(key: str, request: Request, db: Session = Depends(get_db)):
    if not db.execute(text("SELECT 1 FROM segments WHERE key = :k"), {"k": key}).first():
        raise HTTPException(404, {"code": "not_found", "message": "Segmento não encontrado."})
    rows = db.execute(
        text(
            "SELECT business_type_key, direction, weight FROM segment_defaults "
            "WHERE segment_key = :k ORDER BY direction, business_type_key"
        ),
        {"k": key},
    ).mappings().all()
    return cached(request, [dict(r) for r in rows])
