"""CNES como fonte principal de tipos de saúde (hospital), CNPJ como complemento

Revision ID: 0007
"""
from alembic import op

revision = "0007"
down_revision = "0006"

# n_establishments = contagem da fonte principal do tipo (business_types.source); n_cnpj = locais no CNPJ (complemento).
VIEWS = """
    CREATE MATERIALIZED VIEW neighborhood_type_counts AS
      WITH cnpj AS (
        SELECT e.neighborhood_id AS unit, c.business_type_key AS key, count(DISTINCT coalesce(e.location_id, e.id))::int AS n
        FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main
        WHERE e.neighborhood_id IS NOT NULL GROUP BY 1, 2
      ), cnes AS (
        SELECT h.neighborhood_id AS unit, m.business_type_key AS key, count(*)::int AS n
        FROM health_units h JOIN business_type_cnes m ON m.tp_unidade = h.tp_unidade
        WHERE h.neighborhood_id IS NOT NULL GROUP BY 1, 2
      )
      SELECT coalesce(a.unit, b.unit) AS neighborhood_id, t.key AS business_type_key,
             CASE t.source WHEN 'cnes' THEN coalesce(b.n, 0) ELSE coalesce(a.n, 0) END AS n_establishments,
             coalesce(a.n, 0) AS n_cnpj
      FROM cnpj a FULL JOIN cnes b ON b.unit = a.unit AND b.key = a.key
      JOIN business_types t ON t.key = coalesce(a.key, b.key);
    CREATE UNIQUE INDEX ntc_pk ON neighborhood_type_counts (business_type_key, neighborhood_id);

    CREATE MATERIALIZED VIEW municipality_type_counts AS
      WITH cnpj AS (
        SELECT e.municipality_ibge AS unit, c.business_type_key AS key, count(DISTINCT coalesce(e.location_id, e.id))::int AS n
        FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main GROUP BY 1, 2
      ), cnes AS (
        SELECT h.municipality_ibge AS unit, m.business_type_key AS key, count(*)::int AS n
        FROM health_units h JOIN business_type_cnes m ON m.tp_unidade = h.tp_unidade GROUP BY 1, 2
      )
      SELECT coalesce(a.unit, b.unit) AS municipality_ibge, t.key AS business_type_key,
             CASE t.source WHEN 'cnes' THEN coalesce(b.n, 0) ELSE coalesce(a.n, 0) END AS n_establishments,
             coalesce(a.n, 0) AS n_cnpj
      FROM cnpj a FULL JOIN cnes b ON b.unit = a.unit AND b.key = a.key
      JOIN business_types t ON t.key = coalesce(a.key, b.key);
    CREATE UNIQUE INDEX mtc_pk ON municipality_type_counts (business_type_key, municipality_ibge);
"""


def upgrade():
    op.execute(
        """
        ALTER TABLE business_types ADD COLUMN source text NOT NULL DEFAULT 'cnpj' CHECK (source IN ('cnpj', 'cnes'));
        -- Tipo do catálogo -> tipo de unidade do CNES (TP_UNIDADE). Dado editável: backend/app/seed/business_type_cnes.csv
        CREATE TABLE business_type_cnes (
          business_type_key text NOT NULL REFERENCES business_types(key) ON DELETE CASCADE,
          tp_unidade text NOT NULL,
          description text NOT NULL,
          PRIMARY KEY (business_type_key, tp_unidade)
        );
        -- Unidades ativas do CNES dos tipos mapeados. Sem nome, telefone ou responsável: só código, tipo e lugar.
        -- O bairro vem da coordenada (ponto-em-polígono), não do texto do endereço.
        CREATE TABLE health_units (
          cnes text PRIMARY KEY,
          tp_unidade text NOT NULL,
          municipality_ibge integer NOT NULL REFERENCES municipalities(ibge),
          neighborhood_id integer REFERENCES neighborhoods(id) ON DELETE SET NULL
        );
        CREATE INDEX health_units_nb_idx ON health_units (neighborhood_id);
        DROP MATERIALIZED VIEW neighborhood_type_counts, municipality_type_counts;
        """
        + VIEWS
    )


def downgrade():
    op.execute(
        """
        DROP MATERIALIZED VIEW neighborhood_type_counts, municipality_type_counts;
        DROP TABLE health_units, business_type_cnes;
        ALTER TABLE business_types DROP COLUMN source;
        CREATE MATERIALIZED VIEW neighborhood_type_counts AS
          SELECT e.neighborhood_id, c.business_type_key, count(DISTINCT coalesce(e.location_id, e.id))::int AS n_establishments
          FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main
          WHERE e.neighborhood_id IS NOT NULL GROUP BY 1, 2;
        CREATE UNIQUE INDEX ntc_pk ON neighborhood_type_counts (business_type_key, neighborhood_id);
        CREATE MATERIALIZED VIEW municipality_type_counts AS
          SELECT e.municipality_ibge, c.business_type_key, count(DISTINCT coalesce(e.location_id, e.id))::int AS n_establishments
          FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main GROUP BY 1, 2;
        CREATE UNIQUE INDEX mtc_pk ON municipality_type_counts (business_type_key, municipality_ibge);
        """
    )
