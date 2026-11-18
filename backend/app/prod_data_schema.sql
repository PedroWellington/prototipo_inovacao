-- Banco de dados de LEITURA do protótipo em produção (vicus-dados): só o que a API consulta.
-- Criado e preenchido por scripts/build_prod_db.py a partir do banco completo (ETL). Ver docs/DATA.md.
-- Fora daqui (peso morto para a API): establishments, health_units, census_tracts, census_income,
-- neighborhoods.geom (original), colunas do ETL (name_normalized, aliases, rfb_code, ibge_code, kind, source...).
CREATE EXTENSION IF NOT EXISTS postgis;

DROP TABLE IF EXISTS neighborhood_coverage, municipality_type_counts, neighborhood_type_counts, geo_cache, etl_progress,
  data_sources, segment_defaults, business_type_cnes, business_type_cnae, business_types, segments,
  city_data_status, neighborhoods, municipalities, states, regions CASCADE;

CREATE TABLE regions (id smallint PRIMARY KEY, sigla text NOT NULL, name text NOT NULL);
CREATE TABLE states (
  ibge smallint PRIMARY KEY, uf char(2) NOT NULL UNIQUE, name text NOT NULL,
  region_id smallint NOT NULL REFERENCES regions(id)
);
CREATE TABLE municipalities (
  ibge integer PRIMARY KEY, name text NOT NULL, uf char(2) NOT NULL REFERENCES states(uf),
  population integer, area_km2 double precision, income_median numeric,
  geom_low geometry(MultiPolygon, 3857), geom_mid geometry(MultiPolygon, 3857), geom_high geometry(MultiPolygon, 3857),
  label_point geometry(Point, 4326)
);
CREATE INDEX municipalities_uf_idx ON municipalities (uf);
CREATE INDEX municipalities_geom_low_idx ON municipalities USING gist (geom_low);
CREATE INDEX municipalities_geom_mid_idx ON municipalities USING gist (geom_mid);
CREATE INDEX municipalities_geom_high_idx ON municipalities USING gist (geom_high);

CREATE TABLE neighborhoods (
  id integer PRIMARY KEY, municipality_ibge integer NOT NULL REFERENCES municipalities(ibge), name text NOT NULL,
  geom_simplified geometry(MultiPolygon, 4326) NOT NULL, label_point geometry(Point, 4326) NOT NULL,
  area_km2 double precision, income_median numeric, income_method text, population integer, population_method text
);
CREATE INDEX neighborhoods_mun_idx ON neighborhoods (municipality_ibge);

CREATE TABLE city_data_status (
  municipality_ibge integer PRIMARY KEY REFERENCES municipalities(ibge), loaded_at timestamptz NOT NULL,
  reference_month text NOT NULL, neighborhoods integer NOT NULL, total_active integer NOT NULL, located integer NOT NULL,
  located_exact integer NOT NULL, located_trigram integer NOT NULL, unmatched_top jsonb NOT NULL DEFAULT '[]',
  division_kind text NOT NULL DEFAULT 'bairro', located_alias integer NOT NULL DEFAULT 0
);

CREATE TABLE segments (key text PRIMARY KEY, name text NOT NULL, sort smallint NOT NULL, competitor_type_key text);
CREATE TABLE business_types (
  key text PRIMARY KEY, name text NOT NULL, name_plural text NOT NULL, precision text NOT NULL, note text,
  selectable boolean NOT NULL DEFAULT true, source text NOT NULL DEFAULT 'cnpj'
);
CREATE TABLE business_type_cnae (
  business_type_key text NOT NULL REFERENCES business_types(key), cnae char(7) NOT NULL, description text NOT NULL,
  verified boolean NOT NULL, PRIMARY KEY (business_type_key, cnae)
);
CREATE TABLE business_type_cnes (
  business_type_key text NOT NULL REFERENCES business_types(key), tp_unidade text NOT NULL, description text NOT NULL,
  PRIMARY KEY (business_type_key, tp_unidade)
);
CREATE TABLE segment_defaults (
  segment_key text NOT NULL REFERENCES segments(key), business_type_key text NOT NULL REFERENCES business_types(key),
  direction text NOT NULL, weight smallint NOT NULL, PRIMARY KEY (segment_key, business_type_key)
);
CREATE TABLE data_sources (key text PRIMARY KEY, name text NOT NULL, url text NOT NULL, reference_date text NOT NULL, notes text);
CREATE TABLE etl_progress (uf char(2) NOT NULL, step text NOT NULL, reference text NOT NULL, done_at timestamptz NOT NULL, PRIMARY KEY (uf, step));
CREATE TABLE geo_cache (key text PRIMARY KEY, geojson text NOT NULL, etag text NOT NULL, fetched_at timestamptz NOT NULL DEFAULT now());

-- As views materializadas do banco completo viram tabelas: já são as contagens por bairro/município x tipo.
CREATE TABLE neighborhood_type_counts (neighborhood_id integer NOT NULL, business_type_key text NOT NULL, n_establishments integer NOT NULL, n_cnpj integer NOT NULL);
CREATE UNIQUE INDEX ntc_pk ON neighborhood_type_counts (business_type_key, neighborhood_id);
CREATE TABLE municipality_type_counts (municipality_ibge integer NOT NULL, business_type_key text NOT NULL, n_establishments integer NOT NULL, n_cnpj integer NOT NULL);
CREATE UNIQUE INDEX mtc_pk ON municipality_type_counts (business_type_key, municipality_ibge);
CREATE TABLE neighborhood_coverage (neighborhood_id integer PRIMARY KEY, located_count integer NOT NULL, level text NOT NULL);
