"""Limites intramunicipais (IBGE, Censo 2022) -> tabela neighborhoods. Idempotente (upsert por código).

- Município com bairros na Malha de Bairros: usa os bairros oficiais (kind = 'bairro').
- Município sem bairro formal: monta "áreas" a partir dos setores censitários (kind = 'area'), por distrito:
    * cada aglomerado nomeado pelo IBGE (povoado, aldeia, núcleo) vira uma área com o nome oficial;
    * os demais setores urbanos do distrito formam "<distrito> – área urbana";
    * os demais setores rurais formam "<distrito> – área rural" (massas d'água ficam de fora).
  Aliases (sem ambiguidade, documentados em docs/DATA.md): "centro" -> área urbana do distrito-sede;
  "zona rural" -> área rural, só quando o município tem uma única área rural.
"""
from collections import defaultdict
from pathlib import Path

import pyogrio
from sqlalchemy import text

from app.config import DATA_DIR
from app.etl.sources import IBGE_BAIRROS_URL, IBGE_SETORES_URL, download

# Tolerância de simplificação para o mapa: 0,0001 grau ≈ 11 m. A área usa a geometria original.
SIMPLIFY_TOLERANCE = 0.0001
WATER = "9"  # CD_SIT 9 = massas d'água


def read(path: Path, fields: list[str], munis: list[int]):
    where = "CD_MUN IN (" + ",".join(f"'{int(m)}'" for m in munis) + ")"
    meta, _, geoms, data = pyogrio.raw.read(path, columns=fields, where=where)
    names = list(meta["fields"])
    return [dict(zip(fields, (data[names.index(f)][i] for f in fields)), wkb=bytes(geoms[i])) for i in range(len(geoms))]


def bairro_rows(path: Path, munis: list[int]) -> list[dict]:
    return [
        {"mun": int(r["CD_MUN"]), "code": str(r["CD_BAIRRO"]), "name": str(r["NM_BAIRRO"]), "kind": "bairro", "aliases": [], "wkb": r["wkb"]}
        for r in read(path, ["CD_MUN", "CD_BAIRRO", "NM_BAIRRO"], munis)
    ]


def area_rows(path: Path, munis: list[int]) -> list[dict]:
    fields = ["CD_MUN", "CD_DIST", "NM_DIST", "SITUACAO", "CD_SIT", "CD_AGLOM", "NM_AGLOM"]
    rows = []
    for r in read(path, fields, munis):
        if str(r["CD_SIT"]) == WATER:
            continue
        dist, mun = str(r["CD_DIST"]), int(r["CD_MUN"])
        if r["CD_AGLOM"] and r["NM_AGLOM"]:
            code, name, part = f"{dist}-A{r['CD_AGLOM']}", str(r["NM_AGLOM"]), "aglom"
        elif r["SITUACAO"] == "Urbana":
            code, name, part = f"{dist}-U", f"{r['NM_DIST']} – área urbana", "urban"
        else:
            code, name, part = f"{dist}-R", f"{r['NM_DIST']} – área rural", "rural"
        rows.append({"mun": mun, "code": "A" + code, "name": name, "kind": "area", "part": part,
                     "is_sede": dist == f"{mun}05", "aliases": [], "wkb": r["wkb"]})
    # Aliases só quando não há ambiguidade dentro do município.
    rural_codes = defaultdict(set)
    for r in rows:
        if r["part"] == "rural":
            rural_codes[r["mun"]].add(r["code"])
    for r in rows:
        if r["part"] == "urban" and r["is_sede"]:
            r["aliases"] = ["centro"]
        elif r["part"] == "rural" and len(rural_codes[r["mun"]]) == 1:
            r["aliases"] = ["zona rural"]
    return rows


def load(conn, uf: str, munis: list[int], bairros_path: str | None = None, setores_path: str | None = None) -> dict:
    raw_dir = DATA_DIR / "raw" / "ibge"
    bp = Path(bairros_path) if bairros_path else download(IBGE_BAIRROS_URL.format(uf=uf), raw_dir / f"{uf}_bairros_CD2022.gpkg")
    rows = bairro_rows(bp, munis)
    with_bairros = {r["mun"] for r in rows}
    without = [m for m in munis if m not in with_bairros]
    if without:
        sp = Path(setores_path) if setores_path else download(IBGE_SETORES_URL.format(uf=uf), raw_dir / f"{uf}_setores_CD2022.gpkg")
        rows += area_rows(sp, without)

    conn.execute(text("CREATE TEMP TABLE raw_units (mun int, code text, name text, kind text, aliases text[], wkb bytea) ON COMMIT DROP"))
    conn.execute(
        text("INSERT INTO raw_units VALUES (:mun, :code, :name, :kind, :aliases, :wkb)"),
        [{k: r[k] for k in ("mun", "code", "name", "kind", "aliases", "wkb")} for r in rows],
    )
    # Une as feições por código. SIRGAS 2000 (4674) -> WGS 84 (4326).
    conn.execute(
        text(
            """
            WITH u AS (
              SELECT mun, code, min(name) AS name, min(kind) AS kind, max(aliases) AS aliases,
                     ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Transform(ST_Union(ST_SetSRID(ST_GeomFromWKB(wkb), 4674)), 4326)), 3)) AS geom
              FROM raw_units GROUP BY mun, code
            )
            INSERT INTO neighborhoods (municipality_ibge, ibge_code, name, name_normalized, kind, aliases, geom,
                                       geom_simplified, label_point, area_km2, source, source_date)
            SELECT mun, code, name, norm_text(name), kind, aliases, geom,
                   ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(geom, :tol)), 3)),
                   ST_PointOnSurface(geom), ST_Area(geom::geography) / 1e6,
                   CASE kind WHEN 'bairro' THEN 'ibge_bairros' ELSE 'ibge_setores' END, '2022'
            FROM u
            ON CONFLICT (ibge_code) DO UPDATE SET
              name = EXCLUDED.name, name_normalized = EXCLUDED.name_normalized, kind = EXCLUDED.kind,
              aliases = EXCLUDED.aliases, geom = EXCLUDED.geom, geom_simplified = EXCLUDED.geom_simplified,
              label_point = EXCLUDED.label_point, area_km2 = EXCLUDED.area_km2, source = EXCLUDED.source
            """
        ),
        {"tol": SIMPLIFY_TOLERANCE},
    )
    conn.execute(
        text(
            "DELETE FROM neighborhoods n WHERE n.municipality_ibge = ANY(:m) "
            "AND NOT EXISTS (SELECT 1 FROM raw_units r WHERE r.code = n.ibge_code)"
        ),
        {"m": munis},
    )
    return {"with_bairros": len(with_bairros), "with_areas": len(without), "units": len({(r["mun"], r["code"]) for r in rows})}
