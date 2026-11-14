"""Censo 2022 (população, área, renda), geometria dos municípios, contagens por município e progresso do ETL

Revision ID: 0005
"""
from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade():
    op.execute(
        """
        -- Censo 2022 por município (ver docs/DATA.md). Nulo = sem dado: nunca estimado.
        ALTER TABLE municipalities
          ADD COLUMN population integer,                 -- v0001, Agregados por municípios (básico)
          ADD COLUMN area_km2 double precision,          -- AREA_KM2 do mesmo arquivo
          ADD COLUMN income_median numeric,              -- V06006, mediana do rendimento do responsável (R$ nominais)
          ADD COLUMN income_households integer,          -- V06001, responsáveis em domicílios particulares permanentes
          -- Malha municipal 2022 em Web Mercator, simplificada por faixa de zoom (tiles vetoriais, docs/PERFORMANCE.md).
          ADD COLUMN geom_low geometry(MultiPolygon, 3857),
          ADD COLUMN geom_mid geometry(MultiPolygon, 3857),
          ADD COLUMN geom_high geometry(MultiPolygon, 3857),
          ADD COLUMN label_point geometry(Point, 4326);
        CREATE INDEX municipalities_geom_low_idx ON municipalities USING gist (geom_low);
        CREATE INDEX municipalities_geom_mid_idx ON municipalities USING gist (geom_mid);
        CREATE INDEX municipalities_geom_high_idx ON municipalities USING gist (geom_high);

        -- Renda do bairro/área. ibge_bairro = mediana publicada pelo IBGE para o bairro;
        -- setores = média das medianas dos setores, ponderada pelos responsáveis (aproximado).
        ALTER TABLE neighborhoods
          ADD COLUMN income_median numeric,
          ADD COLUMN income_households integer,
          ADD COLUMN income_method text CHECK (income_method IN ('ibge_bairro', 'setores'));

        -- Valores brutos do Censo (Agregados por setores/bairros, renda do responsável). "X" (sigilo) = nulo.
        CREATE TABLE census_income (
          level text NOT NULL CHECK (level IN ('setor', 'bairro')),
          code text NOT NULL,
          households integer,
          median numeric,
          PRIMARY KEY (level, code)
        );
        -- Setor censitário -> área (só cidades sem bairro formal; ver ibge_boundaries.area_rows).
        CREATE TABLE census_tracts (
          code text PRIMARY KEY,
          municipality_ibge integer NOT NULL REFERENCES municipalities(ibge),
          unit_code text NOT NULL
        );
        CREATE INDEX census_tracts_unit_idx ON census_tracts (unit_code);

        -- Ranking de cidades: contagem de TODOS os estabelecimentos do município (o município vem do CNPJ,
        -- não depende de localizar o bairro).
        CREATE MATERIALIZED VIEW municipality_type_counts AS
          SELECT e.municipality_ibge, c.business_type_key, count(*)::int AS n_establishments
          FROM establishments e JOIN business_type_cnae c ON c.cnae = e.cnae_main
          GROUP BY e.municipality_ibge, c.business_type_key;
        CREATE UNIQUE INDEX mtc_pk ON municipality_type_counts (business_type_key, municipality_ibge);

        -- Carga em lote retomável (app.etl.load_br): uma linha por UF e etapa concluída.
        CREATE TABLE etl_progress (
          uf char(2) NOT NULL,
          step text NOT NULL,
          reference text NOT NULL,
          done_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (uf, step)
        );
        """
    )


def downgrade():
    op.execute(
        """
        DROP TABLE etl_progress, census_tracts, census_income;
        DROP MATERIALIZED VIEW municipality_type_counts;
        ALTER TABLE neighborhoods DROP COLUMN income_median, DROP COLUMN income_households, DROP COLUMN income_method;
        ALTER TABLE municipalities DROP COLUMN population, DROP COLUMN area_km2, DROP COLUMN income_median,
          DROP COLUMN income_households, DROP COLUMN geom_low, DROP COLUMN geom_mid, DROP COLUMN geom_high, DROP COLUMN label_point;
        """
    )
