"""Dados do relatório: os 5 bairros que mais combinam com os critérios da tela, só de fonte própria.

Nada é estimado: sem valor no banco, o campo vem como None e o PDF escreve a mensagem padrão (NO_DATA).
O ranking é o mesmo motor do explorador (app.scoring.rank); aqui só se juntam população, área, concorrência,
pontos de referência e distância em linha reta (PostGIS). Google: app/report/google_routes.py.
"""
import hashlib
import json
import unicodedata
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.scoring.rank import NO_DATA, rank

TOP = 5
TZ = ZoneInfo("America/Sao_Paulo")
REVENUE_LABEL = {
    "ate_81k": "até R$ 81 mil por ano", "81k_360k": "de R$ 81 mil a R$ 360 mil por ano",
    "360k_4_8m": "de R$ 360 mil a R$ 4,8 milhões por ano", "4_8m_30m": "de R$ 4,8 milhões a R$ 30 milhões por ano",
    "30m_200m": "de R$ 30 milhões a R$ 200 milhões por ano", "acima_200m": "acima de R$ 200 milhões por ano",
    "nao_informar": "não informado",
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


def params_code(ibge: int, criteria: list[dict], data_version: str) -> str:
    """Código curto e reproduzível: mesma cidade, mesmos critérios e mesma base = mesmo código."""
    crit = sorted((c["business_type_key"], c["direction"], int(c["weight"])) for c in criteria)
    h = hashlib.sha256(json.dumps([ibge, crit, data_version]).encode()).hexdigest()[:10].upper()
    return f"{h[:5]}-{h[5:]}"


def profile(db: Session, user_id: int) -> dict:
    p = db.execute(
        text(
            "SELECT p.company_name, p.segment_key, p.segment_other_text, p.revenue_band, p.has_hq, "
            "p.hq_municipality_ibge, p.hq_neighborhood_text, s.name AS segment_name "
            "FROM business_profiles p LEFT JOIN segments s ON s.key = p.segment_key WHERE p.user_id = :u"
        ),
        {"u": user_id},
    ).mappings().first()
    return dict(p) if p else {}


POINTS_SQL = text(
    """
    SELECT n.id, n.area_km2, n.population, n.population_method,
           CASE WHEN n.population IS NOT NULL AND n.area_km2 > 0 THEN round((n.population / n.area_km2)::numeric) END AS pop_density,
           ST_Y(p.pt) AS lat, ST_X(p.pt) AS lng,
           CASE WHEN CAST(:hlat AS float8) IS NOT NULL THEN
             round((ST_Distance(p.pt::geography, ST_SetSRID(ST_MakePoint(:hlng, :hlat), 4326)::geography) / 1000)::numeric, 1) END AS straight_km,
           CASE WHEN CAST(:comp AS text) IS NOT NULL THEN coalesce(t.n_establishments, 0) END AS comp_n,
           CASE WHEN CAST(:comp AS text) IS NOT NULL AND n.area_km2 > 0 THEN round((coalesce(t.n_establishments, 0) / n.area_km2)::numeric, 2) END AS comp_density
    FROM neighborhoods n
    CROSS JOIN LATERAL (SELECT ST_PointOnSurface(n.geom_simplified) AS pt) p
    LEFT JOIN neighborhood_type_counts t ON t.neighborhood_id = n.id AND t.business_type_key = :comp
    WHERE n.id = ANY(:ids)
    """
)


def hq_point(data: Session, prof: dict, ibge: int) -> dict | None:
    """Ponto da sede: o bairro informado, se casar com um bairro da cidade da sede; senão o ponto da cidade."""
    if not prof.get("has_hq") or not prof.get("hq_municipality_ibge"):
        return None
    m = prof["hq_municipality_ibge"]
    city = data.execute(text("SELECT name, uf, ST_Y(label_point) AS lat, ST_X(label_point) AS lng FROM municipalities WHERE ibge = :m"),
                        {"m": m}).mappings().first()
    if not city:
        return None
    want = norm(prof.get("hq_neighborhood_text") or "")
    if want:
        for r in data.execute(
            text("SELECT id, name, ST_Y(ST_PointOnSurface(geom_simplified)) AS lat, ST_X(ST_PointOnSurface(geom_simplified)) AS lng "
                 "FROM neighborhoods WHERE municipality_ibge = :m"), {"m": m}
        ).mappings():
            if norm(r["name"]) == want:
                return {"lat": r["lat"], "lng": r["lng"], "precision": "bairro", "neighborhood_id": r["id"],
                        "label": f"{r['name']}, {city['name']} – {city['uf']}"}
    if city["lat"] is None:
        return None
    return {"lat": city["lat"], "lng": city["lng"], "precision": "cidade", "neighborhood_id": None,
            "label": f"{city['name']} – {city['uf']}",
            "note": "O bairro da sede não foi encontrado no limite do IBGE; a distância usa um ponto dentro da cidade da sede."}


def city_facts(data: Session, ibge: int) -> dict:
    r = data.execute(
        text("SELECT m.population, m.area_km2, s.located_exact, s.located_alias, s.located_trigram, s.loaded_at "
             "FROM municipalities m LEFT JOIN city_data_status s ON s.municipality_ibge = m.ibge WHERE m.ibge = :m"),
        {"m": ibge},
    ).mappings().first()
    return dict(r) if r else {}


def build(db: Session, data: Session, user_id: int, ibge: int, criteria: list[dict], top: int = TOP,
          ids: list[int] | None = None) -> dict:
    """ids: bairros escolhidos (roteiro); sem ids, os `top` primeiros do ranking."""
    r = rank(data, ibge, criteria)
    if r["status"] == "not_found":
        raise HTTPException(404, {"code": "not_found", "message": r["message"]})
    if r["status"] != "ok":
        raise HTTPException(409, {"code": r["status"], "message": r["message"]})
    if ids:
        by_id = {n["id"]: n for n in r["neighborhoods"]}
        if any(i not in by_id for i in ids):
            raise HTTPException(422, {"code": "validation_error", "message": "Escolha bairros do ranking desta cidade."})
        chosen = [by_id[i] for i in ids]
    else:
        chosen = r["neighborhoods"][:top]

    prof = profile(db, user_id)
    comp_key = None
    if prof.get("segment_key"):
        comp_key = data.execute(text("SELECT competitor_type_key FROM segments WHERE key = :k"), {"k": prof["segment_key"]}).scalar()
    comp_type = None
    if comp_key:
        comp_type = data.execute(
            text("SELECT key, name, name_plural, source FROM business_types WHERE key = :k"), {"k": comp_key}
        ).mappings().first()
        comp_key = comp_key if comp_type else None
    hq = hq_point(data, prof, ibge)
    pts = {
        p["id"]: p
        for p in data.execute(
            POINTS_SQL,
            {"ids": [n["id"] for n in chosen], "comp": comp_key, "hlat": hq["lat"] if hq else None, "hlng": hq["lng"] if hq else None},
        ).mappings()
    }
    types = {c["business_type_key"]: c for c in r["criteria"]}
    hoods = []
    for n in chosen:
        p = pts[n["id"]]
        hoods.append({
            **n,
            "area_km2": round(p["area_km2"], 2) if p["area_km2"] else None,
            "population": p["population"],
            "population_method": p["population_method"],
            "pop_density": int(p["pop_density"]) if p["pop_density"] is not None else None,
            "point": {"lat": p["lat"], "lng": p["lng"]},
            "straight_km": float(p["straight_km"]) if p["straight_km"] is not None else None,
            "competition": None if comp_key is None else {"n": p["comp_n"], "density_per_km2": float(p["comp_density"]) if p["comp_density"] is not None else None},
            "criteria": [{**c, "name_plural": types[c["type"]]["name_plural"], "precision": types[c["type"]]["precision"]} for c in n["criteria"]],
        })

    now = datetime.now(TZ)
    facts = city_facts(data, ibge)
    return {
        "city": {**r["city"], "population": facts.get("population"), "area_km2": facts.get("area_km2")},
        "division_kind": r["division_kind"],
        "unit": "áreas" if r["division_kind"] == "area" else "bairros",
        "count": r["count"],
        "criteria": r["criteria"],
        "neighborhoods": hoods,
        "excluded": r["excluded"],
        "city_coverage": {**r["city_coverage"], "located_exact": facts.get("located_exact"),
                          "located_alias": facts.get("located_alias"), "located_trigram": facts.get("located_trigram")},
        "sources": r["sources"],
        "reference_dates": r["reference_dates"],
        "company": {
            "name": prof.get("company_name"),
            "segment": prof.get("segment_other_text") if prof.get("segment_key") == "outro" else prof.get("segment_name"),
            "revenue": REVENUE_LABEL.get(prof.get("revenue_band") or "", "não informado"),
        },
        "competitor": dict(comp_type) if comp_type else None,
        "competition_missing": None if comp_type else NO_DATA.format(item="concorrência"),
        "hq": hq,
        "params_code": params_code(ibge, criteria, r["data_version"]),
        "data_version": r["data_version"],
        "generated_at": now.isoformat(timespec="minutes"),
        "generated_label": now.strftime("%d/%m/%Y às %H:%M"),
        "date": now.strftime("%Y-%m-%d"),
    }


def city_shapes(data: Session, ibge: int) -> dict:
    """Bairros da cidade em Web Mercator, com origem no canto superior esquerdo (metros; y para baixo), para os mapas
    SVG do PDF (sem tiles nem imagem externa). Simplificação de ~1/900 da maior dimensão: invisível no A4."""
    rows = data.execute(
        text(
            """
            WITH g AS (
              SELECT id, ST_Transform(geom_simplified, 3857) AS g, ST_Transform(label_point, 3857) AS lp
              FROM neighborhoods WHERE municipality_ibge = :m
            ), e AS (SELECT ST_Extent(g) AS b FROM g), t AS (
              SELECT ST_XMin(b) AS x0, ST_YMax(b) AS y1, ST_XMax(b) - ST_XMin(b) AS w, ST_YMax(b) - ST_YMin(b) AS h,
                     greatest(ST_XMax(b) - ST_XMin(b), ST_YMax(b) - ST_YMin(b)) / 900 AS tol FROM e
            )
            SELECT g.id, ST_AsSVG(ST_Translate(ST_SimplifyPreserveTopology(g.g, t.tol), -t.x0, -t.y1), 0, 0) AS d,
                   ST_X(g.lp) - t.x0 AS lx, t.y1 - ST_Y(g.lp) AS ly, t.w, t.h
            FROM g CROSS JOIN t ORDER BY g.id
            """
        ),
        {"m": ibge},
    ).mappings().all()
    if not rows:
        return {"w": 0, "h": 0, "paths": []}
    return {"w": rows[0]["w"], "h": rows[0]["h"],
            "paths": [{"id": r["id"], "d": r["d"], "label": (r["lx"], r["ly"])} for r in rows if r["d"]]}
