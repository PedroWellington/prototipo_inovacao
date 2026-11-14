"""Seed do catálogo: regiões/estados/municípios (API de localidades do IBGE) e tipos/CNAE/segmentos (CSVs).

Idempotente: rodar de novo atualiza sem duplicar.
    docker compose run --rm backend python -m app.etl.seed_catalog
"""
import csv
from pathlib import Path

import httpx
from sqlalchemy import text

from app.config import IBGE_API
from app.db import engine

SEED_DIR = Path(__file__).resolve().parent.parent / "seed"


def read_csv(name: str) -> list[dict]:
    with open(SEED_DIR / name, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def municipality_uf(m: dict) -> str:
    # Alguns municípios vêm com microrregiao nula; a região imediata também traz a UF.
    if m.get("microrregiao"):
        return m["microrregiao"]["mesorregiao"]["UF"]["sigla"]
    return m["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"]


def seed_localities(conn) -> None:
    get = lambda path: httpx.get(f"{IBGE_API}/v1/localidades/{path}", timeout=60).raise_for_status().json()  # noqa: E731
    regions, states, municipalities = get("regioes"), get("estados"), get("municipios")

    conn.execute(
        text("INSERT INTO regions VALUES (:id, :sigla, :nome) ON CONFLICT (id) DO UPDATE SET sigla=EXCLUDED.sigla, name=EXCLUDED.name"),
        regions,
    )
    conn.execute(
        text(
            "INSERT INTO states VALUES (:id, :sigla, :nome, :region) "
            "ON CONFLICT (ibge) DO UPDATE SET uf=EXCLUDED.uf, name=EXCLUDED.name, region_id=EXCLUDED.region_id"
        ),
        [{**s, "region": s["regiao"]["id"]} for s in states],
    )
    rows = [{"id": m["id"], "nome": m["nome"], "uf": municipality_uf(m)} for m in municipalities]
    conn.execute(
        text(
            "INSERT INTO municipalities (ibge, name, name_normalized, uf) VALUES (:id, :nome, norm_text(:nome), :uf) "
            "ON CONFLICT (ibge) DO UPDATE SET name=EXCLUDED.name, name_normalized=EXCLUDED.name_normalized, uf=EXCLUDED.uf"
        ),
        rows,
    )
    print(f"Localidades: {len(regions)} regiões, {len(states)} estados, {len(rows)} municípios")


def seed_catalog_tables(conn) -> None:
    # Catálogo = cópia exata dos CSVs (edite os CSVs e rode de novo). Upsert porque perfis referenciam segmentos.
    segments = read_csv("segments.csv")
    types = read_csv("business_types.csv")
    cnaes = read_csv("business_type_cnae.csv")
    cnes = read_csv("business_type_cnes.csv")
    defaults = read_csv("segment_defaults.csv")
    conn.execute(text("DELETE FROM segment_defaults; DELETE FROM business_type_cnae; DELETE FROM business_type_cnes"))
    conn.execute(
        text("INSERT INTO segments VALUES (:key, :name, :sort) ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, sort=EXCLUDED.sort"),
        segments,
    )
    conn.execute(text("DELETE FROM segments WHERE key <> ALL(:k)"), {"k": [s["key"] for s in segments]})
    conn.execute(
        text(
            "INSERT INTO business_types (key, name, name_plural, precision, note, selectable, source) "
            "VALUES (:key, :name, :name_plural, :precision, nullif(:note, ''), :selectable, :source) "
            "ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, name_plural=EXCLUDED.name_plural, "
            "precision=EXCLUDED.precision, note=EXCLUDED.note, selectable=EXCLUDED.selectable, source=EXCLUDED.source"
        ),
        [{**t, "selectable": t["selectable"] == "true"} for t in types],
    )
    conn.execute(text("DELETE FROM business_types WHERE key <> ALL(:k)"), {"k": [t["key"] for t in types]})
    conn.execute(
        text("INSERT INTO business_type_cnae VALUES (:business_type_key, :cnae, :description, :verified)"),
        [{**c, "verified": c["verified"] == "true"} for c in cnaes],
    )
    conn.execute(text("INSERT INTO business_type_cnes VALUES (:business_type_key, :tp_unidade, :description)"), cnes)
    conn.execute(text("INSERT INTO segment_defaults VALUES (:segment_key, :business_type_key, :direction, :weight)"), defaults)
    print(f"Catálogo: {len(segments)} segmentos, {len(types)} tipos, {len(cnaes)} CNAEs, {len(cnes)} tipos CNES, {len(defaults)} sugestões")


def main() -> None:
    with engine.begin() as conn:
        seed_localities(conn)
        seed_catalog_tables(conn)
        # As contagens dependem do mapeamento tipo -> CNAE/CNES e da fonte: editar o CSV exige recontar.
        # (CNAE novo exige recarregar o CNPJ; tipo de unidade novo, a etapa cnes do load_br. Ver docs/DATA.md.)
        from app.etl.counts import refresh_views

        refresh_views(conn)


if __name__ == "__main__":
    main()
