from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import logos
from app.config import UPLOADS_ENABLED
from app.api.http_cache import etag_of
from app.auth.deps import CurrentUser, current_user
from app.db import get_db

router = APIRouter(prefix="/api/profile", tags=["profile"])

# Faixas de faturamento anual. Só armazenadas: nenhuma entra no ranking (ver docs/SCORING.md).
RevenueBand = Literal["ate_81k", "81k_360k", "360k_4_8m", "4_8m_30m", "30m_200m", "acima_200m", "nao_informar"]
MAX_PER_DIRECTION = 3


class Criterion(BaseModel):
    business_type_key: str = Field(min_length=1, max_length=40)
    direction: Literal["attract", "repel"]
    weight: int = Field(ge=1, le=5)


class CriteriaIn(BaseModel):
    criteria: list[Criterion] = Field(max_length=2 * MAX_PER_DIRECTION)

    @model_validator(mode="after")
    def check_limits(self):
        keys = [c.business_type_key for c in self.criteria]
        if len(keys) != len(set(keys)):
            raise ValueError("Um tipo de estabelecimento só pode aparecer uma vez (perto ou longe).")
        for d in ("attract", "repel"):
            if sum(c.direction == d for c in self.criteria) > MAX_PER_DIRECTION:
                raise ValueError(f"No máximo {MAX_PER_DIRECTION} tipos em cada lista (perto e longe).")
        return self


class ProfileIn(CriteriaIn):
    company_name: str | None = Field(default=None, max_length=80)
    segment_key: str = Field(max_length=40)
    segment_other_text: str | None = Field(default=None, max_length=120)
    revenue_band: RevenueBand
    has_hq: bool
    hq_uf: str | None = Field(default=None, min_length=2, max_length=2)
    hq_municipality_ibge: int | None = None
    hq_neighborhood_text: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def check_fields(self):
        if self.segment_key == "outro" and not (self.segment_other_text or "").strip():
            raise ValueError("Descreva o ramo da empresa.")
        if self.has_hq and not (self.hq_uf and self.hq_municipality_ibge):
            raise ValueError("Informe o estado e a cidade da sede.")
        if not self.has_hq:
            self.hq_uf = self.hq_municipality_ibge = self.hq_neighborhood_text = None
        return self


def bad_request(message: str):
    raise HTTPException(422, {"code": "validation_error", "message": message})


def validate_references(db: Session, body: CriteriaIn, profile: ProfileIn | None = None) -> None:
    keys = {c.business_type_key for c in body.criteria}
    known = {r[0] for r in db.execute(text("SELECT key FROM business_types WHERE selectable AND key = ANY(:k)"), {"k": list(keys)})}
    if keys - known:
        bad_request("Tipo de estabelecimento desconhecido: " + ", ".join(sorted(keys - known)))
    if profile is None:
        return
    if not db.execute(text("SELECT 1 FROM segments WHERE key = :k"), {"k": profile.segment_key}).first():
        bad_request("Ramo desconhecido.")
    if profile.has_hq and not db.execute(
        text("SELECT 1 FROM municipalities WHERE ibge = :m AND uf = upper(:uf)"),
        {"m": profile.hq_municipality_ibge, "uf": profile.hq_uf},
    ).first():
        bad_request("A cidade da sede não pertence ao estado informado.")


def save_criteria(db: Session, user_id: int, criteria: list[Criterion]) -> None:
    db.execute(text("DELETE FROM profile_criteria WHERE user_id = :u"), {"u": user_id})
    if criteria:
        db.execute(
            text("INSERT INTO profile_criteria VALUES (:u, :business_type_key, :direction, :weight)"),
            [{"u": user_id, **c.model_dump()} for c in criteria],
        )


