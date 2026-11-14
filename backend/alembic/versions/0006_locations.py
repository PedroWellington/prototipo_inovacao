"""estabelecimento = local distinto (CEP + logradouro + número), não CNPJ

Revision ID: 0006
"""
from alembic import op

revision = "0006"
down_revision = "0005"

VIEWS = """
    -- Conta LOCAIS distintos (ver docs/DATA.md): CNPJs no mesmo CEP + logradouro + número contam uma vez.
    CREATE MATERIALIZED VIEW neighborhood_type_counts AS
      SELECT e.neighborhood_id, c.business_type_key, count(DISTINCT coalesce(e.location_id, e.id))::int AS n_establishments
      FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main
      WHERE e.neighborhood_id IS NOT NULL
      GROUP BY e.neighborhood_id, c.business_type_key;
    CREATE UNIQUE INDEX ntc_pk ON neighborhood_type_counts (business_type_key, neighborhood_id);

    CREATE MATERIALIZED VIEW neighborhood_coverage AS
      WITH c AS (
        SELECT n.id, n.municipality_ibge, count(DISTINCT coalesce(e.location_id, e.id))::int AS located_count
        FROM neighborhoods n LEFT JOIN establishments e ON e.neighborhood_id = n.id
        GROUP BY n.id
      )
      SELECT id AS neighborhood_id, located_count,
             CASE WHEN located_count = 0 THEN 'low'
                  WHEN pr < 1.0 / 3 THEN 'low'
                  WHEN pr < 2.0 / 3 THEN 'medium'
                  ELSE 'high' END AS level
      FROM (SELECT *, percent_rank() OVER (PARTITION BY municipality_ibge ORDER BY located_count) AS pr FROM c) t;
    CREATE UNIQUE INDEX nc_pk ON neighborhood_coverage (neighborhood_id);

    CREATE MATERIALIZED VIEW municipality_type_counts AS
      SELECT e.municipality_ibge, c.business_type_key, count(DISTINCT coalesce(e.location_id, e.id))::int AS n_establishments
      FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main
      GROUP BY e.municipality_ibge, c.business_type_key;
    CREATE UNIQUE INDEX mtc_pk ON municipality_type_counts (business_type_key, municipality_ibge);
"""


def upgrade():
    op.execute(
        """
        -- Identificador do local: o hash de CNPJ de um dos estabelecimentos do mesmo endereço (o menor).
        -- Não guarda endereço nem hash de endereço (enumerável): só diz que estes CNPJs dividem um local.
        ALTER TABLE establishments ADD COLUMN location_id char(64);
        DROP MATERIALIZED VIEW neighborhood_coverage, neighborhood_type_counts, municipality_type_counts;
        """
        + VIEWS
    )


def downgrade():
    op.execute(
        "DROP MATERIALIZED VIEW neighborhood_coverage, neighborhood_type_counts, municipality_type_counts; "
        + VIEWS.replace("count(DISTINCT coalesce(e.location_id, e.id))", "count(e.id)")
        + "ALTER TABLE establishments DROP COLUMN location_id;"
    )
