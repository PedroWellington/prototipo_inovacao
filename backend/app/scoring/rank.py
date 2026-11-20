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


NO_COMPARISON = "sem dado suficiente para comparar"
BASIS = "calculado a partir de"


def brl(v) -> str:
    return "R$ " + f"{round(v):,}".replace(",", ".")


def income_text(median, of: str = "do bairro") -> str:
    """Só o dado, sem interpretação (nada de "poder de compra" nem perfil): "Renda mediana do bairro: R$ 5.000/mês"."""
    return f"Renda mediana {of}: {brl(median)}/mês"


def income_comparison(median, city_median) -> str:
    """Só a conta (bairro ÷ cidade − 1) × 100, inteiro (meio para cima); diferença abaixo de 1%: "igual à da cidade".
    Sem um dos dois valores: NO_COMPARISON (nunca estima). "maior"/"menor" descrevem o número, não o lugar."""
    if median is None or not city_median:
        return NO_COMPARISON
    diff = (float(median) / float(city_median) - 1) * 100
    if abs(diff) < 1:
        return "igual à da cidade"
    pct = f"{int(abs(diff) + 0.5):,}".replace(",", ".")
    return f"{pct}% {'maior' if diff > 0 else 'menor'} que a da cidade"


def income_block(median, quartile, approximate: bool, source: dict | None, of: str = "do bairro", city: dict | None = None) -> dict:
    """Renda para a tela, o PDF, os slides e o assistente: valor, quartil, texto só com o valor, fonte e nota.
    Sem valor: a mensagem padrão, nunca estimativa. city = {"median", "source"}: compara o bairro (ou a área) com a
    cidade; a comparação leva a fonte e a data dos dois valores."""
    out = {"label": f"Renda mediana {of}", "note": INCOME_NOTE, "source": source}
    if median is None:
        out |= {"available": False, "message": NO_DATA.format(item="renda")}
    else:
        out |= {"available": True, "median": float(median), "quartile": quartile, "text": income_text(median, of), "approximate": approximate}
    if city is not None:
        city_median = city.get("median")
        ok = median is not None and bool(city_median)
        out["comparison"] = {
            "available": ok,
            "text": income_comparison(median, city_median),
            "city_text": income_text(city_median, "da cidade") if city_median else None,
            "basis": BASIS,
            "sources": [{"of": of.split()[-1], **(source or {})}, {"of": "cidade", **(city.get("source") or {})}],
        }
    return out


def source_line(src: dict | None) -> str:
    src = src or {}
    return f'{src.get("name", "IBGE, Censo 2022")}, ref. {src.get("reference_date", "2022")}'


def sources_line(sources: list[dict]) -> str:
    """Fonte e data de cada valor; a mesma fonte para os dois vira "bairro e cidade, <fonte>, ref. <data>"."""
    lines = [source_line(s) for s in sources]
    if len(set(lines)) == 1:
        return f'{" e ".join(s["of"] for s in sources)}, {lines[0]}'
    return "; ".join(f'{s["of"]}, {line}' for s, line in zip(sources, lines))


def comparison_line(cmp: dict | None) -> str:
    """Comparação com a cidade, só a conta: "300% maior que a da cidade (Renda mediana da cidade: R$ 1.250/mês;
    calculado a partir de: bairro, <fonte>, ref.; cidade, <fonte>, ref.)". Sem um dos valores: "sem dado suficiente"."""
    if not cmp:
        return ""
    if not cmp["available"]:
        return cmp["text"]
    return f'{cmp["text"]} ({cmp["city_text"]}; {cmp["basis"]}: {sources_line(cmp["sources"])})'


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
            SELECT m.ibge, m.name, m.uf, m.income_median, s.loaded_at, s.reference_month, s.total_active, s.located, s.neighborhoods, s.division_kind,
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
    inc_city = {"median": city["income_median"], "source": inc_src}
    of = "da área" if city["division_kind"] == "area" else "do bairro"
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
                "income": income_block(r["income_median"], r["income_quartile"], r["income_method"] == "setores", inc_src, of, inc_city),
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
