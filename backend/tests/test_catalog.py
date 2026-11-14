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
