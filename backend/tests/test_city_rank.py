"""Ranking de cidades com 4 municípios fictícios e notas calculadas à mão (docs/SCORING.md).

Hospitais (perto, peso 1):
  Alfa  pop 100 mil, 100 km², 10 hosp -> 1,0 por 10 mil hab.; 0,100 por km²; renda 3000
  Beta  pop  50 mil,  10 km²,  5 hosp -> 1,0 por 10 mil hab.; 0,500 por km²; renda 1000
  Gama  pop  30 mil, 1000 km², 9 hosp -> 3,0 por 10 mil hab.; 0,009 por km²; renda 2000
  Delta pop  10 mil,   5 km²,  4 hosp -> 4,0 por 10 mil hab.; 0,800 por km²  (abaixo de 20 mil)
Por habitantes, mínimo 20 mil: percentis Alfa 0, Beta 0, Gama 1 -> Gama 100; Alfa 0 e Beta 0 (empate -> nome).
Por km², mínimo 20 mil: Gama 0, Alfa 0,5, Beta 1 -> Beta 100, Alfa 50, Gama 0.
Por habitantes, sem mínimo: Alfa 0, Beta 0, Gama 2/3, Delta 1 -> Delta 100, Gama 66,7, Alfa 0, Beta 0.
"""
import pytest
from sqlalchemy import text

from app.db import engine
from app.scoring import rank_cities as rc
from tests.helpers import login_new_user, seed_minimal_catalog, unlock_search

CITIES = {  # nome: (ibge, população, área, hospitais, renda)
    "Alfa": (2699901, 100_000, 100, 10, 3000),
    "Beta": (2699902, 50_000, 10, 5, 1000),
    "Gama": (2699903, 30_000, 1000, 9, 2000),
    "Delta": (2699904, 10_000, 5, 4, None),
}
HOSPITAL = {"business_type_key": "hospital", "direction": "attract", "weight": 1}


@pytest.fixture(autouse=True)
def cities():
    seed_minimal_catalog()
    rc.clear_cache()
    with engine.begin() as c:  # a fórmula é testada com o CNPJ; a fonte CNES tem teste próprio (test_cnes.py)
        c.execute(text("UPDATE business_types SET source = 'cnpj'"))
    with engine.begin() as c:
        c.execute(text("DELETE FROM establishments; DELETE FROM neighborhoods; DELETE FROM city_data_status"))
        seq = 0
        for name, (ibge, pop, area, hosp, income) in CITIES.items():
            c.execute(
                text(
                    "INSERT INTO municipalities (ibge, name, name_normalized, uf, population, area_km2, income_median, label_point) "
                    "VALUES (:m, :n, norm_text(:n), 'PE', :p, :a, :i, ST_Point(-35, -8, 4326)) "
                    "ON CONFLICT (ibge) DO UPDATE SET population = :p, area_km2 = :a, income_median = :i"
                ),
                {"m": ibge, "n": name, "p": pop, "a": area, "i": income},
            )
            for _ in range(hosp):
                seq += 1
                c.execute(
                    text("INSERT INTO establishments (id, cnae_main, situation, municipality_ibge) VALUES (lpad(:i, 64, '0'), '8610101', '02', :m)"),
                    {"i": str(seq), "m": ibge},
                )
            c.execute(text("INSERT INTO city_data_status VALUES (:m, now(), '2026-10', 1, :t, 0, 0, 0, '[]')"), {"m": ibge, "t": hosp})
        c.execute(text("REFRESH MATERIALIZED VIEW municipality_type_counts"))
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM establishments; DELETE FROM city_data_status; DELETE FROM municipalities WHERE ibge BETWEEN 2699901 AND 2699904"))
        c.execute(text("REFRESH MATERIALIZED VIEW municipality_type_counts"))


def do_rank(client, csrf, **body):
    unlock_search(client, csrf, uf="PE")  # a busca no alcance PE usa o crédito grátis; repetir não cobra
    r = client.post("/api/cities/rank", json={"uf": "PE", "criteria": [HOSPITAL], **body}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200, r.text
    return r.json()


def as_dicts(res):
    """A resposta é colunar (columns + rows)."""
    return [dict(zip(res["columns"], r)) for r in res["rows"]]


def table(res):
    return [(c["name"], c["rank"], c["score"]) for c in as_dicts(res)]


def test_by_population_with_min_and_tie_by_name(client):
    csrf = login_new_user(client)
    res = do_rank(client, csrf)  # padrão: por habitantes, mínimo 20 mil
    assert res["status"] == "ok" and res["normalization"] == "population" and res["min_population"] == 20000
    assert table(res) == [("Gama", 1, 100.0), ("Alfa", 2, 0.0), ("Beta", 3, 0.0)]
    gama = as_dicts(res)[0]
    assert gama["n"] == [9] and gama["per_10k"] == [3.0] and gama["per_km2"] == [0.009]  # sempre as duas medidas e a contagem
    assert gama["lower_share"] == [1.0] and gama["higher_share"] == [0.0]
    assert res["counts"]["analyzed"] == 3 and res["counts"]["below_min_population"] == 1


def test_by_area(client):
    csrf = login_new_user(client)
    assert table(do_rank(client, csrf, normalization="area")) == [("Beta", 1, 100.0), ("Alfa", 2, 50.0), ("Gama", 3, 0.0)]


def test_min_population_filter(client):
    csrf = login_new_user(client)
    res = do_rank(client, csrf, min_population=0)
    assert table(res) == [("Delta", 1, 100.0), ("Gama", 2, 66.7), ("Alfa", 3, 0.0), ("Beta", 4, 0.0)]
    assert [c["name"] for c in as_dicts(do_rank(client, csrf, min_population=60000))] == ["Alfa"]


def test_reproducible(client):
    csrf = login_new_user(client)
    first = do_rank(client, csrf, normalization="area")
    rc.clear_cache()  # força recalcular no banco
    assert do_rank(client, csrf, normalization="area") == first


def test_income_criterion_and_text(client):
    csrf = login_new_user(client)
    res = do_rank(client, csrf, criteria=[], income={"direction": "attract", "weight": 2})
    # renda: Beta 1000 (p 0), Gama 2000 (p 0,5), Alfa 3000 (p 1)
    assert table(res) == [("Alfa", 1, 100.0), ("Gama", 2, 50.0), ("Beta", 3, 0.0)]
    alfa = as_dicts(res)[0]
    assert alfa["income_median"] == 3000 and alfa["income_quartile"] == 4 and res["income"]["levels"]["4"] == "above"
    assert res["income"]["texts"]["above"] == "Poder de compra acima da média das cidades analisadas. Perfil compatível com oferta premium."
    assert res["income"]["note"] == "Renda é um indicador e não determina preferências."
    assert res["criteria"][-1] == {"business_type_key": "renda", "direction": "attract", "weight": 2}
    # Delta não tem renda: com renda como critério fica fora (sem estimar); sem ela, entra e a renda fica nula.
    res = do_rank(client, csrf, min_population=0)
    delta = next(c for c in as_dicts(res) if c["name"] == "Delta")
    assert delta["income_median"] is None and delta["income_quartile"] is None
    assert res["income"]["missing"] == "Não foi possível encontrar dados de renda desta área."


def test_only_loaded_cities(client):
    csrf = login_new_user(client)
    with engine.begin() as c:
        c.execute(text("DELETE FROM city_data_status WHERE municipality_ibge = 2699903"))  # Gama sem carga
    rc.clear_cache()
    res = do_rank(client, csrf)
    assert [c["name"] for c in as_dicts(res)] == ["Alfa", "Beta"]
    assert res["counts"]["with_data"] == 3
