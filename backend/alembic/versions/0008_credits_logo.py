"""créditos (configuração, livro-razão, cidades e buscas liberadas) e identidade da empresa (nome e logo)

Revision ID: 0008
"""
from alembic import op

revision = "0008"
down_revision = "0007"


def upgrade():
    op.execute(
        """
        -- A regra de cobrança é dado, não código: mude aqui (ou com UPDATE) sem novo deploy.
        CREATE TABLE credit_settings (
          key text PRIMARY KEY,
          value integer NOT NULL CHECK (value >= 0),
          description text NOT NULL
        );
        INSERT INTO credit_settings VALUES
          ('city_unlock_cost', 1, 'Créditos para analisar uma cidade (mapa de bairros)'),
          ('city_unlock_days', 30, 'Dias de acesso a uma cidade liberada; reabrir dentro do prazo não cobra'),
          ('city_search_cost', 1, 'Créditos por busca no ranking de cidades (um alcance: Brasil, região ou estado)'),
          ('city_search_days', 30, 'Dias de acesso a um alcance liberado; mudar critérios e filtros dentro dele não cobra'),
          ('signup_grant', 1, 'Créditos dados a todo cadastro novo (1 cidade grátis, sem cartão)');

        -- Histórico completo: saldo = soma de delta. Nada é apagado (só com a conta, por LGPD).
        CREATE TABLE credit_ledger (
          id bigserial PRIMARY KEY,
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          delta integer NOT NULL CHECK (delta <> 0),
          reason text NOT NULL CHECK (reason IN ('signup', 'grant', 'city_unlock', 'city_search')),
          municipality_ibge integer REFERENCES municipalities(ibge),
          scope_key text,
          note text,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX credit_ledger_user_idx ON credit_ledger (user_id, created_at);

        CREATE TABLE city_unlocks (
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          municipality_ibge integer NOT NULL REFERENCES municipalities(ibge),
          unlocked_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          PRIMARY KEY (user_id, municipality_ibge)
        );

        -- Busca no ranking de cidades = um alcance: 'BR', 'R<id da região>' ou a UF ('PE').
        CREATE TABLE search_unlocks (
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scope_key text NOT NULL,
          unlocked_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          PRIMARY KEY (user_id, scope_key)
        );

        -- Identidade da empresa (opcional). A logo fica em DATA_DIR/uploads/logos/<logo_file>, fora do Git.
        ALTER TABLE business_profiles
          ADD COLUMN company_name text,
          ADD COLUMN logo_file text,
          ADD COLUMN logo_updated_at timestamptz;

        -- Quem já tinha conta ganha a mesma cidade grátis dos cadastros novos.
        INSERT INTO credit_ledger (user_id, delta, reason, note)
        SELECT id, 1, 'signup', 'concessão inicial (contas anteriores aos créditos)' FROM users;
        """
    )


def downgrade():
    op.execute(
        "DROP TABLE search_unlocks, city_unlocks, credit_ledger, credit_settings; "
        "ALTER TABLE business_profiles DROP COLUMN company_name, DROP COLUMN logo_file, DROP COLUMN logo_updated_at"
    )
