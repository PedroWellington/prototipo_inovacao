"""catálogo (segmentos, tipos, CNAE) e geografia (regiões, estados, municípios, cache de malhas)

Revision ID: 0002
"""
from alembic import op

revision = "0002"
down_revision = "0001"


def upgrade():
    op.execute(
        """
        CREATE TABLE regions (
          id smallint PRIMARY KEY,
          sigla text NOT NULL,
          name text NOT NULL
        );
        CREATE TABLE states (
          ibge smallint PRIMARY KEY,
          uf char(2) NOT NULL UNIQUE,
          name text NOT NULL,
          region_id smallint NOT NULL REFERENCES regions(id)
        );
        CREATE TABLE municipalities (
          ibge integer PRIMARY KEY,
          name text NOT NULL,
          name_normalized text NOT NULL,
          uf char(2) NOT NULL REFERENCES states(uf),
          rfb_code text  -- código do município na base do CNPJ (tabela TOM da Receita)
        );
        CREATE INDEX municipalities_uf_idx ON municipalities(uf);
        CREATE INDEX municipalities_rfb_idx ON municipalities(rfb_code);

        CREATE TABLE geo_cache (
          key text PRIMARY KEY,
          geojson text NOT NULL,
          etag text NOT NULL,
          fetched_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE segments (
          key text PRIMARY KEY,
          name text NOT NULL,
          sort smallint NOT NULL
        );
        CREATE TABLE business_types (
          key text PRIMARY KEY,
          name text NOT NULL,
          name_plural text NOT NULL,
          precision text NOT NULL CHECK (precision IN ('exact', 'approx')),
          note text,
          selectable boolean NOT NULL DEFAULT true
        );
        CREATE TABLE business_type_cnae (
          business_type_key text NOT NULL REFERENCES business_types(key) ON DELETE CASCADE,
          cnae char(7) NOT NULL,
          description text NOT NULL,
          verified boolean NOT NULL,
          PRIMARY KEY (business_type_key, cnae)
        );
        CREATE INDEX business_type_cnae_cnae_idx ON business_type_cnae(cnae);
        CREATE TABLE segment_defaults (
          segment_key text NOT NULL REFERENCES segments(key) ON DELETE CASCADE,
          business_type_key text NOT NULL REFERENCES business_types(key) ON DELETE CASCADE,
          direction text NOT NULL CHECK (direction IN ('attract', 'repel')),
          weight smallint NOT NULL CHECK (weight BETWEEN 1 AND 5),
          PRIMARY KEY (segment_key, business_type_key)
        );

        -- Uma linha por cidade carregada pelo ETL; alimenta "tem dados?", cobertura e datas.
        CREATE TABLE city_data_status (
          municipality_ibge integer PRIMARY KEY REFERENCES municipalities(ibge),
          loaded_at timestamptz NOT NULL,
          reference_month text NOT NULL,
          neighborhoods integer NOT NULL,
          total_active integer NOT NULL,
          located integer NOT NULL,
          located_exact integer NOT NULL,
          located_trigram integer NOT NULL,
          unmatched_top jsonb NOT NULL DEFAULT '[]'
        );

        CREATE TABLE data_sources (
          key text PRIMARY KEY,
          name text NOT NULL,
          url text NOT NULL,
          reference_date text NOT NULL,
          notes text
        );
        """
    )


def downgrade():
    op.execute(
        "DROP TABLE data_sources, city_data_status, segment_defaults, business_type_cnae, business_types, segments, "
        "geo_cache, municipalities, states, regions"
    )
