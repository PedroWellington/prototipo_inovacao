"""relatório em PDF: população dos bairros (Censo 2022), tipo concorrente por ramo, uso diário e contador do Google

Revision ID: 0013
"""
from alembic import op

revision = "0013"
down_revision = "0012"


def upgrade():
    op.execute(
        """
        -- População do Censo 2022 (v0001, Agregados por bairros/setores, básico). Nulo = sem dado: nunca estimado.
        CREATE TABLE census_population (
          level text NOT NULL CHECK (level IN ('setor', 'bairro')),
          code text NOT NULL,
          population integer,
          PRIMARY KEY (level, code)
        );
        -- ibge_bairro = publicada para o bairro; setores = soma exata dos setores da área (todos com valor).
        ALTER TABLE neighborhoods
          ADD COLUMN population integer,
          ADD COLUMN population_method text CHECK (population_method IN ('ibge_bairro', 'setores'));
        -- Concorrência no relatório: o tipo de estabelecimento do próprio ramo (dado do CSV, não código).
        ALTER TABLE segments ADD COLUMN competitor_type_key text;
        -- Relatórios por conta por dia (só a contagem; o PDF não é guardado).
        CREATE TABLE report_usage (
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          day date NOT NULL,
          reports integer NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, day)
        );
        -- Elementos da Routes API (Compute Route Matrix) consumidos no mês de cobrança do Google.
        -- Só a contagem: nenhum tempo, distância ou coordenada do Google é gravado (docs/GOOGLE-MAPS.md).
        CREATE TABLE google_routes_usage (
          month date PRIMARY KEY,
          elements integer NOT NULL DEFAULT 0,
          requests integer NOT NULL DEFAULT 0
        );
        INSERT INTO credit_settings VALUES
          ('report_cost', 0, 'Créditos por relatório em PDF de uma cidade já liberada (0 = sem custo extra)');
        ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
        ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check
          CHECK (reason IN ('signup', 'grant', 'city_unlock', 'city_search', 'report'));
        """
    )


def downgrade():
    op.execute(
        """
        DELETE FROM credit_ledger WHERE reason = 'report';
        ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_reason_check;
        ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_reason_check
          CHECK (reason IN ('signup', 'grant', 'city_unlock', 'city_search'));
        DELETE FROM credit_settings WHERE key = 'report_cost';
        DROP TABLE google_routes_usage, report_usage, census_population;
        ALTER TABLE segments DROP COLUMN competitor_type_key;
        ALTER TABLE neighborhoods DROP COLUMN population, DROP COLUMN population_method;
        """
    )
