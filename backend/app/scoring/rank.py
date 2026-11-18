"""Motor único de ranking. Toda a conta (densidade, percentil, nota, posição) é feita no SQL abaixo.

Fórmula e exemplo numérico: docs/SCORING.md. Nenhuma chamada externa acontece aqui.
"""
from collections import OrderedDict
from threading import Lock

from sqlalchemy import text
from sqlalchemy.orm import Session

NO_DATA = "Não foi possível encontrar dados de {item} desta área."
# Versão do catálogo para o cache: mapeamentos tipo -> CNAE e tipo -> CNES, fonte de cada tipo e última carga do CNES.
CATALOG_VERSION_SQL = """
    SELECT md5(coalesce((SELECT string_agg(business_type_key || cnae, ',' ORDER BY business_type_key, cnae) FROM business_type_cnae), '')
               || coalesce((SELECT string_agg(business_type_key || tp_unidade, ',' ORDER BY business_type_key, tp_unidade) FROM business_type_cnes), '')
               || coalesce((SELECT string_agg(key || source, ',' ORDER BY key) FROM business_types), '')
               || coalesce((SELECT done_at::text FROM etl_progress WHERE uf = 'BR' AND step = 'cnes'), ''))
"""
TYPES_SQL = text("""SELECT t.key, t.name, t.name_plural, t.precision, t.note, t.source, count(c.cnae) AS n_cnae, (SELECT count(*) FROM business_type_cnes x WHERE x.business_type_key = t.key) AS n_cnes FROM business_types t LEFT JOIN business_type_cnae c ON c.business_type_key = t.key WHERE t.key = ANY(:k) GROUP BY t.key""")


def missing_types(types: dict, keys: list[str]) -> list[str]:
    """Tipo sem mapeamento na sua fonte (CNAE para cnpj, TP_UNIDADE para cnes): não calcula e não assume zero."""
    return [k for k in keys if k not in types or (types[k].n_cnes if types[k].source == "cnes" else types[k].n_cnae) == 0]
INCOME_NOTE = "Renda é um indicador e não determina preferências."
# Quartil da mediana de renda na referência (1º = abaixo; 2º e 3º = próximo; 4º = acima).
INCOME_LEVEL = {1: "below", 2: "near", 3: "near", 4: "above"}
INCOME_TEXT = {
    "above": "Poder de compra acima da média {ref}. Perfil compatível com oferta premium.",
    "near": "Poder de compra próximo da média {ref}. Perfil compatível com oferta mista.",
    "below": "Poder de compra abaixo da média {ref}. Perfil compatível com oferta de melhor custo-benefício.",
}


def income_block(median, quartile, ref: str, approximate: bool, source: dict | None) -> dict:
    """Renda para a tela: valor, quartil, frase padrão, fonte e nota. Sem valor: a mensagem padrão, nunca estimativa."""
    if median is None:
        return {"available": False, "message": NO_DATA.format(item="renda"), "note": INCOME_NOTE, "source": source}
    level = INCOME_LEVEL[quartile]
    return {
        "available": True,
        "median": float(median),
        "quartile": quartile,
        "level": level,
        "text": INCOME_TEXT[level].format(ref=ref),
        "approximate": approximate,
        "note": INCOME_NOTE,
        "source": source,
    }


def income_source(db: Session) -> dict | None:
    r = db.execute(text("SELECT name, url, reference_date FROM data_sources WHERE key = 'ibge_censo_renda'")).mappings().first()
    return dict(r) if r else None

