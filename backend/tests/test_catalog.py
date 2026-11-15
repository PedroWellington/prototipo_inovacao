from collections import Counter

from app.etl.seed_catalog import read_csv


def test_seed_csvs_are_consistent():
    types = {t["key"]: t for t in read_csv("business_types.csv")}
    segments = {s["key"] for s in read_csv("segments.csv")}
    cnaes = read_csv("business_type_cnae.csv")
    defaults = read_csv("segment_defaults.csv")

    # Todo tipo selecionável tem pelo menos um CNAE de 7 dígitos.
    mapped = {c["business_type_key"] for c in cnaes}
    assert all(c["cnae"].isdigit() and len(c["cnae"]) == 7 for c in cnaes)
    assert {k for k, t in types.items() if t["selectable"] == "true"} <= mapped
    assert all(t["precision"] in ("exact", "approx") for t in types.values())

    # Sugestões apontam para segmentos/tipos existentes e respeitam o limite de 3 por direção.
    for d in defaults:
        assert d["segment_key"] in segments and d["business_type_key"] in types
        assert d["direction"] in ("attract", "repel") and 1 <= int(d["weight"]) <= 5
    per_direction = Counter((d["segment_key"], d["direction"]) for d in defaults)
    assert max(per_direction.values()) <= 3


def test_sources_lists_reference_dates_and_cities_with_data(client):
    from sqlalchemy import text

    from app.db import engine

    with engine.begin() as c:
        c.execute(text("DELETE FROM city_data_status"))
        c.execute(text("INSERT INTO data_sources VALUES ('teste_fonte', 'Fonte de teste', 'https://exemplo.gov.br', '2026-10', NULL) "
                       "ON CONFLICT (key) DO UPDATE SET reference_date = '2026-10'"))
    body = client.get("/api/catalog/sources").json()
    src = next(s for s in body["sources"] if s["key"] == "teste_fonte")
    assert src == {"key": "teste_fonte", "name": "Fonte de teste", "url": "https://exemplo.gov.br", "reference_date": "2026-10"}
    assert body["cities_with_data"] == 0
