"""Censo 2022 do Brasil inteiro: população, área e renda dos municípios, renda de bairros/setores e malha municipal.

    docker compose run --rm backend python -m app.etl.census          # roda também dentro de load_br
Fontes e regras em docs/DATA.md. Sigilo ("X") e ausência (".") viram nulo: nunca estimamos valor.
"""
import csv
import io
import zipfile
from pathlib import Path

import pyogrio
from sqlalchemy import text

from app.config import DATA_DIR
from app.etl.sources import (
    IBGE_CENSO_BASICO_MUN_URL,
    IBGE_MALHA_MUNICIPIOS_URL,
    IBGE_RENDA_BAIRROS_URL,
    IBGE_RENDA_MUN_URL,
    IBGE_RENDA_SETORES_URL,
    download,
)

RAW = DATA_DIR / "raw" / "ibge"
# Tolerâncias de simplificação (metros, Web Mercator) por faixa de zoom dos tiles; ver docs/PERFORMANCE.md.
TOLERANCE = {"geom_low": 1500, "geom_mid": 250, "geom_high": 30}


def fetch(url: str, folder: Path) -> Path:
    return download(url, folder / url.rsplit("/", 1)[1])


def read_csv_zip(path: Path):
    with zipfile.ZipFile(path) as z:
        with z.open(z.namelist()[0]) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, "latin-1"), delimiter=";")


def number(v: str | None):
    """'1.234,5' não ocorre nestes arquivos: o decimal é ',' (municípios) ou '.' (setores), sem separador de milhar."""
    v = (v or "").strip()
    if v in ("", "X", "x", "."):
        return None
    return float(v.replace(",", "."))


def load_municipal(conn) -> dict:
    basico = fetch(IBGE_CENSO_BASICO_MUN_URL, RAW / "censo2022")
    renda = fetch(IBGE_RENDA_MUN_URL, RAW / "censo2022")
    rows = {int(r["CD_MUN"]): {"m": int(r["CD_MUN"]), "pop": number(r["v0001"]), "area": number(r["AREA_KM2"])} for r in read_csv_zip(basico)}
    for r in read_csv_zip(renda):
        m = int(r["CD_MUN"])
        if m in rows:
            rows[m] |= {"inc": number(r["V06006"]), "hh": number(r["V06001"])}
    params = [{"inc": None, "hh": None, **v} for v in rows.values()]
    conn.execute(
        text(
            "UPDATE municipalities SET population = CAST(:pop AS int), area_km2 = :area, income_median = :inc, "
            "income_households = CAST(:hh AS int) WHERE ibge = :m"
        ),
        params,
    )
    return {"municipalities": len(params), "with_income": sum(p["inc"] is not None for p in params)}


def load_income_units(conn) -> dict:
    conn.execute(text("TRUNCATE census_income"))
    out = {}
    for level, url, code_col in (("setor", IBGE_RENDA_SETORES_URL, "CD_SETOR"), ("bairro", IBGE_RENDA_BAIRROS_URL, "CD_BAIRRO")):
        by_code: dict[str, dict] = {}
        dup = set()
        for r in read_csv_zip(fetch(url, RAW / "censo2022")):
            code = r[code_col]
            dup |= {code} if code in by_code else set()
            by_code[code] = {"l": level, "c": code, "h": number(r["V06001"]), "v": number(r["V06006"])}
        # Código repetido com valores diferentes no arquivo do IBGE (ex.: 3205200069): não escolhemos um; fica nulo.
        for code in dup:
            by_code[code] |= {"h": None, "v": None}
        conn.execute(text("INSERT INTO census_income VALUES (:l, :c, CAST(:h AS int), :v)"), list(by_code.values()))
        out[level] = len(by_code)
        out[f"{level}_duplicated"] = sorted(dup)
    return out


