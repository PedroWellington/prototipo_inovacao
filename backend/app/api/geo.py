import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.http_cache import cached, etag_of
from app.auth.deps import current_user
from app.config import IBGE_API
from app.db import get_db

router = APIRouter(prefix="/api/geo", tags=["geo"], dependencies=[Depends(current_user)])

GEOJSON = "application/geo+json"
DAY = 86400


@router.get("/regions")
def regions(request: Request, db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT id, sigla, name FROM regions ORDER BY id")).mappings().all()
    return cached(request, [dict(r) for r in rows], max_age=DAY)


@router.get("/states")
def states(request: Request, region: int | None = None, db: Session = Depends(get_db)):
    rows = db.execute(
        text(
            "SELECT ibge AS id, uf, name, region_id FROM states "
            "WHERE CAST(:r AS smallint) IS NULL OR region_id = :r ORDER BY name"
        ),
        {"r": region},
    ).mappings().all()
    return cached(request, [dict(r) for r in rows], max_age=DAY)


@router.get("/municipalities")
def municipalities(request: Request, uf: str = Query(min_length=2, max_length=2), db: Session = Depends(get_db)):
    # has_data muda quando uma cidade é carregada: cache curto e revalidado por ETag.
    rows = db.execute(
        text(
            """
            SELECT m.ibge AS id, m.name, (s.municipality_ibge IS NOT NULL) AS has_data
            FROM municipalities m LEFT JOIN city_data_status s ON s.municipality_ibge = m.ibge
            WHERE m.uf = upper(:uf) ORDER BY m.name
            """
        ),
        {"uf": uf},
    ).mappings().all()
    return cached(request, [dict(r) for r in rows], max_age=0)


# --- Malhas do IBGE (API v3), guardadas em geo_cache na primeira consulta -------------------------


def fetch_ibge_mesh(path: str, intra: str) -> dict:
    r = httpx.get(
        f"{IBGE_API}/v3/malhas/{path}",
        params={"formato": "application/vnd.geo+json", "qualidade": "minima", "intrarregiao": intra},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def with_properties(fc: dict, props_by_code: dict[int, dict]) -> str:
    """Troca o 'codarea' do IBGE por propriedades úteis ao mapa (id numérico para feature-state)."""
    features = []
    for f in fc["features"]:
        code = int(f["properties"]["codarea"])
        if code in props_by_code:
            features.append({"type": "Feature", "id": code, "properties": props_by_code[code], "geometry": f["geometry"]})
    return json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))


def get_or_fetch(db: Session, key: str, build) -> str:
    row = db.execute(text("SELECT geojson FROM geo_cache WHERE key = :k"), {"k": key}).first()
    if row:
        return row[0]
    try:
        body = build()
    except httpx.HTTPError as e:
        raise HTTPException(502, {"code": "ibge_unavailable", "message": "Não foi possível obter a malha do IBGE agora."}) from e
    db.execute(
        text("INSERT INTO geo_cache (key, geojson, etag) VALUES (:k, :g, :e) ON CONFLICT (key) DO NOTHING"),
        {"k": key, "g": body, "e": etag_of(body.encode())},
    )
    db.commit()
    return body


def regions_geojson(db: Session) -> str:
    props = {r.id: {"id": r.id, "name": r.name} for r in db.execute(text("SELECT id, name FROM regions"))}
    return get_or_fetch(db, "regions", lambda: with_properties(fetch_ibge_mesh("paises/BR", "regiao"), props))


def states_geojson(db: Session) -> str:
    rows = db.execute(text("SELECT ibge, uf, name, region_id FROM states"))
    props = {r.ibge: {"id": r.ibge, "uf": r.uf, "name": r.name, "region_id": r.region_id} for r in rows}
    return get_or_fetch(db, "states", lambda: with_properties(fetch_ibge_mesh("paises/BR", "UF"), props))


def municipalities_geojson(db: Session, uf: str) -> str:
    uf = uf.upper()
    rows = db.execute(text("SELECT ibge, name FROM municipalities WHERE uf = :uf"), {"uf": uf})
    props = {r.ibge: {"id": r.ibge, "name": r.name} for r in rows}
    if not props:
        raise HTTPException(404, {"code": "not_found", "message": "Estado não encontrado."})
    return get_or_fetch(db, f"municipalities:{uf}", lambda: with_properties(fetch_ibge_mesh(f"estados/{uf}", "municipio"), props))


@router.get("/regions.geojson")
def regions_geo(request: Request, db: Session = Depends(get_db)):
    return cached(request, regions_geojson(db), GEOJSON, max_age=DAY)


@router.get("/states.geojson")
def states_geo(request: Request, db: Session = Depends(get_db)):
    return cached(request, states_geojson(db), GEOJSON, max_age=DAY)


@router.get("/municipalities.geojson")
def municipalities_geo(request: Request, uf: str = Query(min_length=2, max_length=2), db: Session = Depends(get_db)):
    return cached(request, municipalities_geojson(db, uf), GEOJSON, max_age=DAY)
