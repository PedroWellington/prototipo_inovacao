"""usuários, sessões, perfil do negócio e critérios

Revision ID: 0003
"""
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.execute(
        """
        CREATE TABLE users (
          id bigserial PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL,
          password_hash text NOT NULL,
          email_verified boolean NOT NULL DEFAULT false,  -- TODO(verificação de e-mail): ver docs/EXTENSIONS.md
          terms_accepted_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

        -- Só o hash SHA-256 do token fica no banco; o token em si vive apenas no cookie httpOnly.
        CREATE TABLE sessions (
          id bigserial PRIMARY KEY,
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash char(64) NOT NULL UNIQUE,
          csrf_token text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL
        );
        CREATE INDEX sessions_user_idx ON sessions(user_id);

        CREATE TABLE business_profiles (
          user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          segment_key text REFERENCES segments(key),
          segment_other_text text,
          revenue_band text,          -- só armazenado; não entra em nenhum cálculo
          has_hq boolean,
          hq_uf char(2),
          hq_municipality_ibge integer REFERENCES municipalities(ibge),
          hq_neighborhood_text text,  -- só pré-seleção; não entra em nenhum cálculo
          onboarding_completed_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE TABLE profile_criteria (
          user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          business_type_key text NOT NULL,
          direction text NOT NULL CHECK (direction IN ('attract', 'repel')),
          weight smallint NOT NULL CHECK (weight BETWEEN 1 AND 5),
          PRIMARY KEY (user_id, business_type_key)
        );
        """
    )


def downgrade():
    op.execute("DROP TABLE profile_criteria, business_profiles, sessions, users")
