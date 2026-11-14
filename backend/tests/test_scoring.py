"""Testes do motor de ranking com uma cidade fictícia de 4 bairros e notas calculadas à mão.

Hospitais (perto, peso 3): Alfa 4 (1 km²), Beta 2 (1 km²), Gama 4 (2 km²), Delta 0 (1 km²)
  densidades 4, 2, 2, 0  -> percentis: Alfa 1, Beta 1/3, Gama 1/3, Delta 0
Farmácias (longe, peso 1): Alfa 3, Beta 0, Gama 0, Delta 1 (densidades iguais às contagens, exceto Gama 0/2=0)
  percentis: Beta 0, Gama 0, Delta 2/3, Alfa 1 -> aderência (1 - p): Beta 1, Gama 1, Delta 1/3, Alfa 0
Nota = 100 × (3·f_hosp + 1·f_farm) / 4:
  Alfa 75,0 | Beta 50,0 | Gama 50,0 (empate -> ordem alfabética: Beta antes de Gama) | Delta 8,3
"""
import socket

import pytest
from sqlalchemy import text

from app.db import engine
from app.scoring import rank as rank_module
from tests.helpers import login_new_user, seed_minimal_catalog

RECIFE = 2611606
HOSPITAL = {"business_type_key": "hospital", "direction": "attract", "weight": 3}
FARMACIA = {"business_type_key": "farmacia", "direction": "repel", "weight": 1}
BAIRROS = {  # nome: (área km², hospitais, farmácias)
    "Alfa": (1, 4, 3),
    "Beta": (1, 2, 0),
    "Gama": (2, 4, 0),
    "Delta": (1, 0, 1),
}


@pytest.fixture(autouse=True)
def city():
    seed_minimal_catalog()
    rank_module.clear_cache()
    with engine.begin() as c:
        c.execute(text("DELETE FROM establishments; DELETE FROM neighborhoods; DELETE FROM city_data_status"))
        seq = 0
        for name, (area, hosp, farm) in BAIRROS.items():
            nid = c.execute(
                text(
                    "INSERT INTO neighborhoods (municipality_ibge, ibge_code, name, name_normalized, geom, geom_simplified, "
                    "label_point, area_km2, source, source_date) VALUES (:m, :n, :n, norm_text(:n), "
                    "ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)), ST_Multi(ST_MakeEnvelope(0,0,1,1,4326)), "
                    "ST_Point(0.5,0.5,4326), :a, 'test', '2022') RETURNING id"
                ),
                {"m": RECIFE, "n": name, "a": area},
            ).scalar()
            for cnae, n in (("8610101", hosp), ("4771701", farm)):
                for _ in range(n):
                    seq += 1
                    c.execute(
                        text(
                            "INSERT INTO establishments (id, cnae_main, situation, municipality_ibge, neighborhood_id, match_method) "
                            "VALUES (lpad(:i, 64, '0'), :cnae, '02', :m, :nid, 'exact')"
                        ),
                        {"i": str(seq), "cnae": cnae, "m": RECIFE, "nid": nid},
                    )
        c.execute(text("REFRESH MATERIALIZED VIEW neighborhood_type_counts; REFRESH MATERIALIZED VIEW neighborhood_coverage"))
        c.execute(
            text("INSERT INTO city_data_status VALUES (:m, now(), '2026-10', 4, :t, :t, :t, 0, '[]')"),
            {"m": RECIFE, "t": seq},
        )