RANK_SQL = text(
    """
    WITH crit AS (
      SELECT * FROM unnest(CAST(:keys AS text[]), CAST(:dirs AS text[]), CAST(:weights AS int[]))
             WITH ORDINALITY AS c(key, dir, w, ord)
    ), nb AS (
      SELECT id, name, area_km2 FROM neighborhoods WHERE municipality_ibge = :m AND area_km2 > 0
    ), q AS (
      -- quartis da renda entre os bairros/áreas da cidade que têm o dado
      SELECT percentile_cont(ARRAY[0.25, 0.5, 0.75]) WITHIN GROUP (ORDER BY income_median) AS q
      FROM neighborhoods WHERE municipality_ibge = :m AND income_median IS NOT NULL
    ), d AS (
      -- densidade = estabelecimentos do tipo / área do bairro (km²). Zero aqui é contagem real: a cidade tem dados.
      SELECT nb.id, nb.name, c.key, c.dir, c.w, c.ord,
             coalesce(t.n_establishments, 0) AS n, coalesce(t.n_cnpj, 0) AS n_cnpj,
             coalesce(t.n_establishments, 0) / nb.area_km2 AS density
      FROM nb CROSS JOIN crit c
      LEFT JOIN neighborhood_type_counts t ON t.neighborhood_id = nb.id AND t.business_type_key = c.key
    ), p AS (
      -- percentil da densidade entre os bairros da cidade; empates recebem o mesmo valor; todos empatados = 0.
      SELECT d.*,
             percent_rank() OVER (PARTITION BY key ORDER BY density) AS pct,
             coalesce((rank() OVER (PARTITION BY key ORDER BY density DESC) - 1)::float
                      / nullif(count(*) OVER (PARTITION BY key) - 1, 0), 0) AS higher_share
      FROM d
    ), f0 AS (
      SELECT p.*, CASE dir WHEN 'attract' THEN pct ELSE 1 - pct END AS fit FROM p
    ), f AS (
      -- position: posição do bairro só neste critério (empate = mesma posição);
      -- contribution: pontos que o critério soma (+) ou tira (-) a partir de 50. nota = 50 + soma das contribuições.
      SELECT f0.*, rank() OVER (PARTITION BY key ORDER BY fit DESC) AS position,
             100 * w * (fit - 0.5) / sum(w) OVER (PARTITION BY id) AS contribution
      FROM f0
    ), s AS (
      SELECT id, name,
             100 * sum(w * fit) / sum(w) AS score,
             json_agg(json_build_object(
               'type', key, 'direction', dir, 'weight', w, 'n', n, 'n_cnpj', n_cnpj,
               'density_per_km2', round(density::numeric, 2), 'percentile', round(pct::numeric, 4),
               'lower_share', round(pct::numeric, 4), 'higher_share', round(higher_share::numeric, 4),
               'position', position, 'contribution', round(contribution::numeric, 1)
             ) ORDER BY ord) AS criteria
      FROM f GROUP BY id, name
    )
    SELECT s.id, s.name, round(s.score::numeric, 1) AS score,
           -- arredonda antes de ordenar: elimina ruído de ponto flutuante; empate -> nome -> id.
           -- COLLATE "C": a mesma ordem em qualquer servidor (o local é en_US, o Neon é C.UTF-8)
           row_number() OVER (ORDER BY round(s.score::numeric, 6) DESC, s.name COLLATE "C", s.id) AS rank,
           c.level AS coverage_level, c.located_count, s.criteria,
           n.income_median, n.income_method,
           CASE WHEN n.income_median IS NULL THEN NULL WHEN n.income_median <= q.q[1] THEN 1
                WHEN n.income_median <= q.q[2] THEN 2 WHEN n.income_median <= q.q[3] THEN 3 ELSE 4 END AS income_quartile
    FROM s JOIN neighborhood_coverage c ON c.neighborhood_id = s.id
    JOIN neighborhoods n ON n.id = s.id CROSS JOIN q
    ORDER BY rank
    """
)

# Cache do resultado por (cidade, critérios ordenados, versão dos dados).
_cache: OrderedDict = OrderedDict()
_cache_lock = Lock()
CACHE_SIZE = 512


def comparison_text(direction: str, lower: float, higher: float, division_kind: str = "bairro") -> str:
    units, others = ("dos bairros", "os demais bairros") if division_kind == "bairro" else ("das áreas", "as demais áreas")
    if lower == 0 and higher == 0:
        return f"mesma densidade que {others}"
    more = f"mais densidade que {round(lower * 100)}% {units}"
    less = f"menos densidade que {round(higher * 100)}% {units}"
    # Mostra o lado que descreve o critério (perto: "mais que"; longe: "menos que"), se ele existir.
    if direction == "attract":
        return more if lower > 0 else less
    return less if higher > 0 else more


def city_context(db: Session, ibge: int):
    return db.execute(
        text(
            """
            SELECT m.ibge, m.name, m.uf, s.loaded_at, s.reference_month, s.total_active, s.located, s.neighborhoods, s.division_kind,
                   (""" + CATALOG_VERSION_SQL + """) AS catalog_version
            FROM municipalities m LEFT JOIN city_data_status s ON s.municipality_ibge = m.ibge
            WHERE m.ibge = :m
            """
        ),
        {"m": ibge},
    ).mappings().first()


