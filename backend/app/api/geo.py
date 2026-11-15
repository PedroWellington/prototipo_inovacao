import json
from collections import OrderedDict
from threading import Lock

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.http_cache import cached, etag_of
from app.auth.deps import current_user
from app.config import IBGE_API
from app.db import get_data_db as get_db

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


# --- Tiles vetoriais dos municípios (ranking de cidades; ver docs/PERFORMANCE.md) --------------------
# Geometria pré-simplificada por faixa de zoom (census.TOLERANCE); só id, nome, UF e população no tile: cor e número
# vêm do ranking (feature-state e fonte de pontos no frontend).
TILE_SQL = {
    col: text(
        f"""
        WITH b AS (SELECT ST_TileEnvelope(:z, :x, :y) AS env)
        SELECT ST_AsMVT(t, 'munis', 4096, 'geom', 'id') FROM (
          SELECT m.ibge AS id, m.name, m.uf, m.population, ST_AsMVTGeom({col}, b.env, 4096, 64, true) AS geom
          FROM municipalities m, b WHERE {col} && b.env
        ) t WHERE geom IS NOT NULL
        """
    )
    for col in ("geom_low", "geom_mid", "geom_high")
}
TILE_FORMAT = 2  # suba ao mudar as colunas do tile: invalida o cache do navegador (a URL leva ?v=)
_tiles: OrderedDict = OrderedDict()
_tiles_lock = Lock()
TILE_CACHE_SIZE = 4096


def tile_column(z: int) -> str:
    return "geom_low" if z <= 5 else "geom_mid" if z <= 8 else "geom_high"


@router.get("/tiles/municipalities/{z}/{x}/{y}.pbf")
def municipality_tile(request: Request, z: int = Path(ge=0, le=14), x: int = Path(ge=0), y: int = Path(ge=0),
                      db: Session = Depends(get_db)):
    if x >= 2**z or y >= 2**z:
        raise HTTPException(404, {"code": "not_found", "message": "Tile fora da grade."})
    with _tiles_lock:
        body = _tiles.get((z, x, y))
    if body is None:
        body = bytes(db.execute(TILE_SQL[tile_column(z)], {"z": z, "x": x, "y": y}).scalar() or b"")
        with _tiles_lock:
            _tiles[(z, x, y)] = body
            if len(_tiles) > TILE_CACHE_SIZE:
                _tiles.popitem(last=False)
    # O frontend pede ?v=<versão da malha>: cache longo é seguro.
    return cached(request, body, "application/vnd.mapbox-vector-tile", max_age=7 * DAY)


@router.get("/tiles/version")
def tiles_version(db: Session = Depends(get_db)):
    v = db.execute(text("SELECT done_at FROM etl_progress WHERE uf = 'BR' AND step = 'census'")).scalar()
    return {"version": f"{TILE_FORMAT}-{v.isoformat()}" if v else None}
