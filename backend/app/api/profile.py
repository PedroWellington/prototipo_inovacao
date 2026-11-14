from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

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
            SELECT segment_key, segment_other_text, revenue_band, has_hq, hq_uf, hq_municipality_ibge,
                   hq_neighborhood_text, onboarding_completed_at
            FROM business_profiles WHERE user_id = :u
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
    db.execute(
        text(
            """
            INSERT INTO business_profiles (user_id, segment_key, segment_other_text, revenue_band, has_hq, hq_uf,
                                           hq_municipality_ibge, hq_neighborhood_text, onboarding_completed_at)
            VALUES (:u, :segment_key, :segment_other_text, :revenue_band, :has_hq, :hq_uf,
                    :hq_municipality_ibge, :hq_neighborhood_text, now())
            ON CONFLICT (user_id) DO UPDATE SET
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