@router.get("")
def get_profile(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    profile = db.execute(
        text(
            """
            SELECT p.company_name, p.segment_key, p.segment_other_text, p.revenue_band, p.has_hq, p.hq_uf,
                   p.hq_municipality_ibge, p.hq_neighborhood_text, p.onboarding_completed_at,
                   s.name AS segment_name, m.name AS hq_city_name,
                   CASE WHEN p.logo_file IS NOT NULL
                        THEN '/api/profile/logo?v=' || extract(epoch FROM p.logo_updated_at)::bigint END AS logo_url
            FROM business_profiles p
            LEFT JOIN segments s ON s.key = p.segment_key
            LEFT JOIN municipalities m ON m.ibge = p.hq_municipality_ibge
            WHERE p.user_id = :u
            """
        ),
        {"u": user.id},
    ).mappings().first()
    criteria = db.execute(
        text(
            "SELECT business_type_key, direction, weight FROM profile_criteria "
            "WHERE user_id = :u ORDER BY direction, business_type_key"
        ),
        {"u": user.id},
    ).mappings().all()
    return {"profile": dict(profile) if profile else None, "criteria": [dict(c) for c in criteria]}


@router.put("")
def put_profile(body: ProfileIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    """Salva o onboarding inteiro e marca como concluído."""
    validate_references(db, body, body)
    fields = body.model_dump(exclude={"criteria"})
    fields["hq_uf"] = fields["hq_uf"].upper() if fields["hq_uf"] else None
    fields["company_name"] = (fields["company_name"] or "").strip() or None
    db.execute(
        text(
            """
            INSERT INTO business_profiles (user_id, company_name, segment_key, segment_other_text, revenue_band, has_hq, hq_uf,
                                           hq_municipality_ibge, hq_neighborhood_text, onboarding_completed_at)
            VALUES (:u, :company_name, :segment_key, :segment_other_text, :revenue_band, :has_hq, :hq_uf,
                    :hq_municipality_ibge, :hq_neighborhood_text, now())
            ON CONFLICT (user_id) DO UPDATE SET company_name = EXCLUDED.company_name,
              segment_key = EXCLUDED.segment_key, segment_other_text = EXCLUDED.segment_other_text,
              revenue_band = EXCLUDED.revenue_band, has_hq = EXCLUDED.has_hq, hq_uf = EXCLUDED.hq_uf,
              hq_municipality_ibge = EXCLUDED.hq_municipality_ibge,
              hq_neighborhood_text = EXCLUDED.hq_neighborhood_text,
              onboarding_completed_at = coalesce(business_profiles.onboarding_completed_at, now()),
              updated_at = now()
            """
        ),
        {"u": user.id, **fields},
    )
    save_criteria(db, user.id, body.criteria)
    db.commit()
    return get_profile(user, db)


@router.put("/criteria")
def put_criteria(body: CriteriaIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    """Usado pelo explorador ao ajustar pesos e critérios."""
    validate_references(db, body)
    save_criteria(db, user.id, body.criteria)
    db.commit()
    return {"criteria": [c.model_dump() for c in body.criteria]}


# --- Logo/foto da empresa (opcional) ------------------------------------------------------------------
# Corpo bruto da requisição (sem multipart). Validação e recodificação em app/logos.py.


@router.put("/logo")
async def put_logo(request: Request, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    if not UPLOADS_ENABLED:
        raise HTTPException(503, {"code": "uploads_disabled", "message": "O envio de imagem está desligado neste protótipo."})
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > logos.MAX_BYTES:
        logos.too_large()
    data = bytearray()
    async for chunk in request.stream():  # para de ler assim que passa do limite
        data += chunk
        if len(data) > logos.MAX_BYTES:
            logos.too_large()
    webp = logos.process(bytes(data))
    name = logos.save(webp)
    old = db.execute(text("SELECT logo_file FROM business_profiles WHERE user_id = :u"), {"u": user.id}).scalar()
    db.execute(
        text(
            "INSERT INTO business_profiles (user_id, logo_file, logo_updated_at) VALUES (:u, :f, now()) "
            "ON CONFLICT (user_id) DO UPDATE SET logo_file = EXCLUDED.logo_file, logo_updated_at = now(), updated_at = now()"
        ),
        {"u": user.id, "f": name},
    )
    db.commit()
    logos.remove(old)
    return get_profile(user, db)


@router.delete("/logo")
def delete_logo(user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    old = db.execute(text("SELECT logo_file FROM business_profiles WHERE user_id = :u"), {"u": user.id}).scalar()
    db.execute(text("UPDATE business_profiles SET logo_file = NULL, logo_updated_at = NULL WHERE user_id = :u"), {"u": user.id})
    db.commit()
    logos.remove(old)
    return get_profile(user, db)


@router.get("/logo")
def get_logo(request: Request, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    name = db.execute(text("SELECT logo_file FROM business_profiles WHERE user_id = :u"), {"u": user.id}).scalar()
    p = logos.path(name) if name else None
    if not p or not p.exists():
        raise HTTPException(404, {"code": "not_found", "message": "Sem imagem."})
    body = p.read_bytes()
    headers = {
        "ETag": etag_of(body),
        "Cache-Control": "private, max-age=31536000, immutable",  # a URL muda (?v=) quando a imagem muda
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Disposition": 'inline; filename="logo.webp"',
    }
    if request.headers.get("if-none-match") == headers["ETag"]:
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="image/webp", headers=headers)
