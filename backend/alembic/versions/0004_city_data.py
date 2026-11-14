"""bairros/áreas, estabelecimentos e contagens

Revision ID: 0004
"""
from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade():
    op.execute(
        """
        CREATE TABLE neighborhoods (
          id serial PRIMARY KEY,
          municipality_ibge integer NOT NULL REFERENCES municipalities(ibge),
          ibge_code text NOT NULL UNIQUE,
          name text NOT NULL,
          name_normalized text NOT NULL,
          -- bairro = limite oficial do IBGE; area = agrupamento de setores censitários (cidade sem bairro formal)
          kind text NOT NULL DEFAULT 'bairro' CHECK (kind IN ('bairro', 'area')),
          -- textos do CNPJ que indicam esta área sem ambiguidade (ex.: "centro" -> área urbana da sede). Ver docs/DATA.md.
          aliases text[] NOT NULL DEFAULT '{}',
          geom geometry(MultiPolygon, 4326) NOT NULL,
          geom_simplified geometry(MultiPolygon, 4326) NOT NULL,  -- só para o mapa (ver docs/PERFORMANCE.md)
          label_point geometry(Point, 4326) NOT NULL,              -- onde desenhar o número da posição
          area_km2 double precision,                              -- nulo/0 = área inválida, fica fora do ranking
          source text NOT NULL,
          source_date text NOT NULL
        );
        CREATE INDEX neighborhoods_geom_idx ON neighborhoods USING gist (geom);
        CREATE INDEX neighborhoods_mun_idx ON neighborhoods (municipality_ibge, name_normalized);

        -- Sem razão social, nome fantasia, telefone, e-mail ou sócios (princípio 9).
        -- id = SHA-256 do CNPJ completo: identifica sem guardar o número (CNPJ de MEI identifica pessoa).
        CREATE TABLE establishments (
          id char(64) PRIMARY KEY,
          cnae_main char(7) NOT NULL,
          situation text NOT NULL,
          bairro_raw text,
          bairro_normalized text,
          cep text,
          municipality_ibge integer NOT NULL REFERENCES municipalities(ibge),
          neighborhood_id integer REFERENCES neighborhoods(id) ON DELETE SET NULL,
          match_method text NOT NULL DEFAULT 'none' CHECK (match_method IN ('exact', 'alias', 'trigram', 'none')),
          loaded_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX establishments_mun_idx ON establishments (municipality_ibge, bairro_normalized);
        CREATE INDEX establishments_nb_cnae_idx ON establishments (neighborhood_id, cnae_main);

        ALTER TABLE city_data_status
          ADD COLUMN division_kind text NOT NULL DEFAULT 'bairro' CHECK (division_kind IN ('bairro', 'area')),
          ADD COLUMN located_alias integer NOT NULL DEFAULT 0;

        -- Uma consulta devolve todos os bairros de uma vez; atualizada pelo ETL (REFRESH).
        CREATE MATERIALIZED VIEW neighborhood_type_counts AS
          SELECT e.neighborhood_id, c.business_type_key, count(*)::int AS n_establishments
          FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main
          WHERE e.neighborhood_id IS NOT NULL
          GROUP BY e.neighborhood_id, c.business_type_key;
        CREATE UNIQUE INDEX ntc_pk ON neighborhood_type_counts (business_type_key, neighborhood_id);

        -- Cobertura do bairro: total localizado (todos os tipos) e nível por tercis dentro da cidade.
        CREATE MATERIALIZED VIEW neighborhood_coverage AS
          WITH c AS (
            SELECT n.id, n.municipality_ibge, count(e.id)::int AS located_count
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
        """
    )


def downgrade():
    op.execute(
        "DROP MATERIALIZED VIEW neighborhood_coverage, neighborhood_type_counts; DROP TABLE establishments, neighborhoods; "
        "ALTER TABLE city_data_status DROP COLUMN division_kind, DROP COLUMN located_alias"
    )
