"""Compara o ranking no banco completo (DATABASE_URL) e no banco compacto (DATA_DATABASE_URL): 20 consultas.

    DATA_DATABASE_URL=... python scripts/compare_rank.py

15 rankings de bairros (5 maiores cidades, 5 medianas com bairros do IBGE, 5 com áreas por setor), com os critérios
padrão de cada segmento em rodízio, e 5 rankings de cidades (alcances e opções diferentes). Sai com 1 se algo diferir.
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import DATA_DATABASE_URL, DATABASE_URL
from app.scoring import rank, rank_cities

CITIES_SQL = """
(SELECT m.ibge FROM municipalities m JOIN city_data_status s ON s.municipality_ibge = m.ibge ORDER BY m.population DESC NULLS LAST LIMIT 5)
UNION ALL
(SELECT m.ibge FROM municipalities m JOIN city_data_status s ON s.municipality_ibge = m.ibge
 WHERE s.division_kind = 'bairro' AND m.population BETWEEN 80000 AND 200000 ORDER BY m.ibge LIMIT 5)
UNION ALL
(SELECT m.ibge FROM municipalities m JOIN city_data_status s ON s.municipality_ibge = m.ibge
 WHERE s.division_kind = 'area' AND m.population BETWEEN 20000 AND 60000 ORDER BY m.ibge DESC LIMIT 5)
"""
CITY_RANKS = [
    dict(region=None, uf=None, normalization="population", min_population=20000, income=None),
    dict(region=2, uf=None, normalization="area", min_population=20000, income=None),
    dict(region=None, uf="PE", normalization="population", min_population=0, income={"direction": "attract", "weight": 3}),
    dict(region=None, uf="SP", normalization="population", min_population=100000, income=None),
    dict(region=4, uf=None, normalization="area", min_population=50000, income={"direction": "repel", "weight": 2}),
]


def timed(fn):
    t = time.perf_counter()
    r = fn()
    return r, (time.perf_counter() - t) * 1000


def report(label, a, b, n, ta, tb) -> int:
    ja, jb = json.dumps(a, sort_keys=True, default=str), json.dumps(b, sort_keys=True, default=str)
    same = ja == jb
    print(f"{label[:58]:58} {n:>6} {ta:>7.0f}ms {tb:>7.0f}ms  {'sim' if same else 'NAO'}")
    if not same:
        k = next((i for i, (x, y) in enumerate(zip(ja, jb)) if x != y), min(len(ja), len(jb)))
        print(f"   primeira diferenca no caractere {k}: {ja[max(0, k - 60):k + 60]!r} vs {jb[max(0, k - 60):k + 60]!r}")
    return 0 if same else 1


def main() -> int:
    full, compact = Session(create_engine(DATABASE_URL)), Session(create_engine(DATA_DATABASE_URL))
    cities = [r[0] for r in full.execute(text(CITIES_SQL))]
    segments = [r[0] for r in full.execute(text("SELECT key FROM segments ORDER BY sort"))]
    defaults = {}
    for s in segments:
        rows = full.execute(text("SELECT business_type_key, direction, weight FROM segment_defaults WHERE segment_key = :s ORDER BY business_type_key"), {"s": s})
        defaults[s] = [dict(r) for r in rows.mappings()]
    bad = 0
    print(f"{'consulta':58} {'linhas':>6} {'completo':>9} {'compacto':>9}  igual")
    for i, ibge in enumerate(cities):
        seg = segments[i % len(segments)]
        a, ta = timed(lambda: rank.rank(full, ibge, defaults[seg]))
        rank.clear_cache()
        b, tb = timed(lambda: rank.rank(compact, ibge, defaults[seg]))
        rank.clear_cache()
        city = a["city"]
        bad += report(f"bairros {ibge} {city['name']} ({city['uf']}, {a.get('division_kind', '-')}) . {seg}", a, b, a.get("count", 0), ta, tb)
    for opts in CITY_RANKS:
        crit = defaults[segments[0]][:2]
        a, ta = timed(lambda: json.loads(rank_cities.rank_cities(full, criteria=crit, **opts)[0]))
        rank_cities.clear_cache()
        b, tb = timed(lambda: json.loads(rank_cities.rank_cities(compact, criteria=crit, **opts)[0]))
        rank_cities.clear_cache()
        scope = opts["uf"] or ("R" + str(opts["region"]) if opts["region"] else "BR")
        label = f"cidades {scope} {opts['normalization']} >={opts['min_population']}" + (" +renda" if opts["income"] else "")
        bad += report(label, a, b, a.get("counts", {}).get("analyzed", 0), ta, tb)
    print("TUDO IGUAL" if not bad else f"{bad} consulta(s) com diferenca")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