def do_rank(client, csrf, criteria):
    r = client.post(f"/api/cities/{RECIFE}/rank", json={"criteria": criteria}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200, r.text
    return r.json()


def test_scores_match_hand_calculation(client):
    csrf = login_new_user(client)
    res = do_rank(client, csrf, [HOSPITAL, FARMACIA])
    assert res["status"] == "ok"
    got = [(n["name"], n["rank"], n["score"]) for n in res["neighborhoods"]]
    assert got == [("Alfa", 1, 75.0), ("Beta", 2, 50.0), ("Gama", 3, 50.0), ("Delta", 4, 8.3)]

    gama = res["neighborhoods"][2]["criteria"]
    assert gama[0]["n"] == 4 and gama[0]["density_per_km2"] == 2.0 and gama[0]["percentile"] == pytest.approx(1 / 3, abs=1e-4)
    assert gama[0]["comparison_text"] == "mais densidade que 33% dos bairros"
    # Gama tem 0 farmácias; dos 3 outros bairros, Delta e Alfa têm mais densidade -> 2/3.
    assert gama[1]["comparison_text"] == "menos densidade que 67% dos bairros"
    assert res["sources"] is not None and res["reference_dates"]["establishments"] == "2026-10"


def test_reproducible(client):
    csrf = login_new_user(client)
    first = do_rank(client, csrf, [HOSPITAL, FARMACIA])
    rank_module.clear_cache()  # força recalcular no banco, não só ler do cache
    second = do_rank(client, csrf, [HOSPITAL, FARMACIA])
    assert first == second


def test_tie_broken_by_name(client):
    csrf = login_new_user(client)
    res = do_rank(client, csrf, [FARMACIA])  # Beta e Gama empatam (0 farmácias)
    names = [n["name"] for n in res["neighborhoods"]]
    assert names.index("Beta") < names.index("Gama")
    assert res["neighborhoods"][0]["score"] == res["neighborhoods"][1]["score"]


def test_repel_inverts_attract(client):
    csrf = login_new_user(client)
    attract = do_rank(client, csrf, [{**FARMACIA, "direction": "attract"}])
    repel = do_rank(client, csrf, [FARMACIA])
    scores_a = {n["name"]: n["score"] for n in attract["neighborhoods"]}
    scores_r = {n["name"]: n["score"] for n in repel["neighborhoods"]}
    for name in BAIRROS:
        assert scores_a[name] + scores_r[name] == pytest.approx(100.0, abs=0.1)
    assert attract["neighborhoods"][0]["name"] == "Alfa" and repel["neighborhoods"][-1]["name"] == "Alfa"


def test_missing_data_is_never_zero(client):
    csrf = login_new_user(client)
    with engine.begin() as c:
        c.execute(text("INSERT INTO business_types VALUES ('escritorio', 'Escritório', 'Escritórios', 'exact', NULL, true)"))
    try:
        res = do_rank(client, csrf, [HOSPITAL, {"business_type_key": "escritorio", "direction": "attract", "weight": 3}])
        assert res["status"] == "no_data" and "neighborhoods" not in res
        assert res["message"] == "Não foi possível encontrar dados de escritórios desta área."
    finally:
        with engine.begin() as c:
            c.execute(text("DELETE FROM business_types WHERE key = 'escritorio'"))

    with engine.begin() as c:
        c.execute(text("DELETE FROM city_data_status"))
    res = do_rank(client, csrf, [HOSPITAL])
    assert res["status"] == "no_data"
    assert res["message"] == "Não foi possível encontrar dados de estabelecimentos desta área."


def test_no_network_during_ranking(client, monkeypatch):
    csrf = login_new_user(client)

    def blocked(*args, **kwargs):
        raise AssertionError("acesso à rede durante o ranking")

    # Bloqueia DNS e conexões novas; o banco usa o pool já aberto pelo login acima.
    monkeypatch.setattr(socket, "getaddrinfo", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)
    res = do_rank(client, csrf, [HOSPITAL, FARMACIA])
    assert res["status"] == "ok" and res["count"] == 4


def test_geojson_has_ids(client):
    login_new_user(client)
    r = client.get(f"/api/cities/{RECIFE}/neighborhoods.geojson")
    fc = r.json()
    assert r.headers["etag"] and len(fc["features"]) == 4
    assert all(f["id"] == f["properties"]["id"] for f in fc["features"])
