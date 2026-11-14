"""Atualiza as contagens por bairro/tipo, a cobertura e o status de cada cidade carregada."""
import json

from sqlalchemy import text

from app.etl.locate import unmatched_top
from app.etl.sources import IBGE_BAIRROS_URL, IBGE_SETORES_URL, RFB_SHARE_PAGE


def refresh_views(conn) -> None:
    # CONCURRENTLY: a API continua lendo a versão anterior enquanto atualiza.
    conn.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY neighborhood_type_counts"))
    conn.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY neighborhood_coverage"))


STATUS_SQL = text(
    """
    SELECT (SELECT count(*) FROM neighborhoods WHERE municipality_ibge = :m) AS neighborhoods,
           (SELECT CASE WHEN bool_or(kind = 'bairro') THEN 'bairro' ELSE 'area' END
              FROM neighborhoods WHERE municipality_ibge = :m) AS division_kind,
           count(*) AS total_active,
           count(neighborhood_id) AS located,
           count(*) FILTER (WHERE match_method = 'exact') AS located_exact,
           count(*) FILTER (WHERE match_method = 'alias') AS located_alias,
           count(*) FILTER (WHERE match_method = 'trigram') AS located_trigram
    FROM establishments WHERE municipality_ibge = :m
    """
)


def save_status(conn, munis: list[int], month: str) -> list[dict]:
    """Uma linha em city_data_status por cidade com bairros/áreas. Devolve as estatísticas por cidade."""
    out = []
    for m in munis:
        stats = dict(conn.execute(STATUS_SQL, {"m": m}).mappings().one())
        if not stats["neighborhoods"]:
            continue  # sem limites intramunicipais: a cidade não fica disponível
        conn.execute(
            text(
                """
                INSERT INTO city_data_status (municipality_ibge, loaded_at, reference_month, neighborhoods, total_active,
                                              located, located_exact, located_trigram, unmatched_top, division_kind, located_alias)
                VALUES (:m, now(), :month, :neighborhoods, :total_active, :located, :located_exact, :located_trigram,
                        CAST(:top AS jsonb), :division_kind, :located_alias)
                ON CONFLICT (municipality_ibge) DO UPDATE SET
                  loaded_at = now(), reference_month = EXCLUDED.reference_month, neighborhoods = EXCLUDED.neighborhoods,
                  total_active = EXCLUDED.total_active, located = EXCLUDED.located, located_exact = EXCLUDED.located_exact,
                  located_trigram = EXCLUDED.located_trigram, unmatched_top = EXCLUDED.unmatched_top,
                  division_kind = EXCLUDED.division_kind, located_alias = EXCLUDED.located_alias
                """
            ),
            {"m": m, "month": month, "top": json.dumps(unmatched_top(conn, m), ensure_ascii=False), **stats},
        )
        out.append({"ibge": m, **stats})
    return out


def save_sources(conn, uf: str, month: str) -> None:
    sources = [
        ("ibge_bairros", "IBGE, Malha de Bairros (Censo Demográfico 2022)", IBGE_BAIRROS_URL.format(uf=uf), "2022"),
        ("ibge_setores", "IBGE, Malha de Setores Censitários (Censo Demográfico 2022)", IBGE_SETORES_URL.format(uf=uf), "2022"),
        ("rfb_cnpj", "Receita Federal, dados abertos do CNPJ (Estabelecimentos)", RFB_SHARE_PAGE, month),
        ("ibge_malhas", "IBGE, API de malhas territoriais v3", "https://servicodados.ibge.gov.br/api/docs/malhas?versao=3", "versão vigente na API"),
    ]
    conn.execute(
        text(
            "INSERT INTO data_sources VALUES (:k, :n, :u, :d, NULL) "
            "ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, reference_date = EXCLUDED.reference_date"
        ),
        [{"k": k, "n": n, "u": u, "d": d} for k, n, u, d in sources],
    )


def densest_report(conn, mun: int) -> list[dict]:
    """Contagem por tipo nos 5 bairros/áreas com mais estabelecimentos localizados."""
    return [
        dict(r)
        for r in conn.execute(
            text(
                """
                SELECT n.name, c.located_count,
                       (SELECT json_object_agg(t.business_type_key, t.n_establishments ORDER BY t.business_type_key)
                        FROM neighborhood_type_counts t WHERE t.neighborhood_id = n.id) AS by_type
                FROM neighborhoods n JOIN neighborhood_coverage c ON c.neighborhood_id = n.id
                WHERE n.municipality_ibge = :m ORDER BY c.located_count DESC, n.name LIMIT 5
                """
            ),
            {"m": mun},
        ).mappings()
    ]