def sources(db: Session, division_kind: str) -> list[dict]:
    # Só a malha usada pela cidade: bairros da malha do IBGE ou setores censitários (áreas).
    skip = "ibge_setores" if division_kind == "bairro" else "ibge_bairros"
    rows = db.execute(
        text("SELECT key, name, url, reference_date FROM data_sources WHERE key <> :skip ORDER BY key"), {"skip": skip}
    ).mappings().all()
    return [dict(r) for r in rows]


def rank(db: Session, ibge: int, criteria: list[dict]) -> dict:
    city = city_context(db, ibge)
    if city is None:
        return {"status": "not_found", "message": "Cidade não encontrada."}
    base = {"city": {"ibge": city["ibge"], "name": city["name"], "uf": city["uf"], "division_kind": city["division_kind"]}}
    if city["loaded_at"] is None:
        return {**base, "status": "no_data", "message": NO_DATA.format(item="estabelecimentos")}
    if not criteria:
        return {**base, "status": "no_criteria", "message": "Adicione pelo menos um critério para ordenar os bairros."}

    keys = [c["business_type_key"] for c in criteria]
    types = {r.key: r for r in db.execute(TYPES_SQL, {"k": keys})}
    missing = missing_types(types, keys)
    if missing:
        # Tipo sem CNAE mapeado: não calcula e não assume zero.
        names = [types[k].name_plural if k in types else k for k in missing]
        return {
            **base,
            "status": "no_data",
            "missing_types": missing,
            "message": " ".join(NO_DATA.format(item=n.lower()) for n in names),
        }

    version = f"{city['loaded_at'].isoformat()}|{city['catalog_version']}"
    key = (ibge, tuple(sorted((c["business_type_key"], c["direction"], c["weight"]) for c in criteria)), version)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]

    rows = db.execute(
        RANK_SQL,
        {"m": ibge, "keys": keys, "dirs": [c["direction"] for c in criteria], "weights": [c["weight"] for c in criteria]},
    ).mappings().all()
    excluded = db.execute(
        text("SELECT id, name FROM neighborhoods WHERE municipality_ibge = :m AND NOT (area_km2 > 0) ORDER BY name COLLATE \"C\""),
        {"m": ibge},
    ).mappings().all()

    inc_src = income_source(db)
    neighborhoods = []
    for r in rows:
        crit = []
        for c in r["criteria"]:
            crit.append(
                {
                    **c,
                    "density_per_km2": float(c["density_per_km2"]),
                    "comparison_text": comparison_text(
                        c["direction"], float(c["lower_share"]), float(c["higher_share"]), city["division_kind"]
                    ),
                }
            )
        neighborhoods.append(
            {
                "id": r["id"],
                "name": r["name"],
                "score": float(r["score"]),
                "rank": r["rank"],
                "coverage": {"level": r["coverage_level"], "located_count": r["located_count"]},
                "criteria": crit,
                "income": income_block(r["income_median"], r["income_quartile"], "da cidade", r["income_method"] == "setores", inc_src),
            }
        )

    total, located = city["total_active"], city["located"]
    result = {
        **base,
        "status": "ok",
        "criteria": [
            {**c, "name": types[c["business_type_key"]].name, "name_plural": types[c["business_type_key"]].name_plural,
             "precision": types[c["business_type_key"]].precision, "note": types[c["business_type_key"]].note,
             "source": types[c["business_type_key"]].source}
            for c in criteria
        ],
        "neighborhoods": neighborhoods,
        "count": len(neighborhoods),
        "excluded": [{"id": e["id"], "name": e["name"], "reason": "área inválida no limite do IBGE"} for e in excluded],
        "city_coverage": {"total_active": total, "located": located, "share": round(located / total, 4) if total else 0},
        "sources": sources(db, city["division_kind"]),
        "reference_dates": {"establishments": city["reference_month"], "boundaries": "2022"},
        "division_kind": city["division_kind"],
        "data_version": version,
    }
    with _cache_lock:
        _cache[key] = result
        if len(_cache) > CACHE_SIZE:
            _cache.popitem(last=False)
    return result


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