def load_municipal_geometry(conn) -> int:
    path = fetch(IBGE_MALHA_MUNICIPIOS_URL, RAW)
    meta, _, geoms, data = pyogrio.raw.read(f"/vsizip/{path}", columns=["CD_MUN"])
    codes = data[list(meta["fields"]).index("CD_MUN")]
    conn.execute(text("CREATE TEMP TABLE raw_mun (ibge int, wkb bytea) ON COMMIT DROP"))
    conn.execute(text("INSERT INTO raw_mun VALUES (:m, :w)"), [{"m": int(c), "w": bytes(g)} for c, g in zip(codes, geoms)])
    sets = ", ".join(
        f"{col} = ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(g.geom, {tol})), 3))"
        for col, tol in TOLERANCE.items()
    )
    # SIRGAS 2000 (4674) -> Web Mercator (3857) para os tiles; ponto do número da posição em WGS 84.
    return conn.execute(
        text(
            f"""
            WITH g AS (
              SELECT ibge, ST_Transform(ST_MakeValid(ST_SetSRID(ST_GeomFromWKB(wkb), 4674)), 3857) AS geom FROM raw_mun
            )
            UPDATE municipalities m SET {sets}, label_point = ST_Transform(ST_PointOnSurface(g.geom), 4326)
            FROM g WHERE g.ibge = m.ibge
            """
        )
    ).rowcount


def update_neighborhood_income(conn, munis: list[int]) -> dict:
    """Bairro da malha do IBGE: mediana publicada para o bairro. Área: média das medianas dos setores, ponderada pelos
    responsáveis com valor (aproximado). Sem nenhum setor com valor: nulo ("indisponível")."""
    p = {"m": munis}
    conn.execute(
        text("UPDATE neighborhoods SET income_median = NULL, income_households = NULL, income_method = NULL WHERE municipality_ibge = ANY(:m)"),
        p,
    )
    bairro = conn.execute(
        text(
            """
            UPDATE neighborhoods n SET income_median = ci.median, income_households = ci.households, income_method = 'ibge_bairro'
            FROM census_income ci
            WHERE n.municipality_ibge = ANY(:m) AND n.kind = 'bairro' AND ci.level = 'bairro' AND ci.code = n.ibge_code
              AND ci.median IS NOT NULL
            """
        ),
        p,
    ).rowcount
    area = conn.execute(
        text(
            """
            WITH a AS (
              SELECT t.unit_code, sum(ci.median * ci.households) / sum(ci.households) AS median, sum(ci.households)::int AS hh
              FROM census_tracts t JOIN census_income ci ON ci.level = 'setor' AND ci.code = t.code
              WHERE t.municipality_ibge = ANY(:m) AND ci.median IS NOT NULL AND ci.households > 0
              GROUP BY t.unit_code
            )
            UPDATE neighborhoods n SET income_median = round(a.median, 2), income_households = a.hh, income_method = 'setores'
            FROM a WHERE n.ibge_code = a.unit_code AND n.municipality_ibge = ANY(:m)
            """
        ),
        p,
    ).rowcount
    return {"bairro": bairro, "area": area}


def save_sources(conn) -> None:
    sources = [
        ("ibge_censo_renda", "IBGE, Censo Demográfico 2022, Agregados por Setores Censitários: Rendimento do Responsável",
         "https://ftp.ibge.gov.br/Censos/Censo_Demografico_2022/Agregados_por_Setores_Censitarios_Rendimento_do_Responsavel/", "2022 (publicado em 08/05/2026)"),
        ("ibge_censo_basico", "IBGE, Censo Demográfico 2022, Agregados por municípios (básico): população e área",
         IBGE_CENSO_BASICO_MUN_URL, "2022 (publicado em 20/05/2026)"),
        ("ibge_malha_municipal", "IBGE, Malha Municipal 2022", IBGE_MALHA_MUNICIPIOS_URL, "2022"),
    ]
    conn.execute(
        text(
            "INSERT INTO data_sources VALUES (:k, :n, :u, :d, NULL) "
            "ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, reference_date = EXCLUDED.reference_date"
        ),
        [{"k": k, "n": n, "u": u, "d": d} for k, n, u, d in sources],
    )


def load_national(conn) -> dict:
    out = {**load_municipal(conn), "units": load_income_units(conn), "geometries": load_municipal_geometry(conn)}
    save_sources(conn)
    return out


def main() -> None:
    from app.db import engine

    with engine.begin() as c:
        print(load_national(c))
        munis = [r[0] for r in c.execute(text("SELECT DISTINCT municipality_ibge FROM neighborhoods"))]
        print(update_neighborhood_income(c, munis))


if __name__ == "__main__":
    main()
