from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.http_cache import cached
from app.api.profile import CriteriaIn
from app.auth.deps import current_user
from app.db import get_db
from app.scoring.rank import NO_DATA, rank

router = APIRouter(prefix="/api/cities", tags=["cities"], dependencies=[Depends(current_user)])


@router.get("/{ibge}/status")
def status(ibge: int, request: Request, db: Session = Depends(get_db)):
    row = db.execute(
        text(
            """
            SELECT m.ibge, m.name, m.uf, s.loaded_at, s.reference_month, s.neighborhoods, s.total_active, s.located,
                   s.located_exact, s.located_alias, s.located_trigram, s.division_kind
            FROM municipalities m LEFT JOIN city_data_status s ON s.municipality_ibge = m.ibge WHERE m.ibge = :m
            """
        ),
        {"m": ibge},
    ).mappings().first()
    if not row:
        raise HTTPException(404, {"code": "not_found", "message": "Cidade não encontrada."})
    has_data = row["loaded_at"] is not None
    body = {
        "ibge": row["ibge"],
        "name": row["name"],
        "uf": row["uf"],
        "has_data": has_data,
        "message": None if has_data else NO_DATA.format(item="estabelecimentos"),
    }
    if has_data:
        body |= {
            "loaded_at": row["loaded_at"].isoformat(),
            "reference_month": row["reference_month"],
            "neighborhoods": row["neighborhoods"],
            "division_kind": row["division_kind"],
            "coverage": {
                "total_active": row["total_active"],
                "located": row["located"],
                "located_exact": row["located_exact"],
                "located_alias": row["located_alias"],
                "located_trigram": row["located_trigram"],
                "share": round(row["located"] / row["total_active"], 4) if row["total_active"] else 0,
            },
        }
    return cached(request, body, max_age=0)


@router.get("/{ibge}/neighborhoods.geojson")
def neighborhoods_geojson(ibge: int, request: Request, db: Session = Depends(get_db)):
    # Geometria simplificada (ver docs/PERFORMANCE.md), 5 casas decimais (~1 m), id para juntar com o ranking.
    # O frontend pede ?v=<loaded_at>: o cache longo é seguro porque a URL muda quando a cidade é recarregada.
    body = db.execute(
        text(
            """
            SELECT json_build_object('type', 'FeatureCollection', 'features', coalesce(json_agg(json_build_object(
              'type', 'Feature', 'id', id,
              'properties', json_build_object('id', id, 'name', name,
                                              'lx', round(ST_X(label_point)::numeric, 5), 'ly', round(ST_Y(label_point)::numeric, 5)),
              'geometry', ST_AsGeoJSON(geom_simplified, 5)::json) ORDER BY id), '[]'))::text
            FROM neighborhoods WHERE municipality_ibge = :m
            """
        ),
        {"m": ibge},
    ).scalar()
    return cached(request, body, "application/geo+json", max_age=86400)


@router.post("/{ibge}/rank")
def rank_city(ibge: int, body: CriteriaIn, db: Session = Depends(get_db)):
    result = rank(db, ibge, [c.model_dump() for c in body.criteria])
    if result["status"] == "not_found":
        raise HTTPException(404, {"code": "not_found", "message": result["message"]})
    return result
