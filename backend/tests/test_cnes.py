"""Hospital vem do CNES (fonte principal, business_types.source = cnes); o CNPJ aparece como complemento (n_cnpj)."""
from sqlalchemy import text

from app.db import engine
from app.scoring import rank as rank_module
from app.scoring import rank_cities
from tests.helpers import login_new_user, seed_minimal_catalog

RECIFE = 2611606
HOSPITAL = {"business_type_key": "hospital", "direction": "attract", "weight": 3}


def setup_city():
    seed_minimal_catalog()  # hospital com source = cnes, como no CSV
    rank_module.clear_cache()
    rank_cities.clear_cache()
    with engine.begin() as c:
        c.execute(text("DELETE FROM health_units; DELETE FROM establishments; DELETE FROM neighborhoods; DELETE FROM city_data_status"))
        c.execute(text("UPDATE municipalities SET population = 1000000, area_km2 = 200 WHERE ibge = :m"), {"m": RECIFE})
        ids = {}
        for name in ("Alfa", "Beta"):
            ids[name] = c.execute(
                text(
                    "INSERT INTO neighborhoods (municipality_ibge, ibge_code, name, name_normalized, geom, geom_simplified, label_point, "
                    "area_km2, source, source_date) VALUES (:m, :n, :n, norm_text(:n), ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)), "
                    "ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)), ST_Point(0.5,0.5,4326), 1, 'test', '2022') RETURNING id"
                ),
                {"m": RECIFE, "n": name},
            ).scalar()
        # Alfa: 1 hospital no CNES, mas 5 locais com CNAE hospitalar no CNPJ; Beta: 2 no CNES, nenhum no CNPJ.
        for i in range(5):
            c.execute(text("INSERT INTO establishments (id, cnae_main, situation, municipality_ibge, neighborhood_id, match_method) "
                           "VALUES (lpad(:i, 64, '0'), '8610101', '02', :m, :n, 'exact')"), {"i": str(i), "m": RECIFE, "n": ids["Alfa"]})
        for cnes, tp, nb in (("1", "05", "Alfa"), ("2", "07", "Beta"), ("3", "20", "Beta"), ("4", "39", "Beta")):  # 39 não é hospital
            c.execute(text("INSERT INTO health_units VALUES (:c, :t, :m, :n)"), {"c": cnes, "t": tp, "m": RECIFE, "n": ids[nb]})
        c.execute(text("REFRESH MATERIALIZED VIEW neighborhood_type_counts; REFRESH MATERIALIZED VIEW municipality_type_counts; "
                       "REFRESH MATERIALIZED VIEW neighborhood_coverage"))
        c.execute(text("INSERT INTO city_data_status VALUES (:m, now(), '2026-10', 2, 5, 5, 5, 0, '[]')"), {"m": RECIFE})


def test_hospital_counts_come_from_cnes_with_cnpj_as_complement(client):
    setup_city()
    csrf = login_new_user(client)
    res = client.post(f"/api/cities/{RECIFE}/rank", json={"criteria": [HOSPITAL]}, headers={"X-CSRF-Token": csrf}).json()
    assert res["status"] == "ok" and res["criteria"][0]["source"] == "cnes"
    by = {n["name"]: n["criteria"][0] for n in res["neighborhoods"]}
    assert (by["Beta"]["n"], by["Beta"]["n_cnpj"]) == (2, 0)
    assert (by["Alfa"]["n"], by["Alfa"]["n_cnpj"]) == (1, 5)
    assert [n["name"] for n in res["neighborhoods"]] == ["Beta", "Alfa"]  # a nota usa o CNES, não o CNPJ

    res = client.post("/api/cities/rank", json={"uf": "PE", "criteria": [HOSPITAL], "min_population": 0},
                      headers={"X-CSRF-Token": csrf}).json()
    city = dict(zip(res["columns"], res["rows"][0]))
    assert city["n"] == [3] and city["n_cnpj"] == [5]


def test_cnes_type_without_mapping_is_no_data(client):
    setup_city()
    csrf = login_new_user(client)
    with engine.begin() as c:
        c.execute(text("DELETE FROM business_type_cnes"))
    try:
        res = client.post(f"/api/cities/{RECIFE}/rank", json={"criteria": [HOSPITAL]}, headers={"X-CSRF-Token": csrf}).json()
        assert res["status"] == "no_data" and res["message"] == "Não foi possível encontrar dados de hospitais desta área."
    finally:
        seed_minimal_catalog()
