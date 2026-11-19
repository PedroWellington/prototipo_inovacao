"""Ranking de cidades: o mesmo motor dos bairros (percentil, nota ponderada, desempate pelo nome), por município.

Fórmula e exemplo: docs/SCORING.md ("Ranking de cidades"). Toda a conta é feita no SQL abaixo.
A resposta é colunar ("columns" + "rows"): com ~5.570 cidades, repetir chaves e textos por cidade custava 8 MB e
estourava a meta de 150 ms (docs/PERFORMANCE.md). Textos de renda, nota e fonte vão uma vez só.
"""
import gzip
import json
from collections import OrderedDict
from threading import Lock

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.scoring.rank import CATALOG_VERSION_SQL, INCOME_NOTE, NO_DATA, TYPES_SQL, income_source, missing_types

INCOME_KEY = "renda"
COLUMNS = ["ibge", "name", "uf", "score", "rank", "population", "area_km2", "total_active", "located",
           "income_median", "income_quartile", "lx", "ly", "n", "n_cnpj", "per_10k", "per_km2", "lower_share", "higher_share"]

CITY_RANK_SQL = text(
    """
    WITH crit AS (
      SELECT * FROM unnest(CAST(:keys AS text[]), CAST(:dirs AS text[]), CAST(:weights AS int[]))
             WITH ORDINALITY AS c(key, dir, w, ord)
    ), c AS MATERIALIZED (
      -- só cidades com dados carregados, população e área do Censo e acima do mínimo; renda só se for critério
      SELECT m.ibge, m.name, m.uf, m.population, m.area_km2, m.income_median, s.total_active, s.located,
             round(ST_X(m.label_point)::numeric, 5) AS lx, round(ST_Y(m.label_point)::numeric, 5) AS ly
      FROM municipalities m JOIN states st ON st.uf = m.uf
      JOIN city_data_status s ON s.municipality_ibge = m.ibge
      WHERE (CAST(:region AS int) IS NULL OR st.region_id = :region) AND (CAST(:uf AS text) IS NULL OR m.uf = :uf)
        AND m.population >= :min_pop AND m.population > 0 AND m.area_km2 > 0
        AND (NOT :use_income OR m.income_median IS NOT NULL)
    ), v AS (
      SELECT c.ibge, k.ord, k.dir, k.w, coalesce(t.n_establishments, 0) AS n, coalesce(t.n_cnpj, 0) AS n_cnpj,
             coalesce(t.n_establishments, 0) * 10000.0 / c.population AS per_10k,
             coalesce(t.n_establishments, 0) / c.area_km2 AS per_km2
      FROM c CROSS JOIN crit k
      LEFT JOIN (SELECT * FROM municipality_type_counts WHERE business_type_key = ANY(CAST(:keys AS text[]))) t
             ON t.municipality_ibge = c.ibge AND t.business_type_key = k.key
    ), x AS (
      SELECT ibge, ord, dir, w, n, n_cnpj, per_10k, per_km2, CASE WHEN :norm = 'area' THEN per_km2 ELSE per_10k END AS value FROM v
      UNION ALL
      -- renda como critério opcional: posição relativa da mediana entre as cidades analisadas
      SELECT ibge, 99, :income_dir, :income_w, NULL, NULL, NULL, NULL, income_median FROM c WHERE :use_income
    ), p AS (
      SELECT x.*,
             percent_rank() OVER (PARTITION BY ord ORDER BY value) AS pct,
             coalesce((rank() OVER (PARTITION BY ord ORDER BY value DESC) - 1)::float
                      / nullif(count(*) OVER (PARTITION BY ord) - 1, 0), 0) AS higher
      FROM x
    ), s AS (
      SELECT ibge, 100 * sum(w * CASE dir WHEN 'attract' THEN pct ELSE 1 - pct END) / sum(w) AS score,
             array_agg(n ORDER BY ord) AS n, array_agg(n_cnpj ORDER BY ord) AS n_cnpj,
             array_agg(round(per_10k::numeric, 2) ORDER BY ord) AS per_10k,
             array_agg(round(per_km2::numeric, 3) ORDER BY ord) AS per_km2,
             array_agg(round(pct::numeric, 4) ORDER BY ord) AS lower_share,
             array_agg(round(higher::numeric, 4) ORDER BY ord) AS higher_share
      FROM p GROUP BY ibge
    ), q AS (
      SELECT percentile_cont(ARRAY[0.25, 0.5, 0.75]) WITHIN GROUP (ORDER BY income_median) AS q
      FROM c WHERE income_median IS NOT NULL
    )
    SELECT coalesce(json_agg(json_build_array(
             ibge, name, uf, score, rank, population, area_km2, total_active, located, income_median, income_quartile,
             lx, ly, n, n_cnpj, per_10k, per_km2, lower_share, higher_share) ORDER BY rank), '[]')::text AS rows,
           count(*) AS analyzed
    FROM (
    SELECT c.ibge, c.name, c.uf, round(s.score::numeric, 1) AS score,
           -- arredonda antes de ordenar (ruído de ponto flutuante); empate -> nome (COLLATE "C": igual em qualquer servidor) -> código IBGE
           row_number() OVER (ORDER BY round(s.score::numeric, 6) DESC, c.name COLLATE "C", c.ibge) AS rank,
           c.population, round(c.area_km2::numeric, 1) AS area_km2, c.total_active, c.located, c.income_median,
           CASE WHEN c.income_median IS NULL THEN NULL WHEN c.income_median <= q.q[1] THEN 1
                WHEN c.income_median <= q.q[2] THEN 2 WHEN c.income_median <= q.q[3] THEN 3 ELSE 4 END AS income_quartile,
           c.lx, c.ly, s.n, s.n_cnpj, s.per_10k, s.per_km2, s.lower_share, s.higher_share
    FROM s JOIN c ON c.ibge = s.ibge CROSS JOIN q
    ) r  -- linhas já em JSON (colunas na ordem de COLUMNS): sem conversão por cidade no Python
    """
)

