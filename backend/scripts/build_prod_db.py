"""Monta os bancos de produção do protótipo a partir do banco completo (DATABASE_URL). Ver docs/DATA.md.

    python scripts/build_prod_db.py dados  <url-destino>   # vicus-dados: esquema compacto (app/prod_data_schema.sql) + cópia
    python scripts/build_prod_db.py contas <url-destino>   # vicus-contas: só as tabelas de referência que as contas usam
                                                           #   (o esquema vem do `alembic upgrade head` rodado antes no destino)

"dados" recria tudo no destino. "contas" só insere o que falta (ON CONFLICT DO NOTHING): nunca apaga contas nem créditos.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg
from psycopg.types.json import Jsonb

from app.config import DATABASE_URL

# Tabela destino -> SELECT no banco completo, na ordem das chaves estrangeiras.
DADOS = [
    ("regions", "SELECT id, sigla, name FROM regions"),
    ("states", "SELECT ibge, uf, name, region_id FROM states"),
    ("municipalities", "SELECT ibge, name, uf, population, area_km2, income_median, geom_low, geom_mid, geom_high, label_point FROM municipalities"),
    ("neighborhoods", "SELECT id, municipality_ibge, name, geom_simplified, label_point, area_km2, income_median, income_method, population, population_method FROM neighborhoods"),
    ("city_data_status", "SELECT municipality_ibge, loaded_at, reference_month, neighborhoods, total_active, located, located_exact, located_trigram, unmatched_top, division_kind, located_alias FROM city_data_status"),
    ("segments", "SELECT key, name, sort, competitor_type_key FROM segments"),
    ("business_types", "SELECT key, name, name_plural, precision, note, selectable, source FROM business_types"),
    ("business_type_cnae", "SELECT business_type_key, cnae, description, verified FROM business_type_cnae"),
    ("business_type_cnes", "SELECT business_type_key, tp_unidade, description FROM business_type_cnes"),
    ("segment_defaults", "SELECT segment_key, business_type_key, direction, weight FROM segment_defaults"),
    ("data_sources", "SELECT key, name, url, reference_date, notes FROM data_sources"),
    ("etl_progress", "SELECT uf, step, reference, done_at FROM etl_progress"),
    ("geo_cache", "SELECT key, geojson, etag, fetched_at FROM geo_cache"),
    ("neighborhood_type_counts", "SELECT neighborhood_id, business_type_key, n_establishments, n_cnpj FROM neighborhood_type_counts"),
    ("municipality_type_counts", "SELECT municipality_ibge, business_type_key, n_establishments, n_cnpj FROM municipality_type_counts"),
    ("neighborhood_coverage", "SELECT neighborhood_id, located_count, level FROM neighborhood_coverage"),
]
# Contas: perfil valida segmento/tipo/cidade, créditos juntam nome da cidade/UF/região e exigem city_data_status.
CONTAS = [
    ("regions", "SELECT id, sigla, name FROM regions"),
    ("states", "SELECT ibge, uf, name, region_id FROM states"),
    ("municipalities", "SELECT ibge, name, name_normalized, uf FROM municipalities"),
    ("city_data_status", DADOS[4][1]),
    ("segments", DADOS[5][1]),
    ("business_types", DADOS[6][1]),
    ("business_type_cnae", DADOS[7][1]),
    ("business_type_cnes", DADOS[8][1]),
    ("segment_defaults", DADOS[9][1]),
    ("data_sources", DADOS[10][1]),
]


def columns(select: str) -> str:
    return select[len("SELECT "):select.index(" FROM ")]


def copy(src, dst, table, select):
    with src.cursor().copy(f"COPY ({select}) TO STDOUT") as out, dst.cursor().copy(f"COPY {table} ({columns(select)}) FROM STDIN") as inp:
        for chunk in out:
            inp.write(chunk)


def upsert(src, dst, table, select):
    rows = [[Jsonb(v) if isinstance(v, (dict, list)) else v for v in r] for r in src.execute(select)]  # jsonb (unmatched_top)
    cols = columns(select)
    dst.cursor().executemany(f"INSERT INTO {table} ({cols}) VALUES ({', '.join('%s' for _ in cols.split(','))}) ON CONFLICT DO NOTHING", rows)


def main(target: str, url: str) -> None:
    plan, load = (DADOS, copy) if target == "dados" else (CONTAS, upsert)
    with psycopg.connect(DATABASE_URL.replace("+psycopg", "")) as src, psycopg.connect(url.replace("+psycopg", "")) as dst:
        if target == "dados":
            dst.execute(open("app/prod_data_schema.sql", encoding="utf-8").read())
        for table, select in plan:
            t = time.time()
            load(src, dst, table, select)
            n = dst.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            print(f"{table:26} {n:>9} linhas  {time.time() - t:5.1f}s", flush=True)
        dst.commit()
    with psycopg.connect(url.replace("+psycopg", ""), autocommit=True) as dst:  # VACUUM não roda dentro de transação
        dst.execute("VACUUM ANALYZE")
        size = dst.execute("SELECT pg_size_pretty(pg_database_size(current_database())), pg_database_size(current_database())").fetchone()
        print(f"tamanho do banco: {size[0]} ({size[1]} bytes)")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in ("dados", "contas"):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
