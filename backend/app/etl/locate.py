"""Atribui cada estabelecimento a um bairro/área pelo texto do campo BAIRRO do CNPJ (opção B do PDF).

Em ordem, sempre dentro do mesmo município:
1) casamento exato do nome normalizado (sem acento, minúsculo, sem pontuação), só com nome único na cidade;
2) alias documentado (ex.: "centro" -> área urbana da sede, em cidade sem bairro formal), só se único;
3) casamento aproximado (pg_trgm), só quando há UM único bairro/área acima do limiar.
Em dúvida, não atribui: prefira "não localizado" a localizar errado.
"""
from sqlalchemy import text

TRIGRAM_THRESHOLD = 0.85


def run(conn, munis: list[int], threshold: float = TRIGRAM_THRESHOLD) -> dict:
    p = {"m": munis, "th": threshold}
    conn.execute(
        text("UPDATE establishments SET neighborhood_id = NULL, match_method = 'none' WHERE municipality_ibge = ANY(:m)"), p
    )
    exact = conn.execute(
        text(
            """
            WITH u AS (
              SELECT municipality_ibge AS mun, name_normalized, min(id) AS id FROM neighborhoods
              WHERE municipality_ibge = ANY(:m) GROUP BY 1, 2 HAVING count(*) = 1
            )
            UPDATE establishments e SET neighborhood_id = u.id, match_method = 'exact'
            FROM u WHERE e.municipality_ibge = u.mun AND e.bairro_normalized = u.name_normalized
            """
        ),
        p,
    ).rowcount
    alias = conn.execute(
        text(
            """
            WITH a AS (
              SELECT municipality_ibge AS mun, alias, min(id) AS id
              FROM neighborhoods, unnest(aliases) AS alias
              WHERE municipality_ibge = ANY(:m) GROUP BY 1, 2 HAVING count(*) = 1
            )
            UPDATE establishments e SET neighborhood_id = a.id, match_method = 'alias'
            FROM a WHERE e.municipality_ibge = a.mun AND e.neighborhood_id IS NULL AND e.bairro_normalized = a.alias
            """
        ),
        p,
    ).rowcount
    trigram = conn.execute(
        text(
            """
            WITH t AS (
              SELECT DISTINCT municipality_ibge AS mun, bairro_normalized AS b FROM establishments
              WHERE municipality_ibge = ANY(:m) AND neighborhood_id IS NULL AND bairro_normalized IS NOT NULL
            ), cand AS (
              SELECT t.mun, t.b, n.id FROM t JOIN neighborhoods n ON n.municipality_ibge = t.mun
              WHERE similarity(t.b, n.name_normalized) >= :th
            ), uniq AS (
              SELECT mun, b, min(id) AS id FROM cand GROUP BY mun, b HAVING count(*) = 1
            )
            UPDATE establishments e SET neighborhood_id = uniq.id, match_method = 'trigram'
            FROM uniq WHERE e.municipality_ibge = uniq.mun AND e.neighborhood_id IS NULL AND e.bairro_normalized = uniq.b
            """
        ),
        p,
    ).rowcount
    return {"exact": exact, "alias": alias, "trigram": trigram, "threshold": threshold}


def unmatched_top(conn, mun: int, limit: int = 20) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT coalesce(bairro_raw, '(vazio)') AS text, count(*)::int AS n FROM establishments
            WHERE municipality_ibge = :m AND neighborhood_id IS NULL
            GROUP BY 1 ORDER BY n DESC, text LIMIT :l
            """
        ),
        {"m": mun, "l": limit},
    ).mappings()
    return [dict(r) for r in rows]


def trigram_examples(conn, munis: list[int], limit: int = 15) -> list[dict]:
    rows = conn.execute(
        text(
            """
            SELECT m.name AS city, e.bairro_raw, n.name, count(*)::int AS n
            FROM establishments e JOIN neighborhoods n ON n.id = e.neighborhood_id JOIN municipalities m ON m.ibge = e.municipality_ibge
            WHERE e.municipality_ibge = ANY(:m) AND e.match_method = 'trigram'
            GROUP BY 1, 2, 3 ORDER BY n DESC LIMIT :l
            """
        ),
        {"m": munis, "l": limit},
    ).mappings()
    return [dict(r) for r in rows]