SCOPE_SQL = text(
    """
    SELECT count(*) AS in_scope,
           count(*) FILTER (WHERE s.municipality_ibge IS NOT NULL) AS with_data,
           count(*) FILTER (WHERE s.municipality_ibge IS NOT NULL AND (m.population IS NULL OR m.population < :min_pop)) AS below_min_pop,
           count(*) FILTER (WHERE s.municipality_ibge IS NOT NULL AND m.population >= :min_pop AND m.income_median IS NULL) AS without_income,
           max(s.loaded_at) AS loaded_at
    FROM municipalities m JOIN states st ON st.uf = m.uf
    LEFT JOIN city_data_status s ON s.municipality_ibge = m.ibge
    WHERE (CAST(:region AS int) IS NULL OR st.region_id = :region) AND (CAST(:uf AS text) IS NULL OR m.uf = :uf)
    """
)

_cache: OrderedDict = OrderedDict()
_cache_lock = Lock()
CACHE_SIZE = 256


def scope_label(db: Session, region: int | None, uf: str | None) -> str:
    if uf:
        return db.execute(text("SELECT name FROM states WHERE uf = :u"), {"u": uf}).scalar() or uf
    if region:
        return db.execute(text("SELECT name FROM regions WHERE id = :r"), {"r": region}).scalar() or str(region)
    return "Brasil"


def rank_cities(db: Session, *, region: int | None, uf: str | None, criteria: list[dict], normalization: str,
                min_population: int, income: dict | None) -> tuple[str, bytes | None]:
    """Devolve (JSON já serializado, o mesmo em gzip). O gzip é feito uma vez e guardado no cache: comprimir ~350 KB
    a cada pedido (GZipMiddleware, nível 9) custava mais que o próprio SQL."""
    p = {"region": region, "uf": uf, "min_pop": min_population}
    sc = db.execute(SCOPE_SQL, p).mappings().one()
    base = {"scope": {"region_id": region, "uf": uf, "label": scope_label(db, region, uf)}, "normalization": normalization,
            "min_population": min_population}
    if not criteria and not income:
        return json.dumps({**base, "status": "no_criteria", "message": "Adicione pelo menos um critério para ordenar as cidades."},
                          ensure_ascii=False), None
    if not sc["with_data"]:
        return json.dumps({**base, "status": "no_data", "message": NO_DATA.format(item="estabelecimentos"),
                           "counts": {"in_scope": sc["in_scope"], "analyzed": 0}}, ensure_ascii=False), None

    keys = [c["business_type_key"] for c in criteria]
    types = {r.key: r for r in db.execute(TYPES_SQL, {"k": keys})}
    missing = missing_types(types, keys)
    if missing:
        names = [types[k].name_plural if k in types else k for k in missing]
        return json.dumps({**base, "status": "no_data", "missing_types": missing,
                           "message": " ".join(NO_DATA.format(item=n.lower()) for n in names)}, ensure_ascii=False), None

    catalog = db.execute(text(CATALOG_VERSION_SQL)).scalar()
    version = f"{sc['loaded_at'].isoformat()}|{catalog}"
    key = (region, uf, normalization, min_population, json.dumps(income, sort_keys=True),
           tuple(sorted((c["business_type_key"], c["direction"], c["weight"]) for c in criteria)), version)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]

    rows_json, analyzed = db.execute(
        CITY_RANK_SQL,
        {**p, "keys": keys, "dirs": [c["direction"] for c in criteria], "weights": [c["weight"] for c in criteria],
         "norm": normalization, "use_income": bool(income), "income_dir": (income or {}).get("direction", "attract"),
         "income_w": (income or {}).get("weight", 1)},
    ).one()

    sources = [dict(s) for s in db.execute(text(
        "SELECT key, name, url, reference_date FROM data_sources WHERE key IN "
        "('rfb_cnpj', 'ms_cnes', 'ibge_censo_basico', 'ibge_censo_renda', 'ibge_malha_municipal') ORDER BY key")).mappings()]
    crit_out = [{**c, "name": types[c["business_type_key"]].name, "name_plural": types[c["business_type_key"]].name_plural,
                 "precision": types[c["business_type_key"]].precision, "note": types[c["business_type_key"]].note,
                 "source": types[c["business_type_key"]].source}
                for c in criteria]
    if income:  # a renda é o último elemento dos arrays por cidade (ord 99)
        crit_out.append({"business_type_key": INCOME_KEY, "direction": income["direction"], "weight": income["weight"]})
    result = json.dumps({
        **base,
        "status": "ok",
        "criteria": crit_out,
        "income": {  # uma vez só: a cidade traz a mediana; nota, mensagem e fonte saem daqui
            "note": INCOME_NOTE,
            "missing": NO_DATA.format(item="renda"),
            "source": income_source(db),
        },
        "columns": COLUMNS,
        "rows": "__ROWS__",
        "counts": {"in_scope": sc["in_scope"], "with_data": sc["with_data"], "below_min_population": sc["below_min_pop"],
                   "without_income": sc["without_income"] if income else 0, "analyzed": analyzed},
        "sources": sources,
        "data_version": version,
    }, ensure_ascii=False, separators=(",", ":"), default=str).replace('"__ROWS__"', rows_json, 1)
    result = (result, gzip.compress(result.encode(), compresslevel=5))
    with _cache_lock:
        _cache[key] = result
        if len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return result


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
