from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.http_cache import cached
from app.api.profile import CriteriaIn
from app import credits
from app.auth.deps import CurrentUser, current_user
from app.db import get_db
from app.scoring.rank import NO_DATA, income_block, income_source, rank
from app.scoring.rank_cities import rank_cities

router = APIRouter(prefix="/api/cities", tags=["cities"], dependencies=[Depends(current_user)])


class IncomeCriterion(BaseModel):
    direction: Literal["attract", "repel"]  # attract = poder de compra acima; repel = abaixo
    weight: int = Field(ge=1, le=5)


class CityRankIn(CriteriaIn):
    region_id: int | None = Field(default=None, ge=1, le=5)
    uf: str | None = Field(default=None, min_length=2, max_length=2)
    normalization: Literal["population", "area"] = "population"
    min_population: int = Field(default=20000, ge=0, le=15_000_000)
    income: IncomeCriterion | None = None


@router.post("/rank")
def rank_cities_endpoint(body: CityRankIn, request: Request, user: CurrentUser = Depends(current_user),
                         db: Session = Depends(get_db)):
    """Ranking de cidades no alcance (Brasil, região ou UF) pelos mesmos critérios do perfil. Exige a busca liberada."""
    credits.require_search(db, user.id, credits.scope_key(None if body.uf else body.region_id, body.uf))
    out, gz = rank_cities(
        db,
        region=None if body.uf else body.region_id,
        uf=body.uf.upper() if body.uf else None,
        criteria=[c.model_dump() for c in body.criteria],
        normalization=body.normalization,
        min_population=body.min_population,
        income=body.income.model_dump() if body.income else None,
    )
    if gz and "gzip" in request.headers.get("accept-encoding", ""):
        # já comprimido no cache; com Content-Encoding o GZipMiddleware não recomprime
        return Response(gz, media_type="application/json", headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return Response(out, media_type="application/json")


@router.get("/{ibge}/status")
def status(ibge: int, request: Request, db: Session = Depends(get_db)):
    row = db.execute(
        text(
            """
            WITH q AS (  -- quartis da renda mediana entre os municípios da mesma UF
              SELECT percentile_cont(ARRAY[0.25, 0.5, 0.75]) WITHIN GROUP (ORDER BY income_median) AS q
              FROM municipalities WHERE uf = (SELECT uf FROM municipalities WHERE ibge = :m) AND income_median IS NOT NULL
            )
            SELECT m.ibge, m.name, m.uf, s.loaded_at, s.reference_month, s.neighborhoods, s.total_active, s.located,
                   s.located_exact, s.located_alias, s.located_trigram, s.division_kind,
                   m.population, m.area_km2, m.income_median,
                   CASE WHEN m.income_median IS NULL THEN NULL WHEN m.income_median <= q.q[1] THEN 1
                        WHEN m.income_median <= q.q[2] THEN 2 WHEN m.income_median <= q.q[3] THEN 3 ELSE 4 END AS income_quartile
            FROM municipalities m LEFT JOIN city_data_status s ON s.municipality_ibge = m.ibge CROSS JOIN q WHERE m.ibge = :m
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
        "population": row["population"],
        "area_km2": round(row["area_km2"], 1) if row["area_km2"] else None,
        "income": income_block(row["income_median"], row["income_quartile"], "das cidades do estado", False, income_source(db)),
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
def neighborhoods_geojson(ibge: int, request: Request, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    credits.require_city(db, user.id, ibge)  # o mapa de bairros é a análise paga
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
def rank_city(ibge: int, body: CriteriaIn, user: CurrentUser = Depends(current_user), db: Session = Depends(get_db)):
    credits.require_city(db, user.id, ibge)
    result = rank(db, ibge, [c.model_dump() for c in body.criteria])
    if result["status"] == "not_found":
        raise HTTPException(404, {"code": "not_found", "message": result["message"]})
    return result
